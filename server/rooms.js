// server/rooms.js
// Room management, chat processing, AFK handling, socket events, cleanup.
// Includes anti-spam (pressure cleanup, per-IP limits), vote-kick, dev mode
// (force-kick, vanish, hide, color), and Talkoboard stroke storage.

const path = require("path");
const fs = require("fs").promises;
const {
  CONFIG,
  ERROR_CODES,
  wordFilter,
  state,
  createErrorResponse,
  normalize,
  promisifySessionSave,
  sanitizeMessage,
  sanitizeName,
  enforceCharacterLimit,
  enforceUsernameLimit,
  enforceLocationLimit,
  enforceRoomNameLimit,
  isReservedName,
} = require("./state");
const {
  chatUpdateLimiter,
  typingLimiter,
  detectBotBehavior,
  isBlacklisted,
  createIPBasedUser,
  validateObject,
} = require("./security");
const roles = require("./roles");
const audit = require("./audit");

// io is accessed through state so it is available after server.js init
function io() {
  return state.io;
}

// ── Anniversary: a shared, persisted "celebrations" counter ─────────────────
// Everyone sees the live count grow as people light the candles.
let anniversaryCount = 0;
const ANNIVERSARY_PATH = path.join(__dirname, "..", "anniversary.json");
let annivSavePending = false;
function loadAnniversary() {
  try {
    const obj = JSON.parse(require("fs").readFileSync(ANNIVERSARY_PATH, "utf8"));
    if (obj && typeof obj.count === "number" && obj.count >= 0)
      anniversaryCount = Math.floor(obj.count);
  } catch (_) {}
}
function saveAnniversary() {
  if (annivSavePending) return;
  annivSavePending = true;
  setTimeout(() => {
    fs.writeFile(
      ANNIVERSARY_PATH,
      JSON.stringify({ count: anniversaryCount }),
      "utf8",
    )
      .catch(() => {})
      .finally(() => {
        annivSavePending = false;
      });
  }, 2000);
}
loadAnniversary();

// ── Talkoboard: Server-Side Stroke Storage (ephemeral) ──────────────────────

const boardState = new Map(); // roomId → { strokes: [], active: Map<userId, stroke> }
const MAX_BOARD_STROKES = 500;
const MAX_POINTS_PER_STROKE = 10000;

function getBoardState(roomId) {
  if (!boardState.has(roomId)) {
    boardState.set(roomId, { strokes: [], active: new Map() });
  }
  return boardState.get(roomId);
}

function cleanupBoardState(roomId) {
  boardState.delete(roomId);
}

function finalizeBoardUserStroke(roomId, userId) {
  const bs = boardState.get(roomId);
  if (!bs) return;
  const active = bs.active.get(userId);
  if (active && active.points && active.points.length > 0) {
    bs.strokes.push(active);
    if (bs.strokes.length > MAX_BOARD_STROKES) {
      bs.strokes = bs.strokes.slice(-MAX_BOARD_STROKES);
    }
  }
  bs.active.delete(userId);
}

// Validate a gradient-brush spec from the client: 2-8 hex color stops, else
// null (a plain solid-color stroke). Trusts nothing about it but the shape.
function sanitizeGradient(g) {
  if (!Array.isArray(g)) return null;
  const out = [];
  for (const c of g) {
    if (typeof c === "string" && /^#[0-9a-fA-F]{3,6}$/.test(c))
      out.push(c.slice(0, 7));
    if (out.length >= 8) break;
  }
  return out.length >= 2 ? out : null;
}

// ── User Counting ───────────────────────────────────────────────────────────

function getUserRoomsCount(userId) {
  for (const [, room] of state.rooms) {
    if (room.users && room.users.some((u) => u.id === userId)) return 1;
  }
  return 0;
}

// Counts whether this username/location is ALREADY occupying a room, used to
// enforce one identity per room. Ignores:
//   • the caller's own userId (so re-joining across the lobby→room navigation,
//     where a brief duplicate entry exists, never blocks them), and
//   • ghosts — matching entries whose socket is already gone (a stale session
//     the server hasn't cleaned yet). Without this, a disconnected ghost with
//     the same name would block the real user even after clearing cookies.
function getUsernameLocationRoomsCount(username, location, excludeUserId) {
  const uLow = normalize(username);
  const lLow = normalize(location);
  for (const [, room] of state.rooms) {
    if (!room.users) continue;
    for (const u of room.users) {
      if (excludeUserId && u.id === excludeUserId) continue;
      if (normalize(u.username) === uLow && normalize(u.location) === lLow) {
        if (findSocketByUserId(u.id)) return 1; // only a LIVE duplicate blocks
      }
    }
  }
  return 0;
}

function getUserCurrentRoom(userId) {
  for (const [roomId, room] of state.rooms) {
    if (room.users && room.users.some((u) => u.id === userId)) return roomId;
  }
  return null;
}

// ── Anti-Spam: Per-IP Room Counting ─────────────────────────────────────────

function getRoomCountByIP(clientIp) {
  if (!io() || !clientIp) return 0;
  const roomIds = new Set();
  for (const [, s] of io().sockets.sockets) {
    if (s.clientIp === clientIp && s.roomId) {
      roomIds.add(s.roomId);
    }
  }
  return roomIds.size;
}

// ── Anti-Spam: Pressure System ──────────────────────────────────────────────
// Solo rooms get a shorter time-to-live as the total room count rises.

function getSoloRoomTTL() {
  const totalRooms = state.rooms.size;
  const tiers = CONFIG.LIMITS.PRESSURE_TIERS;
  for (let i = tiers.length - 1; i >= 0; i--) {
    if (totalRooms >= tiers[i].threshold) return tiers[i].ttl;
  }
  return tiers[0].ttl;
}

function isHealthyRoom(room) {
  if (room.users && room.users.length >= 2) return true;
  const age = Date.now() - (room.createdAt || room.lastActiveTime || 0);
  return age < CONFIG.LIMITS.HEALTHY_ROOM_AGE_MS;
}

function getHealthyRoomCount() {
  let count = 0;
  for (const [, room] of state.rooms) {
    if (isHealthyRoom(room)) count++;
  }
  return count;
}

async function pressureCleanup() {
  const now = Date.now();
  const ttl = getSoloRoomTTL();
  const toDelete = [];

  for (const [roomId, room] of state.rooms) {
    if (room.users && room.users.length >= 2) continue;
    if (room.users && room.users.length === 1) {
      const soloSince = state.roomSoloSince.get(roomId);
      if (soloSince && now - soloSince >= ttl) {
        // Staff are exempt: a dev or mod can hold a room open indefinitely,
        // the same way they bypass AFK and capacity. Never solo-close on them.
        const soloSocket = findSocketByUserId(room.users[0].id, roomId);
        if (soloSocket && (soloSocket.isDev || soloSocket.isMod)) continue;
        toDelete.push(roomId);
      }
    } else if (!room.users || room.users.length === 0) {
      if (now - room.lastActiveTime > CONFIG.TIMING.ROOM_DELETION_TIMEOUT) {
        toDelete.push(roomId);
      }
    }
  }

  if (toDelete.length === 0) return;

  for (const roomId of toDelete) {
    const room = state.rooms.get(roomId);
    if (!room) continue;

    if (room.users && room.users.length === 1) {
      const soloUser = room.users[0];
      const soloSocket = findSocketByUserId(soloUser.id, roomId);
      if (soloSocket) {
        soloSocket.emit("afk timeout", {
          message:
            "Your room was closed due to extended single-occupancy. " +
            "You can create a new room anytime.",
          redirectTo: "/",
        });
        await leaveRoom(soloSocket, soloUser.id);
      }
    }

    state.rooms.delete(roomId);
    state.roomSoloSince.delete(roomId);
    state.roomLastChatActivity.delete(roomId);
    cleanupBoardState(roomId);
    if (state.roomDeletionTimers.has(roomId)) {
      clearTimeout(state.roomDeletionTimers.get(roomId));
      state.roomDeletionTimers.delete(roomId);
    }
  }

  updateLobby();
  await debouncedSaveRooms();
  const currentTTL = Math.round(ttl / 1000);
  console.log(
    `[PRESSURE] Cleaned ${toDelete.length} solo room(s) | ` +
      `Total: ${state.rooms.size} | TTL: ${currentTTL}s`,
  );
}

function updateRoomSoloTracking(roomId) {
  const room = state.rooms.get(roomId);
  if (!room) {
    state.roomSoloSince.delete(roomId);
    return;
  }
  if (room.users && room.users.length === 1) {
    if (!state.roomSoloSince.has(roomId)) {
      state.roomSoloSince.set(roomId, Date.now());
    }
  } else {
    state.roomSoloSince.delete(roomId);
  }
}

function findSocketByUserId(userId, roomId) {
  if (!io()) return null;
  for (const [, s] of io().sockets.sockets) {
    if (
      s.handshake?.session?.userId === userId &&
      (!roomId || s.roomId === roomId)
    ) {
      return s;
    }
  }
  return null;
}

// ── Staff Helpers (mod / dev) ───────────────────────────────────────────────
// Role is proven by the key hash validated in the socket middleware. These
// helpers gate every privileged action server-side and enforce the hierarchy.

function isStaffSocket(socket) {
  return !!(socket && (socket.isDev || socket.isMod));
}

// All live sockets for a userId (normally one).
function findSocketsByUserId(userId) {
  const result = [];
  if (!io() || !userId) return result;
  for (const [, s] of io().sockets.sockets) {
    if (s.handshake?.session?.userId === userId) result.push(s);
  }
  return result;
}

// All live sockets sharing an IP.
function findSocketsByIp(ip) {
  const result = [];
  if (!io() || !ip) return result;
  for (const [, s] of io().sockets.sockets) {
    if (s.clientIp === ip) result.push(s);
  }
  return result;
}

// Resolve a target user's staff role from their live socket(s).
function getUserStaffRole(userId) {
  for (const s of findSocketsByUserId(userId)) {
    if (s.isDev) return "dev";
    if (s.isMod) return "mod";
  }
  return null;
}

// Hierarchy: devs can act on normal users and mods, but NOT on other devs.
// Mods can only act on normal (non-staff) users. Nobody can act on a dev.
function canActOn(actorSocket, targetUserId) {
  const targetRole = getUserStaffRole(targetUserId);
  if (actorSocket?.isDev) return targetRole !== "dev";
  if (actorSocket?.isMod) return targetRole === null;
  return false;
}

// Gate helpers: emit a uniform error and return false when not permitted.
function requireStaff(socket) {
  if (isStaffSocket(socket)) return true;
  socket.emit(
    "error",
    createErrorResponse(ERROR_CODES.FORBIDDEN, "Staff access required."),
  );
  return false;
}

function requireDev(socket) {
  if (socket?.isDev) return true;
  socket.emit(
    "error",
    createErrorResponse(ERROR_CODES.FORBIDDEN, "Dev access required."),
  );
  return false;
}

// Records one privileged action to the audit log (board feed + audit-log.jsonl
// + modlog.txt). target/room accept a string or an object ({id,username} for
// users, room objects for rooms). `details` carries free text (e.g. the body
// of a warning or megaphone) so the board shows exactly what was sent.
function logStaff(socket, action, target, room, details) {
  const roleTag = socket?.isDev ? "dev" : "mod";
  const label = socket?.staffLabel || roleTag;
  let targetStr = null;
  if (typeof target === "string") targetStr = target === "-" ? null : target;
  else if (target && typeof target === "object") {
    const name = target.username || target.name || "?";
    const id = target.id || target.userId || "?";
    targetStr = `user:${name}(${id})`;
  }
  let roomTag = null;
  if (typeof room === "string") roomTag = room === "-" ? null : room;
  else if (room && typeof room === "object")
    roomTag = `room:${room.name || "?"}(${room.id || "?"})`;
  audit.recordAction({
    roleTag,
    label,
    action,
    target: targetStr,
    room: roomTag,
    ip: socket?.clientIp || null,
    details: details || null,
  });
}

// Per-IP throttle for the staff key-entry login, to blunt brute-force guessing.
const staffKeyAttempts = new Map(); // ip -> { count, resetAt }
const STAFF_KEY_MAX_ATTEMPTS = 15;
const STAFF_KEY_WINDOW = 5 * 60 * 1000;

// Snapshot of currently-blocked IPs for the dev panel (skips expired entries).
function buildBlockList() {
  const now = Date.now();
  const out = [];
  for (const [ip, b] of state.blockedIPs) {
    const expiry = b && typeof b === "object" ? b.expiry : b;
    if (expiry && expiry !== Number.MAX_SAFE_INTEGER && now >= expiry) continue;
    out.push({
      ip,
      label: (b && b.label) || null,
      by: (b && b.by) || null,
      reason: (b && b.reason) || null,
      permanent: expiry >= Number.MAX_SAFE_INTEGER,
      expiry: expiry || 0,
    });
  }
  return out;
}

// ── Room Utilities ──────────────────────────────────────────────────────────

function calculateCurrentRoomLimit() {
  if (!CONFIG.FEATURES.ENABLE_DYNAMIC_SCALING)
    return CONFIG.LIMITS.BASE_MAX_ROOMS;
  const total = getTotalUserCount();
  const perCycle =
    CONFIG.LIMITS.BASE_MAX_ROOMS * CONFIG.LIMITS.MAX_ROOM_CAPACITY;
  const cycles = Math.floor(total / perCycle);
  return Math.max(
    CONFIG.LIMITS.BASE_MAX_ROOMS +
      cycles * CONFIG.LIMITS.ROOM_SCALING_INCREMENT,
    CONFIG.LIMITS.BASE_MAX_ROOMS,
  );
}

function getTotalUserCount() {
  let total = 0;
  for (const [, room] of state.rooms) {
    if (room.users) total += room.users.length;
  }
  return total;
}

function roomNameExists(name) {
  const n = normalize(name);
  for (const [, room] of state.rooms) {
    if (normalize(room.name) === n) return true;
  }
  return false;
}

function getRoomStatistics() {
  const totalRooms = state.rooms.size;
  const currentLimit = calculateCurrentRoomLimit();
  const healthyRooms = getHealthyRoomCount();
  const types = { public: 0, "semi-private": 0, private: 0 };
  let roomsWithUsers = 0;
  let soloRooms = 0;
  let totalUsers = 0;

  for (const [, room] of state.rooms) {
    if (types[room.type] !== undefined) types[room.type]++;
    // Count only visible users for public stats
    const visibleUsers = (room.users || []).filter(
      (u) => !(u.isDev && u.isVanished),
    );
    totalUsers += visibleUsers.length;
    if (visibleUsers.length > 0) roomsWithUsers++;
    if (visibleUsers.length === 1) soloRooms++;
  }

  return {
    totalRooms,
    totalUsers,
    currentLimit,
    healthyRooms,
    soloRooms,
    roomsWithUsers,
    emptyRooms: totalRooms - roomsWithUsers,
    roomTypes: types,
    currentSoloTTL: Math.round(getSoloRoomTTL() / 1000),
    hardCap: CONFIG.LIMITS.HARD_MAX_ROOMS,
    utilizationPercentage:
      totalRooms > 0
        ? Math.round(
            (totalUsers / (totalRooms * CONFIG.LIMITS.MAX_ROOM_CAPACITY)) * 100,
          )
        : 0,
  };
}

function generateRoomId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function getCurrentMessages(usersInRoom) {
  const msgs = {};
  if (Array.isArray(usersInRoom)) {
    usersInRoom.forEach((u) => {
      msgs[u.id] = state.userMessageBuffers.get(u.id) || "";
    });
  }
  return msgs;
}

// ── Dev Mode: Visibility Helpers (vanish / hide) ────────────────────────────

// Vanished devs do not count toward room capacity
function getJoinableUserCount(room) {
  return (room?.users || []).filter((u) => !(u.isDev && u.isVanished)).length;
}

function getRecipientUserId(socket) {
  return socket?.handshake?.session?.userId || null;
}

// Vanished devs are only visible to themselves and other devs.
// Hidden devs are visible to everyone but without flair.
function canRecipientSeeDevUser(recipientSocket, user) {
  if (!user) return false;
  if (!user.isDev) return true;
  if (!user.isVanished) return true;
  const recipientUserId = getRecipientUserId(recipientSocket);
  if (recipientUserId && recipientUserId === user.id) return true;
  if (recipientSocket?.isDev) return true;
  return false;
}

// Formats one user for one recipient. Returns null if not visible.
// Hidden devs are stripped of all dev flair.
function formatUserForSocket(user, recipientSocket) {
  if (!user) return null;

  if (!canRecipientSeeDevUser(recipientSocket, user)) return null;

  const formatted = {
    id: user.id,
    username: user.username,
    location: user.location,
  };

  if (user.isHidden) {
    return formatted;
  }

  if (user.isDev) {
    formatted.isDev = true;
    if (user.devColor) formatted.devColor = user.devColor;
    if (user.isVanished) formatted.isVanished = true;
  } else if (user.isMod) {
    // Mod badge is distinct from the dev crown; mods are never vanished.
    formatted.isMod = true;
  }

  return formatted;
}

function filterUsersForSocket(users, recipientSocket) {
  return (users || [])
    .map((user) => formatUserForSocket(user, recipientSocket))
    .filter(Boolean);
}

// Votes involving invisible (vanished) users are hidden from non-devs
function filterVotesForSocket(room, recipientSocket) {
  const votes = room?.votes || {};
  const roomUsers = room?.users || [];
  const byId = new Map(roomUsers.map((u) => [u.id, u]));
  const filtered = {};

  for (const [voterId, targetId] of Object.entries(votes)) {
    const voter = byId.get(voterId);
    const target = byId.get(targetId);
    if (!voter || !target) continue;
    if (!canRecipientSeeDevUser(recipientSocket, voter)) continue;
    if (!canRecipientSeeDevUser(recipientSocket, target)) continue;
    filtered[voterId] = targetId;
  }
  return filtered;
}

function filterCurrentMessagesForSocket(room, recipientSocket) {
  const messages = {};
  for (const user of room?.users || []) {
    if (!canRecipientSeeDevUser(recipientSocket, user)) continue;
    messages[user.id] = state.userMessageBuffers.get(user.id) || "";
  }
  return messages;
}

// Lobby-list view of a room, tailored to one recipient
function formatRoomForSocket(room, recipientSocket) {
  const users = filterUsersForSocket(room.users || [], recipientSocket);
  const joinableCount = getJoinableUserCount(room);
  return {
    id: room.id,
    name: room.name,
    type: room.type,
    layout: room.layout,
    isFull: joinableCount >= CONFIG.LIMITS.MAX_ROOM_CAPACITY,
    userCount: joinableCount,
    visibleUserCount: users.length,
    lastChatActivity: state.roomLastChatActivity.get(room.id) || 0,
    createdAt: room.createdAt || room.lastActiveTime || 0,
    spotlight: !!room.spotlight,
    locked: !!room.locked,
    capacity: CONFIG.LIMITS.MAX_ROOM_CAPACITY,
    users,
  };
}

// Full in-room state, tailored to one recipient
function formatRoomStateForSocket(room, recipientSocket) {
  const users = filterUsersForSocket(room.users || [], recipientSocket);
  const joinableCount = getJoinableUserCount(room);
  return {
    id: room.id,
    name: room.name,
    type: room.type,
    layout: room.layout,
    users,
    votes: filterVotesForSocket(room, recipientSocket),
    currentMessages: filterCurrentMessagesForSocket(room, recipientSocket),
    isFull: joinableCount >= CONFIG.LIMITS.MAX_ROOM_CAPACITY,
    userCount: joinableCount,
    visibleUserCount: users.length,
    capacity: CONFIG.LIMITS.MAX_ROOM_CAPACITY,
    locked: !!room.locked,
    slowMode: !!room.slowMode,
    spotlight: !!room.spotlight,
  };
}

// ── Per-Socket Emission Helpers (visibility-aware) ──────────────────────────

function emitRoomSnapshot(roomId) {
  if (!io()) return;
  const room = state.rooms.get(roomId);
  if (!room) return;
  for (const [, socket] of io().sockets.sockets) {
    if (!socket.connected || socket.roomId !== roomId) continue;
    socket.emit("room update", formatRoomStateForSocket(room, socket));
  }
}

function emitLobbySnapshot() {
  if (!io()) return;
  const rooms = Array.from(state.rooms.values()).filter(
    (r) => r.type !== "private",
  );
  for (const [, socket] of io().sockets.sockets) {
    if (!socket.connected || !socket.rooms?.has("lobby")) continue;
    const data = rooms.map((room) => formatRoomForSocket(room, socket));
    socket.emit("lobby update", data);
  }
}

function emitRoomVoteUpdates(roomId) {
  if (!io()) return;
  const room = state.rooms.get(roomId);
  if (!room) return;
  for (const [, recipient] of io().sockets.sockets) {
    if (!recipient.connected || recipient.roomId !== roomId) continue;
    recipient.emit("update votes", filterVotesForSocket(room, recipient));
  }
}

function emitRoomUserLeft(roomId, userId, leftUser) {
  if (!io()) return;
  for (const [, recipient] of io().sockets.sockets) {
    if (!recipient.connected || recipient.roomId !== roomId) continue;
    if (!canRecipientSeeDevUser(recipient, leftUser)) continue;
    recipient.emit("user left", userId);
  }
}

function emitRoomUserJoined(room, joinedUser) {
  if (!io()) return;
  for (const [, recipient] of io().sockets.sockets) {
    if (!recipient.connected || recipient.roomId !== room.id) continue;
    // The joining user gets "room joined" instead
    const recipientUserId = getRecipientUserId(recipient);
    if (recipientUserId === joinedUser.id) continue;
    if (!canRecipientSeeDevUser(recipient, joinedUser)) continue;
    const visibleUser = formatUserForSocket(joinedUser, recipient);
    if (!visibleUser) continue;
    recipient.emit("user joined", {
      ...visibleUser,
      roomName: room.name,
      roomType: room.type,
    });
  }
}

function emitRoomTyping(socket, userId, username, isTyping) {
  if (!socket.roomId || !io()) return;
  const room = state.rooms.get(socket.roomId);
  if (!room) return;
  const senderUser = room.users?.find((u) => u.id === userId);
  for (const [, recipient] of io().sockets.sockets) {
    if (
      !recipient.connected ||
      recipient.roomId !== socket.roomId ||
      recipient.id === socket.id
    )
      continue;
    if (!canRecipientSeeDevUser(recipient, senderUser)) continue;
    recipient.emit("user typing", { userId, username, isTyping });
  }
}

function emitRoomChatUpdate(socket, payload) {
  if (!socket.roomId || !io()) return;
  const room = state.rooms.get(socket.roomId);
  if (!room) return;
  const senderUser = room.users?.find((u) => u.id === payload.userId);
  for (const [, recipient] of io().sockets.sockets) {
    if (
      !recipient.connected ||
      recipient.roomId !== socket.roomId ||
      recipient.id === socket.id
    )
      continue;
    if (!canRecipientSeeDevUser(recipient, senderUser)) continue;
    recipient.emit("chat update", payload);
  }
}

// ── Dev Mode: Room / Lobby Context ──────────────────────────────────────────

function getDevRoomContext(roomId) {
  if (!io()) return {};
  const ctx = {};
  const room = state.rooms.get(roomId);
  const roomUsers = new Map((room?.users || []).map((u) => [u.id, u]));
  for (const [, s] of io().sockets.sockets) {
    if (s.roomId !== roomId || !s.handshake?.session?.userId) continue;
    const userId = s.handshake.session.userId;
    const roomUser = roomUsers.get(userId);
    if (roomUser?.isHidden) continue;
    ctx[userId] = { d: s.clientIp || "unknown" };
  }
  return ctx;
}

// IP overlay is dev-only for safety: mods can still kick / ban / IP-block a
// user (the server resolves the IP for them) but never SEE raw IP addresses.
function sendDevRoomContext(roomId) {
  if (!io()) return;
  const ctx = getDevRoomContext(roomId);
  for (const [, s] of io().sockets.sockets) {
    if (s.isDev && s.roomId === roomId) {
      s.emit("dev context", ctx);
    }
  }
}

// Devs idle in the lobby receive semi-private access codes
function sendDevLobbyContext() {
  if (!io()) return;
  const devSockets = [];
  for (const [, s] of io().sockets.sockets) {
    if (s.isDev && !s.roomId) devSockets.push(s);
  }
  if (devSockets.length === 0) return;

  const data = {};
  for (const [roomId, room] of state.rooms) {
    if (room.type === "semi-private" && room.accessCode) {
      data[roomId] = room.accessCode;
    }
  }
  for (const s of devSockets) {
    s.emit("dev lobby context", data);
  }
}

// ── Room Save / Load ────────────────────────────────────────────────────────

async function saveRooms() {
  const now = Date.now();
  if (now - state.lastSaveTimestamp < state.SAVE_INTERVAL_MIN) return;
  try {
    const data = Array.from(state.rooms.entries()).map(([id, room]) => {
      return [
        id,
        {
          ...room,
          users: (room.users || []).map((u) => {
            const clean = { ...u };
            delete clean.isVanished; // ephemeral, never persisted
            return clean;
          }),
          bannedUserIds: Array.from(room.bannedUserIds || []),
        },
      ];
    });
    const tmp = path.join(__dirname, "..", "rooms.json.tmp");
    const final = path.join(__dirname, "..", "rooms.json");
    await fs.writeFile(tmp, JSON.stringify(data), "utf8");
    await fs.rename(tmp, final);
    state.lastSaveTimestamp = now;
    console.log("Rooms saved successfully.");
  } catch (err) {
    console.error("Error saving rooms:", err);
    try {
      await fs.unlink(path.join(__dirname, "..", "rooms.json.tmp"));
    } catch (_) {}
  }
}

const debouncedSaveRooms = async () => {
  if (state.saveRoomsPending) return;
  state.saveRoomsPending = true;
  setTimeout(async () => {
    try {
      await saveRooms();
    } catch (e) {
      console.error("Debounced save error:", e);
    } finally {
      state.saveRoomsPending = false;
    }
  }, 10000);
};

async function loadRooms() {
  if (!CONFIG.FEATURES.LOAD_ROOMS_ON_STARTUP) {
    console.log("Starting with empty rooms (room loading disabled)");
    state.rooms = new Map();
    return;
  }
  try {
    const raw = await fs.readFile(
      path.join(__dirname, "..", "rooms.json"),
      "utf8",
    );
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) {
      state.rooms = new Map();
      return;
    }

    state.rooms = new Map(
      arr.map((item) => {
        if (item[1]) {
          if (item[1].users && item[1].users.length > 0) {
            console.log(
              `Clearing ${item[1].users.length} stale user(s) from room: ${item[1].name || item[0]}`,
            );
          }
          item[1].users = [];
          item[1].lastActiveTime = Date.now();
          item[1].bannedUserIds = new Set(
            Array.isArray(item[1].bannedUserIds)
              ? item[1].bannedUserIds
              : typeof item[1].bannedUserIds === "object"
                ? Object.values(item[1].bannedUserIds)
                : [],
          );
        }
        return item;
      }),
    );
    console.log(`Loaded ${state.rooms.size} rooms from disk (users cleared).`);
    for (const [roomId] of state.rooms) {
      startRoomDeletionTimer(roomId);
    }
  } catch (err) {
    if (err.code === "ENOENT")
      console.log("rooms.json not found. Starting fresh.");
    else console.error("Error loading rooms:", err);
    state.rooms = new Map();
  }
}

// ── Room Timers ─────────────────────────────────────────────────────────────

function startRoomDeletionTimer(roomId) {
  if (state.roomDeletionTimers.has(roomId)) {
    clearTimeout(state.roomDeletionTimers.get(roomId));
  }
  const timer = setTimeout(async () => {
    const room = state.rooms.get(roomId);
    if (room && room.users.length === 0) {
      state.rooms.delete(roomId);
      state.roomDeletionTimers.delete(roomId);
      state.roomSoloSince.delete(roomId);
      state.roomLastChatActivity.delete(roomId);
      cleanupBoardState(roomId);
      updateLobby();
      await debouncedSaveRooms();
      console.log(`Room ${roomId} deleted (empty timeout).`);
    }
  }, CONFIG.TIMING.ROOM_DELETION_TIMEOUT);
  state.roomDeletionTimers.set(roomId, timer);
}

// ── Lobby / Room Broadcasts ─────────────────────────────────────────────────

function updateLobby() {
  if (!io()) return;
  try {
    state.apiCache.delete("socket_rooms_dev");
    state.apiCache.delete("socket_rooms_normal");
    emitLobbySnapshot();
    sendDevLobbyContext();
  } catch (err) {
    console.error("updateLobby error:", err);
  }
}

function updateRoom(roomId) {
  if (!io()) return;
  const room = state.rooms.get(roomId);
  if (room) {
    emitRoomSnapshot(roomId);
  }
}

// ── AFK ─────────────────────────────────────────────────────────────────────

function clearAFKTimers(userId) {
  if (state.afkWarningTimers.has(userId)) {
    clearTimeout(state.afkWarningTimers.get(userId));
    state.afkWarningTimers.delete(userId);
  }
  if (state.afkTimers.has(userId)) {
    clearTimeout(state.afkTimers.get(userId));
    state.afkTimers.delete(userId);
  }
}

function setupAFKTimers(socket, userId) {
  clearAFKTimers(userId);
  if (!socket || !socket.roomId) return;
  if (socket.isDev || socket.isMod) return; // staff bypass AFK
  if (socket.boardOpen) return; // drawing on the board counts as active

  state.afkWarningTimers.set(
    userId,
    setTimeout(() => {
      if (socket.connected)
        socket.emit("afk warning", {
          message: "You have been inactive.",
          secondsRemaining: 30,
        });
    }, CONFIG.TIMING.AFK_WARNING_TIME),
  );
  state.afkTimers.set(
    userId,
    setTimeout(
      () => handleAFKTimeout(socket, userId),
      CONFIG.LIMITS.MAX_AFK_TIME,
    ),
  );
}

async function handleAFKTimeout(socket, userId) {
  if (!socket || !socket.roomId) return;
  console.log(`AFK timeout: ${userId} in room ${socket.roomId}`);
  socket.emit("afk timeout", {
    message: "Removed from room due to inactivity.",
    redirectTo: "/",
  });
  await leaveRoom(socket, userId);
  clearAFKTimers(userId);
}

// ── Chat Processing ─────────────────────────────────────────────────────────

function checkChatCircuit() {
  const now = Date.now();
  const cs = state.chatCircuitState;
  if (cs.isOpen && now - cs.lastFailure > cs.resetTimeout) {
    cs.isOpen = false;
    cs.failures = 0;
  }
  if (!cs.isOpen && cs.failures > cs.threshold) {
    cs.isOpen = true;
    cs.lastFailure = now;
    console.warn("Chat circuit breaker opened");
  }
  return !cs.isOpen;
}

// Slow mode lengthens the broadcast cadence for a room: keystrokes are still
// captured, the room just sees full-replace updates less often.
function getBatchInterval(roomId) {
  const room = roomId ? state.rooms.get(roomId) : null;
  return room && room.slowMode
    ? CONFIG.TIMING.SLOW_MODE_BATCH_INTERVAL
    : CONFIG.TIMING.BATCH_PROCESSING_INTERVAL;
}

// Applies queued diffs to the user's message buffer in rate-limited batches,
// sanitizes the result, and broadcasts a full-replace to the room.
async function processPendingChatUpdates(userId, socket) {
  try {
    if (!state.pendingChatUpdates.has(userId) || !socket || !socket.roomId)
      return;
    const pending = state.pendingChatUpdates.get(userId);
    if (!pending || pending.diffs.length === 0) return;

    if (state.batchProcessingTimers.has(userId)) {
      clearTimeout(state.batchProcessingTimers.get(userId));
      state.batchProcessingTimers.delete(userId);
    }

    let msg = state.userMessageBuffers.get(userId) || "";
    const username = socket.handshake.session.username || "Anonymous";

    let shouldRateLimit = false;
    try {
      await chatUpdateLimiter.consume(
        userId,
        Math.min(1 + Math.floor(pending.diffs.length / 10), 2),
      );
    } catch (e) {
      shouldRateLimit = true;
      if (e.msBeforeNext > 1000)
        socket.emit("message", { type: "warning", text: "Slow down typing" });
    }

    const limit = shouldRateLimit
      ? Math.min(10, CONFIG.LIMITS.BATCH_SIZE_LIMIT)
      : CONFIG.LIMITS.BATCH_SIZE_LIMIT;
    const batch = pending.diffs.splice(0, limit);

    for (const diff of batch) {
      if (diff.type === "full-replace") {
        msg = diff.text || "";
      } else if (diff.type === "add") {
        diff.index = Math.min(diff.index, msg.length);
        const space = CONFIG.LIMITS.MAX_MESSAGE_LENGTH - msg.length;
        diff.text = (diff.text || "").substring(0, space);
        msg = msg.slice(0, diff.index) + diff.text + msg.slice(diff.index);
      } else if (diff.type === "delete") {
        diff.index = Math.min(diff.index, msg.length);
        diff.count = Math.min(diff.count, msg.length - diff.index);
        msg = msg.slice(0, diff.index) + msg.slice(diff.index + diff.count);
      } else if (diff.type === "replace") {
        diff.index = Math.min(diff.index, msg.length);
        const rLen = (diff.text || "").length;
        const end = Math.min(diff.index + rLen, msg.length);
        msg = msg.slice(0, diff.index) + (diff.text || "") + msg.slice(end);
      }
    }

    msg = sanitizeMessage(msg);
    state.userMessageBuffers.set(userId, msg);

    if (socket.roomId) {
      state.roomLastChatActivity.set(socket.roomId, Date.now());
    }

    emitRoomChatUpdate(socket, {
      userId,
      username,
      diff: { type: "full-replace", text: msg },
    });

    setupAFKTimers(socket, userId);

    if (pending.diffs.length > 0) {
      state.batchProcessingTimers.set(
        userId,
        setTimeout(
          () => processPendingChatUpdates(userId, socket),
          getBatchInterval(socket.roomId),
        ),
      );
    } else {
      state.pendingChatUpdates.delete(userId);
    }
    if (state.chatCircuitState.failures > 0) state.chatCircuitState.failures--;
  } catch (err) {
    console.error("processPendingChatUpdates error:", err);
    state.pendingChatUpdates.delete(userId);
  }
}

// ── Leave / Join Room ───────────────────────────────────────────────────────

async function leaveRoom(socket, userId) {
  try {
    const roomId = socket.roomId;
    if (!roomId) return;
    clearAFKTimers(userId);

    finalizeBoardUserStroke(roomId, userId);

    const room = state.rooms.get(roomId);
    if (room) {
      const leftUser = room.users.find((u) => u.id === userId);
      room.users = room.users.filter((u) => u.id !== userId);
      room.lastActiveTime = Date.now();

      if (room.votes) {
        delete room.votes[userId];
        for (const vid in room.votes) {
          if (room.votes[vid] === userId) delete room.votes[vid];
        }
        emitRoomVoteUpdates(roomId);
      }

      socket.leave(roomId);
      emitRoomUserLeft(roomId, userId, leftUser);
      updateRoom(roomId);
      sendDevRoomContext(roomId);
      updateRoomSoloTracking(roomId);

      if (room.users.length === 0) startRoomDeletionTimer(roomId);
    }

    if (socket.handshake.session) {
      if (socket.handshake.session.validatedRooms?.[roomId])
        delete socket.handshake.session.validatedRooms[roomId];
      socket.handshake.session.currentRoom = null;
      await promisifySessionSave(socket.handshake.session).catch((e) =>
        console.error("Session save in leaveRoom:", e),
      );
    }
    state.userMessageBuffers.delete(userId);
    state.devUsers.delete(userId);

    socket.roomId = null;
    socket.join("lobby");
    updateLobby();
    await debouncedSaveRooms();
  } catch (err) {
    console.error("leaveRoom error:", err);
    if (socket?.emit)
      socket.emit(
        "error",
        createErrorResponse(ERROR_CODES.SERVER_ERROR, "Error leaving room."),
      );
  }
}

function joinRoom(socket, roomId, userId) {
  try {
    if (!roomId || typeof roomId !== "string" || roomId.length !== 6) {
      return socket.emit(
        "error",
        createErrorResponse(
          ERROR_CODES.NOT_FOUND,
          "Room not found (invalid ID).",
        ),
      );
    }
    const room = state.rooms.get(roomId);
    if (!room)
      return socket.emit(
        "error",
        createErrorResponse(ERROR_CODES.NOT_FOUND, "Room not found."),
      );
    const isStaff = !!socket.isDev || !!socket.isMod;

    if (room.bannedUserIds?.has(userId) && !isStaff)
      return socket.emit(
        "error",
        createErrorResponse(
          ERROR_CODES.FORBIDDEN,
          "You are banned from this room.",
        ),
      );

    // Maintenance mode and per-room locks block new joins for everyone but staff.
    if (state.maintenance && !isStaff)
      return socket.emit(
        "error",
        createErrorResponse(
          ERROR_CODES.FORBIDDEN,
          "Talkomatic is in maintenance mode. New joins are paused while " +
            "people finish their conversations. Please try again shortly.",
          null,
          true,
        ),
      );

    if (room.locked && !isStaff)
      return socket.emit(
        "error",
        createErrorResponse(
          ERROR_CODES.FORBIDDEN,
          "This room is locked. No new joins are allowed right now.",
          null,
          true,
        ),
      );

    let { username, location } = socket.handshake.session || {};
    if (!username || !location) {
      username = "Anonymous";
      location = "On The Web";
    }

    const clientIp = socket.clientIp || socket.handshake.address;
    if (CONFIG.FEATURES.ENABLE_BOT_PROTECTION) {
      if (isBlacklisted(userId, clientIp))
        return socket.emit(
          "error",
          createErrorResponse(ERROR_CODES.FORBIDDEN, "Access denied."),
        );
      if (detectBotBehavior(userId, clientIp))
        return socket.emit(
          "error",
          createErrorResponse(
            ERROR_CODES.RATE_LIMITED,
            "Too many join attempts.",
          ),
        );
    }

    const isAnon = username === "Anonymous" && location === "On The Web";
    if (!isAnon) {
      const curRoom = getUserCurrentRoom(userId);
      if (curRoom && curRoom !== roomId) {
        const name = state.rooms.get(curRoom)?.name || "Unknown";
        return socket.emit(
          "error",
          createErrorResponse(
            ERROR_CODES.FORBIDDEN,
            `You are already in "${name}". Leave first.`,
            { currentRoomId: curRoom, currentRoomName: name },
            true,
          ),
        );
      }
      if (
        getUsernameLocationRoomsCount(username, location, userId) >=
        CONFIG.LIMITS.MAX_ROOMS_PER_USER
      ) {
        return socket.emit(
          "error",
          createErrorResponse(
            ERROR_CODES.FORBIDDEN,
            "This username/location is already in a room.",
          ),
        );
      }
    }

    if (!room.users) room.users = [];
    if (!room.votes) room.votes = {};

    // Staff bypass room capacity (can always enter a full room to handle a
    // report); normal users check the visible count.
    const joinableUserCount = getJoinableUserCount(room);
    if (!isStaff && joinableUserCount >= CONFIG.LIMITS.MAX_ROOM_CAPACITY)
      return socket.emit(
        "room full",
        createErrorResponse(ERROR_CODES.ROOM_FULL, "Room is full."),
      );

    clearAFKTimers(userId);
    room.users = room.users.filter((u) => u.id !== userId);
    socket.join(roomId);

    room.users.push({
      id: userId,
      username,
      location,
      isDev: !!socket.isDev,
      isMod: !!socket.isMod,
      isHidden: !!socket.isHidden,
      isVanished: !!socket.isVanished,
    });

    if (socket.isDev) {
      state.devUsers.add(userId);
    }

    room.lastActiveTime = Date.now();
    socket.roomId = roomId;
    setupAFKTimers(socket, userId);
    updateRoomSoloTracking(roomId);

    // Session save must complete before emitting join success, so the
    // room page can rejoin via the session without an access code in the URL
    if (socket.handshake.session) {
      socket.handshake.session.currentRoom = roomId;
      socket.handshake.session.save((err) => {
        if (err)
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.SERVER_ERROR,
              "Session save failed.",
            ),
          );
        emitJoinSuccess(socket, room, userId, username, location);
      });
    } else {
      emitJoinSuccess(socket, room, userId, username, location);
    }
    debouncedSaveRooms().catch(() => {});
  } catch (err) {
    console.error("joinRoom error:", err);
    socket.emit(
      "error",
      createErrorResponse(
        ERROR_CODES.SERVER_ERROR,
        "Unexpected error joining room.",
      ),
    );
  }
}

function emitJoinSuccess(socket, room, userId, username, location) {
  const joinedUser = room.users?.find((u) => u.id === userId) || {
    id: userId,
    username,
    location,
    isDev: !!socket.isDev,
    isMod: !!socket.isMod,
    isHidden: !!socket.isHidden,
    isVanished: !!socket.isVanished,
  };

  // The joining user always sees themselves in full
  socket.emit("room joined", {
    roomId: room.id,
    userId,
    username,
    location,
    isDev: !!socket.isDev,
    isMod: !!socket.isMod,
    isHidden: !!socket.isHidden,
    isVanished: !!socket.isVanished,
    roomName: room.name,
    roomType: room.type,
    locked: !!room.locked,
    slowMode: !!room.slowMode,
    spotlight: !!room.spotlight,
    users: filterUsersForSocket(room.users || [], socket),
    layout: room.layout,
    votes: filterVotesForSocket(room, socket),
    currentMessages: filterCurrentMessagesForSocket(room, socket),
  });

  socket.leave("lobby");

  emitRoomUserJoined(room, joinedUser);
  updateRoom(room.id);
  updateLobby();

  if (state.roomDeletionTimers.has(room.id)) {
    clearTimeout(state.roomDeletionTimers.get(room.id));
    state.roomDeletionTimers.delete(room.id);
  }
  sendDevRoomContext(room.id);
}

function handleTyping(socket, userId, username, isTyping) {
  if (!socket.roomId) return;
  if (state.typingTimeouts.has(userId))
    clearTimeout(state.typingTimeouts.get(userId));

  if (isTyping) {
    emitRoomTyping(socket, userId, username, true);
    state.typingTimeouts.set(
      userId,
      setTimeout(() => {
        emitRoomTyping(socket, userId, username, false);
        state.typingTimeouts.delete(userId);
      }, CONFIG.TIMING.TYPING_TIMEOUT),
    );
  } else {
    emitRoomTyping(socket, userId, username, false);
    state.typingTimeouts.delete(userId);
  }
}

// ── Socket Event Registration ───────────────────────────────────────────────

function registerSocketHandlers() {
  io().on("connection", (socket) => {
    const clientIp = socket.clientIp || socket.handshake.address;

    // ── Single active tab per browser session ──────────────────────────
    // Identity is the session id (one per browser, shared across tabs). Two
    // tabs therefore drove one identity, which crossed names and typed
    // messages between them. The newest connection now supersedes older ones
    // from the same session: the old tab is told and dropped, so only one tab
    // is ever live. Bots (token identities) and the read-only Mod Log board
    // are exempt, so the Mod Log can stay open beside a room.
    socket.isModLog = socket.handshake?.auth?.app === "modlog";
    if (!socket.isBot && !socket.isModLog && socket.handshake?.sessionID) {
      const sid = socket.handshake.sessionID;
      for (const [, other] of io().sockets.sockets) {
        if (other.id === socket.id || other.isBot || other.isModLog) continue;
        if (other.handshake?.sessionID !== sid) continue;
        try {
          other.emit("session superseded", {});
          other.disconnect(true);
        } catch (_) {}
      }
    }

    // ── Staff key leak watch ────────────────────────────────────────────
    // A dev/mod key is the only proof of role, so a shared or stolen key is
    // the real risk. Raise a dev-only alert in the audit feed when the same
    // key is active from more than one IP at once (the strongest signal), or
    // when it is used from an IP it has never connected from before.
    if ((socket.isDev || socket.isMod) && clientIp) {
      const hash = socket.isDev ? socket.devKeyHash : socket.modKeyHash;
      const role = socket.isDev ? "dev" : "mod";
      const label = socket.staffLabel || role;
      const ips = new Set([clientIp]);
      for (const [, s] of io().sockets.sockets) {
        if (s.id === socket.id) continue;
        const h = s.isDev ? s.devKeyHash : s.isMod ? s.modKeyHash : null;
        if (h && h === hash) ips.add(s.clientIp || s.handshake.address);
      }
      if (ips.size > 1) {
        audit.recordKeyAlert({
          role,
          label,
          ip: clientIp,
          kind: "concurrent",
          detail: `The ${role} key "${label}" is in use from ${ips.size} IPs at the same time: ${[...ips].join(", ")}`,
        });
      } else if (socket.keyNewIp) {
        audit.recordKeyAlert({
          role,
          label,
          ip: clientIp,
          kind: "new-ip",
          detail: `The ${role} key "${label}" connected from an IP it has never been used from before`,
        });
      }
    }

    // Wraps handlers so one error cannot crash the process; disconnects
    // sockets that error repeatedly
    function safe(fn) {
      return async (...args) => {
        try {
          await fn(...args);
        } catch (err) {
          console.error(`Socket error [${fn.name || "?"}] ${clientIp}:`, err);
          try {
            socket.emit(
              "error",
              createErrorResponse(
                ERROR_CODES.SERVER_ERROR,
                "Internal server error.",
              ),
            );
            socket._errCount = (socket._errCount || 0) + 1;
            if (socket._errCount > 10) socket.disconnect(true);
          } catch (_) {}
        }
      };
    }

    // ── Check Sign-In Status ────────────────────────────────────────────
    socket.on(
      "check signin status",
      safe(async () => {
        let { username, location, userId, isIPBased } =
          socket.handshake.session || {};
        if (
          !username &&
          CONFIG.FEATURES.ENABLE_IP_BASED_USERS &&
          socket.browserDetection?.isBrowser
        ) {
          const ipUser = createIPBasedUser(socket.clientIp);
          username = ipUser.username;
          location = ipUser.location;
          userId = ipUser.userId;
          isIPBased = true;
          if (socket.handshake.session) {
            Object.assign(socket.handshake.session, {
              username,
              location,
              userId,
              isIPBased: true,
            });
            await promisifySessionSave(socket.handshake.session).catch(
              () => {},
            );
          }
        }
        if (username && location && userId) {
          if (socket.isDev) {
            state.devUsers.add(userId);
          }

          socket.emit("signin status", {
            isSignedIn: true,
            username,
            location,
            userId,
            isIPBased: !!isIPBased,
            isBot: !!socket.isBot,
            isDev: !!socket.isDev,
            isMod: !!socket.isMod,
            isHidden: !!socket.isHidden,
          });
          socket.join("lobby");
          state.users.set(userId, {
            id: userId,
            username,
            location,
            isIPBased,
          });
          updateLobby();
        } else {
          socket.emit("signin status", {
            isSignedIn: false,
            isBot: !!socket.isBot,
            isDev: !!socket.isDev,
            isMod: !!socket.isMod,
          });
        }
      }),
    );

    // ── Join Lobby ──────────────────────────────────────────────────────
    socket.on(
      "join lobby",
      safe(async (data) => {
        if (!data || typeof data !== "object")
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.BAD_REQUEST, "Invalid data."),
          );
        const valErr = validateObject(data, {
          username: { rule: "username" },
          location: { rule: "location" },
        });
        if (valErr) return socket.emit("validation_error", valErr);

        // Identity fields are sanitized (zalgo/RTL stripped) before the
        // word filter runs, so obfuscated slurs are cleaned then caught
        let username = enforceUsernameLimit(sanitizeName(data.username));
        let location = enforceLocationLimit(
          sanitizeName(data.location || "On The Web"),
        );

        // Sanitization can empty a name made entirely of stripped
        // characters; reject instead of admitting a blank user
        if (!username) {
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.VALIDATION_ERROR,
              "Username contains no valid characters.",
            ),
          );
        }
        if (!location) location = "On The Web";

        if (CONFIG.FEATURES.ENABLE_WORD_FILTER) {
          if (wordFilter.checkText(username).hasOffensiveWord)
            return socket.emit(
              "error",
              createErrorResponse(
                ERROR_CODES.VALIDATION_ERROR,
                "Username contains forbidden words.",
              ),
            );
          if (wordFilter.checkText(location).hasOffensiveWord)
            return socket.emit(
              "error",
              createErrorResponse(
                ERROR_CODES.VALIDATION_ERROR,
                "Location contains forbidden words.",
              ),
            );
        }

        // Reserved staff names only validate for connections carrying a
        // dev or mod key, so trolls cannot impersonate staff.
        if (isReservedName(username) && !socket.isDev && !socket.isMod) {
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.VALIDATION_ERROR,
              "That username is reserved. Please choose another.",
            ),
          );
        }

        const userId = socket.handshake.sessionID;
        if (!socket.handshake.session)
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.SERVER_ERROR,
              "Session not available.",
            ),
          );
        Object.assign(socket.handshake.session, {
          username,
          location,
          userId,
          isIPBased: false,
        });
        await promisifySessionSave(socket.handshake.session);
        state.users.set(userId, { id: userId, username, location });

        // Accountability: log the chosen name + IP, and any later change to it
        audit.recordIdentity({
          userId,
          username,
          location,
          ip: socket.clientIp || null,
        });

        if (socket.isDev) {
          state.devUsers.add(userId);
        }

        socket.join("lobby");
        updateLobby();
        socket.emit("signin status", {
          isSignedIn: true,
          username,
          location,
          userId,
          isIPBased: false,
          isBot: !!socket.isBot,
          isDev: !!socket.isDev,
          isMod: !!socket.isMod,
          isHidden: !!socket.isHidden,
        });
      }),
    );

    // ── Talkoboard: stroke lifecycle + state sync ───────────────────────

    socket.on(
      "board open",
      safe(async () => {
        if (!socket.roomId || !socket.handshake.session?.userId) return;
        if (socket.spectating) return; // spectators are read-only
        socket.boardOpen = true;
        clearAFKTimers(socket.handshake.session.userId);

        const bs = getBoardState(socket.roomId);
        const activeObj = {};
        for (const [uid, stroke] of bs.active) {
          activeObj[uid] = stroke;
        }
        socket.emit("board state", {
          strokes: bs.strokes,
          active: activeObj,
        });

        socket.to(socket.roomId).emit("board user status", {
          userId: socket.handshake.session.userId,
          open: true,
        });
      }),
    );

    socket.on(
      "board stroke start",
      safe(async (data) => {
        if (!socket.roomId || !socket.handshake.session?.userId) return;
        if (socket.spectating) return;
        const userId = socket.handshake.session.userId;

        if (
          !data ||
          typeof data.color !== "string" ||
          typeof data.size !== "number"
        )
          return;
        if (
          !data.point ||
          typeof data.point.x !== "number" ||
          typeof data.point.y !== "number"
        )
          return;

        // Optional client-supplied id lets the drawer undo/redo this exact
        // stroke later. Ownership for undo is enforced server-side via `owner`,
        // never by trusting the id, so a forged id can't touch anyone else's work.
        const strokeId =
          typeof data.id === "string" && data.id.length <= 64 ? data.id : null;

        const stroke = {
          id: strokeId,
          owner: userId,
          points: [{ x: data.point.x, y: data.point.y }],
          color: data.color.slice(0, 7),
          size: Math.min(Math.max(data.size, 1), 50),
          eraser: !!data.eraser,
          gradient: data.eraser ? null : sanitizeGradient(data.gradient),
        };

        const bs = getBoardState(socket.roomId);
        finalizeBoardUserStroke(socket.roomId, userId);
        bs.active.set(userId, stroke);

        socket.to(socket.roomId).emit("board stroke start", {
          userId,
          id: stroke.id,
          color: stroke.color,
          size: stroke.size,
          eraser: stroke.eraser,
          gradient: stroke.gradient,
          point: stroke.points[0],
        });
      }),
    );

    socket.on(
      "board stroke move",
      safe(async (data) => {
        if (!socket.roomId || !socket.handshake.session?.userId) return;
        if (socket.spectating) return;
        const userId = socket.handshake.session.userId;

        if (!data?.points || !Array.isArray(data.points)) return;
        if (data.points.length > 200) return;

        const bs = getBoardState(socket.roomId);
        const active = bs.active.get(userId);
        if (!active) return;

        const validPoints = [];
        for (const p of data.points) {
          if (typeof p.x === "number" && typeof p.y === "number") {
            validPoints.push({ x: p.x, y: p.y });
          }
        }
        if (validPoints.length === 0) return;

        active.points.push(...validPoints);

        if (active.points.length > MAX_POINTS_PER_STROKE) {
          active.points = active.points.slice(-MAX_POINTS_PER_STROKE);
        }

        socket.to(socket.roomId).emit("board stroke move", {
          userId,
          points: validPoints,
        });
      }),
    );

    socket.on(
      "board stroke end",
      safe(async () => {
        if (!socket.roomId || !socket.handshake.session?.userId) return;
        if (socket.spectating) return;
        const userId = socket.handshake.session.userId;
        finalizeBoardUserStroke(socket.roomId, userId);
        socket.to(socket.roomId).emit("board stroke end", { userId });
      }),
    );

    // ── Undo: remove one of YOUR OWN completed strokes, board-wide ──────
    socket.on(
      "board stroke remove",
      safe(async (data) => {
        if (!socket.roomId || !socket.handshake.session?.userId) return;
        if (socket.spectating) return;
        const userId = socket.handshake.session.userId;
        const id = data?.id;
        if (typeof id !== "string" || id.length > 64) return;

        const bs = getBoardState(socket.roomId);
        // Ownership enforced here — you can only remove a stroke you own.
        const idx = bs.strokes.findIndex(
          (s) => s.id === id && s.owner === userId,
        );
        if (idx !== -1) {
          bs.strokes.splice(idx, 1);
        } else {
          // Could still be the user's active (unfinished) stroke
          const active = bs.active.get(userId);
          if (active && active.id === id) bs.active.delete(userId);
          else return;
        }
        socket.to(socket.roomId).emit("board stroke remove", { id });
      }),
    );

    // ── Redo: re-add a stroke you previously undid, board-wide ──────────
    socket.on(
      "board stroke add",
      safe(async (data) => {
        if (!socket.roomId || !socket.handshake.session?.userId) return;
        if (socket.spectating) return;
        const userId = socket.handshake.session.userId;
        const s = data?.stroke;
        if (!s || typeof s !== "object") return;
        if (typeof s.id !== "string" || s.id.length > 64) return;
        if (!Array.isArray(s.points) || s.points.length === 0) return;

        const points = [];
        for (const p of s.points) {
          if (typeof p?.x === "number" && typeof p?.y === "number") {
            points.push({ x: p.x, y: p.y });
            if (points.length >= MAX_POINTS_PER_STROKE) break;
          }
        }
        if (points.length === 0) return;

        const stroke = {
          id: s.id,
          owner: userId,
          points,
          color: typeof s.color === "string" ? s.color.slice(0, 7) : "#000000",
          size: Math.min(Math.max(Number(s.size) || 3, 1), 50),
          eraser: !!s.eraser,
          gradient: s.eraser ? null : sanitizeGradient(s.gradient),
        };

        const bs = getBoardState(socket.roomId);
        if (bs.strokes.some((x) => x.id === stroke.id)) return; // dedupe
        bs.strokes.push(stroke);
        if (bs.strokes.length > MAX_BOARD_STROKES) {
          bs.strokes = bs.strokes.slice(-MAX_BOARD_STROKES);
        }
        socket.to(socket.roomId).emit("board stroke add", { userId, stroke });
      }),
    );

    socket.on(
      "board close",
      safe(async () => {
        if (!socket.roomId || !socket.handshake.session?.userId) return;
        const userId = socket.handshake.session.userId;
        socket.boardOpen = false;
        finalizeBoardUserStroke(socket.roomId, userId);
        setupAFKTimers(socket, userId);
        socket.to(socket.roomId).emit("board user status", {
          userId,
          open: false,
        });
      }),
    );

    socket.on(
      "board cursor",
      safe(async (data) => {
        if (!socket.roomId || !socket.handshake.session?.userId) return;
        if (socket.spectating) return;
        if (typeof data?.x !== "number" || typeof data?.y !== "number") return;
        socket.to(socket.roomId).emit("board cursor", {
          userId: socket.handshake.session.userId,
          username: socket.handshake.session.username || "Anonymous",
          x: data.x,
          y: data.y,
        });
      }),
    );

    socket.on(
      "board chat",
      safe(async (data) => {
        if (!socket.roomId || !socket.handshake.session?.userId) return;
        if (socket.spectating) return;
        if (!data?.text || typeof data.text !== "string") return;
        const text = data.text.slice(0, 200);
        io()
          .to(socket.roomId)
          .emit("board chat", {
            userId: socket.handshake.session.userId,
            username: socket.handshake.session.username || "Anonymous",
            text,
            timestamp: Date.now(),
          });
      }),
    );

    socket.on(
      "board clear",
      safe(async () => {
        if (!socket.roomId || !socket.handshake.session?.userId) return;
        // Talkoboard clear is staff-only.
        if (!socket.isDev && !socket.isMod) return;
        const bs = boardState.get(socket.roomId);
        if (bs) {
          bs.strokes = [];
          bs.active.clear();
        }
        io().to(socket.roomId).emit("board clear");
        const room = state.rooms.get(socket.roomId);
        logStaff(socket, "clear board", null, room);
      }),
    );

    // ── Create Room ─────────────────────────────────────────────────────
    socket.on(
      "create room",
      safe(async (data) => {
        if (!data || typeof data !== "object")
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.BAD_REQUEST, "Invalid data."),
          );
        const userId = socket.handshake.session?.userId;
        if (!userId)
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.UNAUTHORIZED,
              "Sign in to create a room.",
            ),
          );

        // Maintenance mode and the live room-creation flag block new rooms for
        // everyone but staff.
        const creatorIsStaff = !!socket.isDev || !!socket.isMod;
        if (state.maintenance && !creatorIsStaff)
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.FORBIDDEN,
              "Talkomatic is in maintenance mode. Creating new rooms is paused " +
                "while people finish their conversations.",
              null,
              true,
            ),
          );
        if (!CONFIG.FEATURES.ENABLE_ROOM_CREATION && !creatorIsStaff)
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.FORBIDDEN,
              "Room creation is temporarily disabled.",
              null,
              true,
            ),
          );

        const valErr = validateObject(data, {
          name: { rule: "roomName" },
          type: { rule: "roomType" },
          layout: { rule: "layout" },
          accessCode: { rule: "accessCode", context: data.type },
        });
        if (valErr) return socket.emit("validation_error", valErr);

        const { username, location } = socket.handshake.session;
        if (
          normalize(username) === "anonymous" &&
          normalize(location) === "on the web"
        )
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.FORBIDDEN,
              "Anonymous users cannot create rooms.",
            ),
          );

        if (state.rooms.size >= CONFIG.LIMITS.HARD_MAX_ROOMS) {
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.ROOM_LIMIT_REACHED,
              "Server is at maximum capacity. Please try again shortly.",
            ),
          );
        }

        const healthyCount = getHealthyRoomCount();
        const limit = calculateCurrentRoomLimit();
        if (healthyCount >= limit) {
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.ROOM_LIMIT_REACHED,
              `Room limit reached (${limit}). Try again in a moment.`,
            ),
          );
        }

        if (
          getUsernameLocationRoomsCount(username, location, userId) >=
          CONFIG.LIMITS.MAX_ROOMS_PER_USER
        )
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.FORBIDDEN, "Already in a room."),
          );
        if (getUserRoomsCount(userId) >= CONFIG.LIMITS.MAX_ROOMS_PER_USER)
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.FORBIDDEN, "Already in a room."),
          );

        const now = Date.now();
        if (
          now - (state.lastRoomCreationTimes.get(userId) || 0) <
          CONFIG.TIMING.ROOM_CREATION_COOLDOWN
        )
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.RATE_LIMITED,
              "Creating rooms too fast.",
            ),
          );

        const ipRoomCount = getRoomCountByIP(clientIp);
        if (ipRoomCount >= CONFIG.LIMITS.MAX_ROOMS_PER_IP) {
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.RATE_LIMITED,
              "Too many rooms from this connection.",
            ),
          );
        }

        const lastIpCreation = state.ipLastRoomCreation.get(clientIp) || 0;
        if (now - lastIpCreation < CONFIG.LIMITS.IP_ROOM_CREATION_COOLDOWN) {
          const waitSec = Math.ceil(
            (CONFIG.LIMITS.IP_ROOM_CREATION_COOLDOWN - (now - lastIpCreation)) /
              1000,
          );
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.RATE_LIMITED,
              `Please wait ${waitSec}s before creating another room.`,
            ),
          );
        }

        // Room names get the same zalgo/RTL sanitization as usernames
        let roomName = enforceRoomNameLimit(sanitizeName(data.name));
        if (!roomName) {
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.VALIDATION_ERROR,
              "Room name contains no valid characters.",
            ),
          );
        }
        if (roomNameExists(roomName))
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.ROOM_NAME_EXISTS,
              "Room name already exists.",
            ),
          );
        if (
          CONFIG.FEATURES.ENABLE_WORD_FILTER &&
          wordFilter.checkText(roomName).hasOffensiveWord
        )
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.VALIDATION_ERROR,
              "Room name contains forbidden words.",
            ),
          );

        state.lastRoomCreationTimes.set(userId, now);
        state.ipLastRoomCreation.set(clientIp, now);

        let roomId,
          attempts = 0;
        do {
          roomId = generateRoomId();
          attempts++;
          if (attempts > CONFIG.LIMITS.MAX_ID_GEN_ATTEMPTS)
            return socket.emit(
              "error",
              createErrorResponse(
                ERROR_CODES.SERVER_ERROR,
                "Could not generate room ID.",
              ),
            );
        } while (state.rooms.has(roomId));

        state.rooms.set(roomId, {
          id: roomId,
          name: roomName,
          type: data.type,
          layout: data.layout,
          users: [],
          accessCode: data.type === "semi-private" ? data.accessCode : null,
          votes: {},
          bannedUserIds: new Set(),
          lastActiveTime: now,
          createdAt: now,
        });

        // Creator's access code is validated into the session up front,
        // so the room page can join without the code in the URL
        if (data.type === "semi-private" && data.accessCode) {
          if (!socket.handshake.session.validatedRooms)
            socket.handshake.session.validatedRooms = {};
          socket.handshake.session.validatedRooms[roomId] = data.accessCode;
          await promisifySessionSave(socket.handshake.session).catch(() => {});
        }

        state.apiCache.delete("public_rooms");
        socket.emit("room created", roomId);
        updateLobby();
        await debouncedSaveRooms();
        const stats = getRoomStatistics();
        console.log(
          `Room created: ${roomId} (${roomName}) by IP:${clientIp} | ` +
            `Total: ${stats.totalRooms}/${stats.hardCap} | ` +
            `Healthy: ${stats.healthyRooms}/${stats.currentLimit} | ` +
            `Solo TTL: ${stats.currentSoloTTL}s`,
        );
      }),
    );

    // ── Join Room ───────────────────────────────────────────────────────
    socket.on(
      "join room",
      safe(async (data) => {
        if (!data?.roomId)
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.BAD_REQUEST, "Invalid data."),
          );
        const room = state.rooms.get(data.roomId);
        if (!room)
          return socket.emit(
            "room not found",
            createErrorResponse(ERROR_CODES.NOT_FOUND, "Room not found."),
          );

        let { username, location, userId } = socket.handshake.session || {};
        if (!userId) {
          userId = socket.handshake.sessionID;
          if (socket.handshake.session) {
            socket.handshake.session.userId = userId;
            if (!username) socket.handshake.session.username = "Anonymous";
            if (!location) socket.handshake.session.location = "On The Web";
          } else
            return socket.emit(
              "error",
              createErrorResponse(ERROR_CODES.SERVER_ERROR, "Session error."),
            );
        }
        username = username || "Anonymous";
        location = location || "On The Web";

        const isAnon = username === "Anonymous" && location === "On The Web";
        if (!isAnon) {
          const cur = getUserCurrentRoom(userId);
          if (cur && cur !== data.roomId) {
            const n = state.rooms.get(cur)?.name || "Unknown";
            return socket.emit(
              "error",
              createErrorResponse(
                ERROR_CODES.FORBIDDEN,
                `Already in "${n}". Leave first.`,
                { currentRoomId: cur, currentRoomName: n },
                true,
              ),
            );
          }
        }

        // Semi-private rooms: session-validated codes skip the prompt.
        // Staff bypass the code entirely (join bypass only — the codes
        // themselves remain hidden from mods).
        if (room.type === "semi-private" && !socket.isDev && !socket.isMod) {
          const validated =
            socket.handshake.session.validatedRooms?.[data.roomId];
          let code = data.accessCode;
          if (validated) code = validated;
          else if (!code) return socket.emit("access code required");
          if (
            typeof code !== "string" ||
            code.length !== 6 ||
            !/^\d+$/.test(code)
          )
            return socket.emit(
              "error",
              createErrorResponse(
                ERROR_CODES.VALIDATION_ERROR,
                "Invalid access code format.",
              ),
            );
          if (room.accessCode !== code)
            return socket.emit(
              "error",
              createErrorResponse(
                ERROR_CODES.FORBIDDEN,
                "Incorrect access code.",
              ),
            );
          if (!validated && socket.handshake.session) {
            if (!socket.handshake.session.validatedRooms)
              socket.handshake.session.validatedRooms = {};
            socket.handshake.session.validatedRooms[data.roomId] = code;
            await promisifySessionSave(socket.handshake.session).catch(
              () => {},
            );
          }
        }
        joinRoom(socket, data.roomId, userId);
      }),
    );

    // ── Vote Kick ───────────────────────────────────────────────────────
    socket.on(
      "vote",
      safe(async (data) => {
        if (!data?.targetUserId) return;
        const userId = socket.handshake.session?.userId;
        const roomId = socket.roomId;
        if (!roomId || !userId) return;
        const room = state.rooms.get(roomId);
        if (
          !room ||
          !room.users.find((u) => u.id === userId) ||
          userId === data.targetUserId
        )
          return;
        // Votes are only accepted at or above the minimum room size
        if (room.users.length < CONFIG.LIMITS.MIN_USERS_FOR_VOTING) return;
        if (!room.users.find((u) => u.id === data.targetUserId)) return;
        // Staff cannot be vote-kicked — mods and devs are immune.
        if (getUserStaffRole(data.targetUserId)) return;
        if (!room.votes) room.votes = {};
        if (room.votes[userId] === data.targetUserId) delete room.votes[userId];
        else room.votes[userId] = data.targetUserId;
        emitRoomVoteUpdates(roomId);
        const votesAgainst = Object.values(room.votes).filter(
          (v) => v === data.targetUserId,
        ).length;
        if (votesAgainst > Math.floor(room.users.length / 2)) {
          const target = findSocketByUserId(data.targetUserId, roomId);
          if (target) {
            target.emit("kicked");
            if (!room.bannedUserIds) room.bannedUserIds = new Set();
            room.bannedUserIds.add(data.targetUserId);
            await leaveRoom(target, data.targetUserId);
          }
        }
      }),
    );

    socket.on(
      "leave room",
      safe(async () => {
        const userId = socket.handshake.session?.userId;
        if (userId) {
          clearAFKTimers(userId);
          await leaveRoom(socket, userId);
        }
      }),
    );

    // ── Chat Updates (diff-based, batched) ──────────────────────────────
    socket.on(
      "chat update",
      safe(async (data) => {
        if (!checkChatCircuit())
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.CIRCUIT_OPEN,
              "System temporarily unavailable.",
            ),
          );
        if (!socket.roomId || !socket.handshake.session?.userId) return;
        // Spectators are read-only; frozen users are input-locked by staff.
        if (socket.spectating) return;
        if (socket.frozen) return;
        const userId = socket.handshake.session.userId;
        if (!data?.diff || typeof data.diff !== "object")
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.BAD_REQUEST, "Invalid chat data."),
          );
        const { diff } = data;
        if (!["full-replace", "add", "delete", "replace"].includes(diff.type))
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.BAD_REQUEST, "Unknown diff type."),
          );
        if (
          (diff.type === "add" ||
            diff.type === "replace" ||
            diff.type === "full-replace") &&
          typeof diff.text !== "string"
        )
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.BAD_REQUEST,
              "Diff text must be string.",
            ),
          );
        if (diff.text) diff.text = enforceCharacterLimit(diff.text);
        if (
          diff.type !== "full-replace" &&
          (typeof diff.index !== "number" || diff.index < 0)
        )
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.BAD_REQUEST, "Invalid diff index."),
          );
        if (
          diff.type === "delete" &&
          (typeof diff.count !== "number" || diff.count < 0)
        )
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.BAD_REQUEST,
              "Invalid delete count.",
            ),
          );

        if (!state.pendingChatUpdates.has(userId))
          state.pendingChatUpdates.set(userId, { diffs: [] });
        state.pendingChatUpdates.get(userId).diffs.push(diff);
        if (!state.batchProcessingTimers.has(userId)) {
          state.batchProcessingTimers.set(
            userId,
            setTimeout(
              () => processPendingChatUpdates(userId, socket),
              getBatchInterval(socket.roomId),
            ),
          );
        }
      }),
    );

    socket.on(
      "typing",
      safe(async (data) => {
        if (!socket.roomId || !socket.handshake.session?.userId) return;
        if (socket.spectating || socket.frozen) return;
        const userId = socket.handshake.session.userId;
        const username = socket.handshake.session.username || "Anonymous";
        if (data?.isTyping === false) {
          handleTyping(socket, userId, username, false);
          return;
        }
        await typingLimiter.consume(userId).catch(() => {});
        if (!data || typeof data.isTyping !== "boolean") return;
        handleTyping(socket, userId, username, data.isTyping);
      }),
    );

    socket.on(
      "get rooms",
      safe(async () => {
        const data = Array.from(state.rooms.values())
          .filter((r) => r.type !== "private")
          .map((r) => formatRoomForSocket(r, socket));

        socket.emit("initial rooms", data);
        socket.emit("lobby ticker", { message: state.lobbyTicker || "" });
        socket.emit("maintenance status", { enabled: state.maintenance });

        if (socket.isDev) {
          const codes = {};
          for (const [roomId, room] of state.rooms) {
            if (room.type === "semi-private" && room.accessCode) {
              codes[roomId] = room.accessCode;
            }
          }
          socket.emit("dev lobby context", codes);
        }
      }),
    );

    // ── Anniversary celebration (public) ────────────────────────────────
    socket.on(
      "get anniversary",
      safe(async () => {
        socket.emit("anniversary count", { count: anniversaryCount });
      }),
    );
    socket.on(
      "celebrate",
      safe(async () => {
        if (socket.celebrated) return; // one celebration per connection
        socket.celebrated = true;
        anniversaryCount++;
        saveAnniversary();
        if (io()) io().emit("anniversary count", { count: anniversaryCount });
      }),
    );

    socket.on(
      "get room state",
      safe(async (roomId) => {
        if (!roomId || typeof roomId !== "string")
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.BAD_REQUEST, "Room ID required."),
          );
        const room = state.rooms.get(roomId);
        if (!room)
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.NOT_FOUND, "Room not found."),
          );
        socket.emit("room state", formatRoomStateForSocket(room, socket));
      }),
    );

    // ── Dev Mode: Force-Kick ────────────────────────────────────────────
    socket.on(
      "dev force kick",
      safe(async (data) => {
        if (!socket.isDev) {
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.FORBIDDEN, "Access denied."),
          );
        }

        if (!data?.targetUserId || typeof data.targetUserId !== "string") {
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.BAD_REQUEST,
              "targetUserId required.",
            ),
          );
        }

        if (!canActOn(socket, data.targetUserId)) {
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.FORBIDDEN,
              "You cannot act on this user.",
            ),
          );
        }

        const targetUserId = data.targetUserId;
        let targetRoomId = null;
        let targetRoom = null;
        for (const [roomId, room] of state.rooms) {
          if (room.users && room.users.some((u) => u.id === targetUserId)) {
            targetRoomId = roomId;
            targetRoom = room;
            break;
          }
        }

        if (!targetRoom) {
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.NOT_FOUND,
              "User not found in any room.",
            ),
          );
        }

        const targetSocket = findSocketByUserId(targetUserId, targetRoomId);
        if (!targetSocket) {
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.NOT_FOUND,
              "User socket not found.",
            ),
          );
        }

        const targetUser = targetRoom.users.find((u) => u.id === targetUserId);
        const targetName = targetUser?.username || "Unknown";
        const roomName = targetRoom.name || targetRoomId;

        targetSocket.emit("kicked");
        await leaveRoom(targetSocket, targetUserId);

        console.log(
          `[DEV] Force-kicked "${targetName}" from "${roomName}" by dev user`,
        );

        socket.emit("dev kick success", {
          targetUserId,
          targetUsername: targetName,
          roomId: targetRoomId,
          roomName,
        });
      }),
    );

    // ── Dev Mode: Set Username Color ────────────────────────────────────
    socket.on(
      "dev set color",
      safe(async (data) => {
        if (!socket.isDev) return;
        if (!data?.color || typeof data.color !== "string") return;
        if (!/^#[0-9a-fA-F]{6}$/.test(data.color)) return;

        const userId = socket.handshake.session?.userId;
        if (!userId || !socket.roomId) return;

        const room = state.rooms.get(socket.roomId);
        if (!room) return;

        const user = room.users.find((u) => u.id === userId);
        if (user) {
          user.devColor = data.color;
        }

        updateRoom(socket.roomId);
      }),
    );

    // ── Dev Mode: Vanish (invisible to non-devs) ────────────────────────
    socket.on(
      "dev set vanish",
      safe(async (data) => {
        if (!socket.isDev) return;
        const desired =
          typeof data?.isVanished === "boolean"
            ? data.isVanished
            : !socket.isVanished;

        socket.isVanished = desired;

        const userId = socket.handshake.session?.userId;
        if (userId && socket.roomId) {
          const room = state.rooms.get(socket.roomId);
          const user = room?.users?.find((u) => u.id === userId);
          if (user) user.isVanished = desired;
          updateRoom(socket.roomId);
          updateLobby();
          sendDevRoomContext(socket.roomId);
        }
        socket.emit("dev vanish status", { isVanished: desired });
      }),
    );

    // ── Staff: Hide Flair (dev crown or mod badge) ──────────────────────
    socket.on(
      "dev set hide",
      safe(async (data) => {
        if (!socket.isDev && !socket.isMod) return;
        const desired =
          typeof data?.isHidden === "boolean"
            ? data.isHidden
            : !socket.isHidden;

        socket.isHidden = desired;

        if (socket.handshake?.session) {
          socket.handshake.session.isDevHidden = desired;
          await promisifySessionSave(socket.handshake.session).catch(() => {});
        }

        const userId = socket.handshake.session?.userId;
        if (userId && socket.roomId) {
          const room = state.rooms.get(socket.roomId);
          const user = room?.users?.find((u) => u.id === userId);
          if (user) user.isHidden = desired;
          updateRoom(socket.roomId);
          updateLobby();
          sendDevRoomContext(socket.roomId);
        }
        socket.emit("dev hide status", { isHidden: desired });
      }),
    );

    // ════════════════════════════════════════════════════════════════════
    // STAFF ACTIONS (mod + dev). Every handler validates role by the key
    // hash set in the socket middleware and enforces the hierarchy.
    // ════════════════════════════════════════════════════════════════════

    // ── Kick + room ban (mod + dev) ─────────────────────────────────────
    socket.on(
      "staff kick",
      safe(async (data) => {
        if (!requireStaff(socket)) return;
        const targetUserId = data?.targetUserId;
        if (!targetUserId || typeof targetUserId !== "string")
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.BAD_REQUEST,
              "targetUserId required.",
            ),
          );
        if (!canActOn(socket, targetUserId))
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.FORBIDDEN,
              "You cannot act on this user.",
            ),
          );
        const roomId = getUserCurrentRoom(targetUserId);
        const room = roomId ? state.rooms.get(roomId) : null;
        if (!room)
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.NOT_FOUND,
              "User not found in any room.",
            ),
          );
        const targetUser = room.users.find((u) => u.id === targetUserId);
        const ban = data.ban !== false; // room ban on kick by default
        if (ban) {
          if (!room.bannedUserIds) room.bannedUserIds = new Set();
          room.bannedUserIds.add(targetUserId);
        }
        const targetSocket = findSocketByUserId(targetUserId, roomId);
        if (targetSocket) {
          targetSocket.emit("kicked", {
            message: "You were removed from this room by staff.",
          });
          await leaveRoom(targetSocket, targetUserId);
        } else {
          room.users = room.users.filter((u) => u.id !== targetUserId);
          updateRoom(roomId);
          updateRoomSoloTracking(roomId);
          updateLobby();
        }
        logStaff(socket, ban ? "kick+ban" : "kick", targetUser, room);
        socket.emit("staff action result", {
          action: "kick",
          ok: true,
          targetUserId,
          username: targetUser?.username,
          ban,
          roomId,
        });
      }),
    );

    // ── IP block with duration picker (mod ≤ 7d, dev any/permanent) ─────
    socket.on(
      "staff ip block",
      safe(async (data) => {
        if (!requireStaff(socket)) return;
        const targetUserId = data?.targetUserId;
        const duration = data?.duration;
        if (!targetUserId)
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.BAD_REQUEST,
              "targetUserId required.",
            ),
          );
        if (!canActOn(socket, targetUserId))
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.FORBIDDEN,
              "You cannot act on this user.",
            ),
          );
        const DURATIONS = {
          "1h": 3600000,
          "24h": 86400000,
          "7d": 604800000,
        };
        let ms;
        if (duration === "permanent") {
          if (!socket.isDev)
            return socket.emit(
              "error",
              createErrorResponse(
                ERROR_CODES.FORBIDDEN,
                "Only devs can place permanent IP blocks.",
              ),
            );
          ms = Infinity;
        } else if (DURATIONS[duration] !== undefined) {
          ms = DURATIONS[duration];
        } else {
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.BAD_REQUEST,
              "Invalid duration. Use 1h, 24h, 7d" +
                (socket.isDev ? ", or permanent." : "."),
            ),
          );
        }
        const targetSocket = findSocketsByUserId(targetUserId)[0];
        const ip = targetSocket?.clientIp;
        if (!ip)
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.NOT_FOUND,
              "Could not determine the user's IP.",
            ),
          );
        const expiry =
          ms === Infinity ? Number.MAX_SAFE_INTEGER : Date.now() + ms;
        const roomId = getUserCurrentRoom(targetUserId);
        const room = roomId ? state.rooms.get(roomId) : null;
        const targetUser = room?.users.find((u) => u.id === targetUserId);
        const blockedName =
          targetUser?.username ||
          targetSocket?.handshake?.session?.username ||
          null;
        const reason =
          sanitizeMessage(
            typeof data?.reason === "string" ? data.reason : "",
          ).slice(0, 500) || null;
        state.blockedIPs.set(ip, {
          expiry,
          label: blockedName,
          by: socket.staffLabel || null,
          ts: Date.now(),
          reason,
        });

        for (const s of findSocketsByIp(ip)) {
          try {
            const uid = s.handshake?.session?.userId;
            s.emit("kicked", {
              message: "Your connection has been blocked by staff.",
            });
            if (s.roomId && uid) await leaveRoom(s, uid);
            s.disconnect(true);
          } catch (_) {}
        }
        logStaff(
          socket,
          `ip block ${duration}`,
          targetUser || { id: targetUserId },
          room || "-",
          reason || undefined,
        );
        socket.emit("staff action result", {
          action: "ip block",
          ok: true,
          targetUserId,
          duration,
        });
      }),
    );

    // ── Close room: kick everyone and delete (mod + dev) ────────────────
    socket.on(
      "staff close room",
      safe(async (data) => {
        if (!requireStaff(socket)) return;
        const roomId = data?.roomId || socket.roomId;
        const room = roomId ? state.rooms.get(roomId) : null;
        if (!room)
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.NOT_FOUND, "Room not found."),
          );
        const roomLabel = { id: room.id, name: room.name };
        const userIds = (room.users || []).map((u) => u.id);
        for (const uid of userIds) {
          const s = findSocketByUserId(uid, roomId);
          if (s) {
            s.emit("kicked", {
              message: "This room was closed by staff.",
            });
            await leaveRoom(s, uid);
          }
        }
        state.rooms.delete(roomId);
        state.roomSoloSince.delete(roomId);
        state.roomLastChatActivity.delete(roomId);
        cleanupBoardState(roomId);
        if (state.roomDeletionTimers.has(roomId)) {
          clearTimeout(state.roomDeletionTimers.get(roomId));
          state.roomDeletionTimers.delete(roomId);
        }
        for (const [, s] of io().sockets.sockets) {
          if (s.spectating === roomId) {
            s.emit("spectate ended", { reason: "closed" });
            s.leave(roomId);
            s.spectating = null;
            s.roomId = null;
            s.join("lobby");
          }
        }
        state.apiCache.delete("public_rooms");
        updateLobby();
        await debouncedSaveRooms();
        logStaff(socket, "close room", null, roomLabel);
        socket.emit("staff action result", {
          action: "close room",
          ok: true,
          roomId,
        });
      }),
    );

    // ── Wipe user buffer: clear typed content for everyone (mod + dev) ──
    socket.on(
      "staff wipe buffer",
      safe(async (data) => {
        if (!requireStaff(socket)) return;
        const targetUserId = data?.targetUserId;
        if (!targetUserId)
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.BAD_REQUEST,
              "targetUserId required.",
            ),
          );
        if (!canActOn(socket, targetUserId))
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.FORBIDDEN,
              "You cannot act on this user.",
            ),
          );
        const roomId = getUserCurrentRoom(targetUserId);
        const room = roomId ? state.rooms.get(roomId) : null;
        if (!room)
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.NOT_FOUND,
              "User not found in any room.",
            ),
          );
        const targetUser = room.users.find((u) => u.id === targetUserId);
        state.userMessageBuffers.set(targetUserId, "");
        if (state.batchProcessingTimers.has(targetUserId)) {
          clearTimeout(state.batchProcessingTimers.get(targetUserId));
          state.batchProcessingTimers.delete(targetUserId);
        }
        state.pendingChatUpdates.delete(targetUserId);
        const username = targetUser?.username || "Anonymous";
        const payload = {
          userId: targetUserId,
          username,
          diff: { type: "full-replace", text: "" },
        };
        for (const [, recipient] of io().sockets.sockets) {
          if (!recipient.connected || recipient.roomId !== roomId) continue;
          if (recipient.handshake?.session?.userId === targetUserId) continue;
          if (!canRecipientSeeDevUser(recipient, targetUser)) continue;
          recipient.emit("chat update", payload);
        }
        for (const s of findSocketsByUserId(targetUserId))
          s.emit("buffer wiped", {});
        logStaff(socket, "wipe buffer", targetUser, room);
        socket.emit("staff action result", {
          action: "wipe buffer",
          ok: true,
          targetUserId,
        });
      }),
    );

    // ── Warn user: private toast (mod + dev) ────────────────────────────
    socket.on(
      "staff warn",
      safe(async (data) => {
        if (!requireStaff(socket)) return;
        const targetUserId = data?.targetUserId;
        if (!targetUserId)
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.BAD_REQUEST,
              "targetUserId required.",
            ),
          );
        if (!canActOn(socket, targetUserId))
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.FORBIDDEN,
              "You cannot act on this user.",
            ),
          );
        let message = sanitizeMessage(
          typeof data?.message === "string" ? data.message : "",
        ).slice(0, 1000);
        if (!message) message = "Please follow the room rules.";
        const targets = findSocketsByUserId(targetUserId);
        if (targets.length === 0)
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.NOT_FOUND, "User not connected."),
          );
        for (const s of targets) s.emit("staff warning", { message });
        const roomId = getUserCurrentRoom(targetUserId);
        const room = roomId ? state.rooms.get(roomId) : null;
        const targetUser = room?.users.find((u) => u.id === targetUserId);
        logStaff(
          socket,
          "warn",
          targetUser || { id: targetUserId },
          room || "-",
          message,
        );
        socket.emit("staff action result", {
          action: "warn",
          ok: true,
          targetUserId,
        });
      }),
    );

    // ── Force rename to Anonymous (mod + dev) ───────────────────────────
    socket.on(
      "staff rename",
      safe(async (data) => {
        if (!requireStaff(socket)) return;
        const targetUserId = data?.targetUserId;
        if (!targetUserId)
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.BAD_REQUEST,
              "targetUserId required.",
            ),
          );
        if (!canActOn(socket, targetUserId))
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.FORBIDDEN,
              "You cannot act on this user.",
            ),
          );
        const roomId = getUserCurrentRoom(targetUserId);
        const room = roomId ? state.rooms.get(roomId) : null;
        const targetUser = room?.users.find((u) => u.id === targetUserId);
        if (!room || !targetUser)
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.NOT_FOUND,
              "User not found in any room.",
            ),
          );
        const oldName = targetUser.username;
        targetUser.username = "Anonymous";
        const targetSocket = findSocketByUserId(targetUserId, roomId);
        if (targetSocket?.handshake?.session) {
          targetSocket.handshake.session.username = "Anonymous";
          await promisifySessionSave(targetSocket.handshake.session).catch(
            () => {},
          );
        }
        const existing = state.users.get(targetUserId) || { id: targetUserId };
        state.users.set(targetUserId, {
          ...existing,
          username: "Anonymous",
          location: targetUser.location,
        });
        // Tell the room to relabel that row (room update doesn't relabel)
        for (const [, recipient] of io().sockets.sockets) {
          if (!recipient.connected || recipient.roomId !== roomId) continue;
          if (!canRecipientSeeDevUser(recipient, targetUser)) continue;
          recipient.emit("user renamed", {
            userId: targetUserId,
            username: "Anonymous",
            location: targetUser.location,
          });
        }
        updateRoom(roomId);
        updateLobby();
        logStaff(
          socket,
          `rename (was ${oldName})`,
          { id: targetUserId, username: "Anonymous" },
          room,
        );
        audit.recordForcedRename({
          userId: targetUserId,
          from: oldName,
          ip: targetSocket?.clientIp || null,
          by: `${socket.isDev ? "dev" : "mod"}:${socket.staffLabel || ""}`,
          room: `room:${room.name || "?"}(${room.id || "?"})`,
        });
        socket.emit("staff action result", {
          action: "rename",
          ok: true,
          targetUserId,
        });
      }),
    );

    // ── Lock room: block new joins, keep current users (mod + dev) ──────
    socket.on(
      "staff lock room",
      safe(async (data) => {
        if (!requireStaff(socket)) return;
        const roomId = data?.roomId || socket.roomId;
        const room = roomId ? state.rooms.get(roomId) : null;
        if (!room)
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.NOT_FOUND, "Room not found."),
          );
        const locked =
          typeof data?.locked === "boolean" ? data.locked : !room.locked;
        room.locked = locked;
        updateRoom(roomId);
        io().to(roomId).emit("room lock status", { locked });
        updateLobby();
        logStaff(socket, locked ? "lock room" : "unlock room", null, room);
        socket.emit("staff action result", {
          action: "lock room",
          ok: true,
          roomId,
          locked,
        });
      }),
    );

    // ── Slow mode: throttle the room's broadcast cadence (mod + dev) ────
    socket.on(
      "staff slow mode",
      safe(async (data) => {
        if (!requireStaff(socket)) return;
        const roomId = data?.roomId || socket.roomId;
        const room = roomId ? state.rooms.get(roomId) : null;
        if (!room)
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.NOT_FOUND, "Room not found."),
          );
        const enabled =
          typeof data?.enabled === "boolean" ? data.enabled : !room.slowMode;
        room.slowMode = enabled;
        updateRoom(roomId);
        io().to(roomId).emit("room slow mode", { enabled });
        logStaff(
          socket,
          enabled ? "slow mode on" : "slow mode off",
          null,
          room,
        );
        socket.emit("staff action result", {
          action: "slow mode",
          ok: true,
          roomId,
          enabled,
        });
      }),
    );

    // ── Megaphone: announcement banner to one room or all (dev) ─────────
    socket.on(
      "staff megaphone",
      safe(async (data) => {
        if (!requireDev(socket)) return;
        const message = sanitizeMessage(
          typeof data?.message === "string" ? data.message : "",
        ).slice(0, 300);
        if (!message)
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.BAD_REQUEST, "Message required."),
          );
        const scope = data?.scope === "room" ? "room" : "all";
        const payload = { message, scope };
        if (scope === "room") {
          const roomId = data?.roomId || socket.roomId;
          if (!roomId || !state.rooms.has(roomId))
            return socket.emit(
              "error",
              createErrorResponse(ERROR_CODES.NOT_FOUND, "Room not found."),
            );
          io().to(roomId).emit("megaphone", payload);
          logStaff(
            socket,
            "megaphone (room)",
            null,
            state.rooms.get(roomId),
            message,
          );
        } else {
          io().emit("megaphone", payload);
          logStaff(socket, "megaphone (all)", null, "-", message);
        }
        socket.emit("staff action result", {
          action: "megaphone",
          ok: true,
          scope,
        });
      }),
    );

    // ── Lobby ticker: editable banner at the top of the lobby (dev) ─────
    socket.on(
      "dev set ticker",
      safe(async (data) => {
        if (!requireDev(socket)) return;
        const message = sanitizeMessage(
          typeof data?.message === "string" ? data.message : "",
        ).slice(0, 200);
        state.lobbyTicker = message;
        for (const [, s] of io().sockets.sockets) {
          if (s.connected && s.rooms?.has("lobby"))
            s.emit("lobby ticker", { message });
        }
        logStaff(socket, "set ticker", null, "-", message || "(cleared)");
        socket.emit("staff action result", { action: "ticker", ok: true });
      }),
    );

    // ── Spectate: read-only watch, no slot, no listing (dev + mod) ──────
    // Staff (dev or mod) can watch a room live without taking a slot or
    // appearing. Role is carried in the payload so the client can build the
    // matching staff panel (devs keep full powers, incl. room size). IP
    // context is still dev-only — sendDevRoomContext only targets dev sockets.
    socket.on(
      "staff spectate",
      safe(async (data) => {
        if (!requireStaff(socket)) return;
        const roomId = data?.roomId;
        const room = roomId ? state.rooms.get(roomId) : null;
        if (!room)
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.NOT_FOUND, "Room not found."),
          );
        if (socket.roomId && !socket.spectating)
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.FORBIDDEN,
              "Leave your current room before spectating.",
            ),
          );
        socket.leave("lobby");
        socket.join(roomId);
        socket.spectating = roomId;
        socket.roomId = roomId;
        socket.emit("spectate joined", {
          roomId: room.id,
          roomName: room.name,
          roomType: room.type,
          layout: room.layout,
          isDev: !!socket.isDev,
          isMod: !!socket.isMod,
          locked: !!room.locked,
          slowMode: !!room.slowMode,
          spotlight: !!room.spotlight,
          users: filterUsersForSocket(room.users || [], socket),
          votes: filterVotesForSocket(room, socket),
          currentMessages: filterCurrentMessagesForSocket(room, socket),
        });
        sendDevRoomContext(roomId);
        logStaff(socket, "spectate", null, room);
      }),
    );

    socket.on(
      "staff unspectate",
      safe(async () => {
        if (!socket.spectating) return;
        const roomId = socket.spectating;
        socket.leave(roomId);
        socket.spectating = null;
        socket.roomId = null;
        socket.join("lobby");
        socket.emit("spectate ended", {});
        updateLobby();
      }),
    );

    // ── Freeze: server-side input lock without kicking (dev) ────────────
    socket.on(
      "staff freeze",
      safe(async (data) => {
        if (!requireDev(socket)) return;
        const targetUserId = data?.targetUserId;
        if (!targetUserId)
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.BAD_REQUEST,
              "targetUserId required.",
            ),
          );
        if (!canActOn(socket, targetUserId))
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.FORBIDDEN,
              "You cannot act on this user.",
            ),
          );
        const targets = findSocketsByUserId(targetUserId);
        if (targets.length === 0)
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.NOT_FOUND, "User not connected."),
          );
        const frozen =
          typeof data?.frozen === "boolean" ? data.frozen : !targets[0].frozen;
        for (const s of targets) {
          s.frozen = frozen;
          s.emit("staff frozen", { frozen });
        }
        const roomId = getUserCurrentRoom(targetUserId);
        const room = roomId ? state.rooms.get(roomId) : null;
        const targetUser = room?.users.find((u) => u.id === targetUserId);
        logStaff(
          socket,
          frozen ? "freeze" : "unfreeze",
          targetUser || { id: targetUserId },
          room || "-",
        );
        socket.emit("staff action result", {
          action: "freeze",
          ok: true,
          targetUserId,
          frozen,
        });
      }),
    );

    // ── Party mode: confetti + party horn for the whole room (dev) ──────
    socket.on(
      "staff party",
      safe(async (data) => {
        if (!requireDev(socket)) return;
        const roomId = data?.roomId || socket.roomId;
        const room = roomId ? state.rooms.get(roomId) : null;
        if (!room)
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.NOT_FOUND, "Room not found."),
          );
        io().to(roomId).emit("party mode", {});
        logStaff(socket, "party mode", null, room);
        socket.emit("staff action result", {
          action: "party",
          ok: true,
          roomId,
        });
      }),
    );

    // ── Spotlight: pin a room to the top with an "Official" badge (dev) ─
    socket.on(
      "staff spotlight",
      safe(async (data) => {
        if (!requireDev(socket)) return;
        const roomId = data?.roomId;
        const room = roomId ? state.rooms.get(roomId) : null;
        if (!room)
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.NOT_FOUND, "Room not found."),
          );
        const on =
          typeof data?.on === "boolean" ? data.on : !room.spotlight;
        room.spotlight = on;
        updateRoom(roomId);
        updateLobby();
        logStaff(socket, on ? "spotlight on" : "spotlight off", null, room);
        socket.emit("staff action result", {
          action: "spotlight",
          ok: true,
          roomId,
          on,
        });
      }),
    );

    // ── Live feature flags (dev) ────────────────────────────────────────
    socket.on(
      "dev get flags",
      safe(async () => {
        if (!requireDev(socket)) return;
        socket.emit("dev flags", {
          wordFilter: CONFIG.FEATURES.ENABLE_WORD_FILTER,
          roomCreation: CONFIG.FEATURES.ENABLE_ROOM_CREATION,
          baseMaxRooms: CONFIG.LIMITS.BASE_MAX_ROOMS,
          maxRoomCapacity: CONFIG.LIMITS.MAX_ROOM_CAPACITY,
          maintenance: state.maintenance,
        });
      }),
    );

    socket.on(
      "dev set flags",
      safe(async (data) => {
        if (!requireDev(socket)) return;
        if (typeof data?.wordFilter === "boolean")
          CONFIG.FEATURES.ENABLE_WORD_FILTER = data.wordFilter;
        if (typeof data?.roomCreation === "boolean")
          CONFIG.FEATURES.ENABLE_ROOM_CREATION = data.roomCreation;
        if (
          typeof data?.baseMaxRooms === "number" &&
          data.baseMaxRooms >= 1 &&
          data.baseMaxRooms <= CONFIG.LIMITS.HARD_MAX_ROOMS
        )
          CONFIG.LIMITS.BASE_MAX_ROOMS = Math.floor(data.baseMaxRooms);
        let capacityChanged = false;
        if (
          typeof data?.maxRoomCapacity === "number" &&
          data.maxRoomCapacity >= 2 &&
          data.maxRoomCapacity <= 50
        ) {
          CONFIG.LIMITS.MAX_ROOM_CAPACITY = Math.floor(data.maxRoomCapacity);
          capacityChanged = true;
        }
        state.apiCache.delete("config");
        state.apiCache.delete("public_rooms");
        const flags = {
          wordFilter: CONFIG.FEATURES.ENABLE_WORD_FILTER,
          roomCreation: CONFIG.FEATURES.ENABLE_ROOM_CREATION,
          baseMaxRooms: CONFIG.LIMITS.BASE_MAX_ROOMS,
          maxRoomCapacity: CONFIG.LIMITS.MAX_ROOM_CAPACITY,
          maintenance: state.maintenance,
        };
        logStaff(socket, "set flags", JSON.stringify(flags), "-");
        // Capacity affects every room's isFull/display — refresh all views.
        updateLobby();
        if (capacityChanged) for (const [rid] of state.rooms) updateRoom(rid);
        socket.emit("dev flags", flags);
        socket.emit("staff action result", {
          action: "flags",
          ok: true,
          flags,
        });
      }),
    );

    // ── Maintenance mode (dev) ──────────────────────────────────────────
    socket.on(
      "dev set maintenance",
      safe(async (data) => {
        if (!requireDev(socket)) return;
        const enabled =
          typeof data?.enabled === "boolean"
            ? data.enabled
            : !state.maintenance;
        state.maintenance = enabled;
        io().emit("maintenance status", { enabled });
        logStaff(
          socket,
          enabled ? "maintenance on" : "maintenance off",
          null,
          "-",
        );
        socket.emit("staff action result", {
          action: "maintenance",
          ok: true,
          enabled,
        });
      }),
    );

    // ── Dev HUD: live server stats on request (dev) ─────────────────────
    socket.on(
      "dev request hud",
      safe(async () => {
        if (!requireDev(socket)) return;
        const mem = process.memoryUsage();
        const stats = getRoomStatistics();
        socket.emit("dev hud stats", {
          sockets: io().sockets.sockets.size,
          rooms: stats.totalRooms,
          users: stats.totalUsers,
          heapMB: Math.round(mem.heapUsed / 1024 / 1024),
          soloTTL: stats.currentSoloTTL,
          boards: boardState.size,
          tokens: state.botTokens.size,
          devs: state.devUsers.size,
        });
      }),
    );

    // ── Nuke: clear all rooms, confirmation required (dev) ──────────────
    socket.on(
      "staff nuke",
      safe(async (data) => {
        if (!requireDev(socket)) return;
        if (data?.confirm !== true)
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.BAD_REQUEST,
              "Nuke requires confirmation.",
            ),
          );
        const roomIds = Array.from(state.rooms.keys());
        for (const roomId of roomIds) {
          const room = state.rooms.get(roomId);
          if (!room) continue;
          const userIds = (room.users || []).map((u) => u.id);
          for (const uid of userIds) {
            const s = findSocketByUserId(uid, roomId);
            if (s) {
              s.emit("kicked", {
                message: "All rooms were cleared by staff.",
              });
              await leaveRoom(s, uid);
            }
          }
          state.rooms.delete(roomId);
          state.roomSoloSince.delete(roomId);
          state.roomLastChatActivity.delete(roomId);
          cleanupBoardState(roomId);
          if (state.roomDeletionTimers.has(roomId)) {
            clearTimeout(state.roomDeletionTimers.get(roomId));
            state.roomDeletionTimers.delete(roomId);
          }
        }
        for (const [, s] of io().sockets.sockets) {
          if (s.spectating) {
            s.emit("spectate ended", { reason: "nuke" });
            s.leave(s.spectating);
            s.spectating = null;
            s.roomId = null;
            s.join("lobby");
          }
        }
        state.apiCache.delete("public_rooms");
        updateLobby();
        await debouncedSaveRooms();
        logStaff(socket, "NUKE all rooms", `${roomIds.length} rooms`, "-");
        socket.emit("staff action result", {
          action: "nuke",
          ok: true,
          rooms: roomIds.length,
        });
      }),
    );

    // ── Clear bot blacklist / unblock an IP (dev) ───────────────────────
    socket.on(
      "dev clear blacklist",
      safe(async () => {
        if (!requireDev(socket)) return;
        const n = state.botBlacklist.size;
        state.botBlacklist.clear();
        logStaff(socket, "clear blacklist", `${n} entries`, "-");
        socket.emit("staff action result", {
          action: "clear blacklist",
          ok: true,
          cleared: n,
        });
      }),
    );

    socket.on(
      "dev list blocks",
      safe(async () => {
        if (!requireDev(socket)) return;
        socket.emit("dev blocks", buildBlockList());
      }),
    );

    // Active staff key sessions (who is connected right now, on which key, from
    // which IPs) plus the full per-key IP history, for the dashboard's Sessions
    // tab and to spot a leaked key. Dev only.
    socket.on(
      "dev get sessions",
      safe(async () => {
        if (!requireDev(socket)) return;
        const byKey = new Map();
        for (const [, s] of io().sockets.sockets) {
          if (!s.isDev && !s.isMod) continue;
          const hash = s.isDev ? s.devKeyHash : s.modKeyHash;
          if (!hash) continue;
          if (!byKey.has(hash))
            byKey.set(hash, {
              hash,
              label: s.staffLabel || (s.isDev ? "dev" : "mod"),
              role: s.isDev ? "dev" : "mod",
              ips: new Set(),
              count: 0,
            });
          const g = byKey.get(hash);
          g.ips.add(s.clientIp || s.handshake.address || "?");
          g.count += 1;
        }
        const sessions = [...byKey.values()].map((g) => ({
          hash: g.hash,
          label: g.label,
          role: g.role,
          ips: [...g.ips],
          sessionCount: g.count,
          multiIp: g.ips.size > 1,
        }));
        socket.emit("dev sessions", {
          sessions,
          history: roles.getKeyActivity(),
        });
      }),
    );

    socket.on(
      "dev unblock ip",
      safe(async (data) => {
        if (!requireDev(socket)) return;
        const ip = typeof data?.ip === "string" ? data.ip.trim() : "";
        if (!ip)
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.BAD_REQUEST, "IP required."),
          );
        const removed = state.blockedIPs.delete(ip);
        state.botBlacklist.delete(ip);
        logStaff(socket, "unblock ip", ip, "-");
        socket.emit("staff action result", {
          action: "unblock ip",
          ok: true,
          ip,
          removed,
        });
        // Refresh the dev panel's live block list
        socket.emit("dev blocks", buildBlockList());
      }),
    );

    // ── Role management: grant / revoke / list mod keys (dev) ───────────
    socket.on(
      "dev grant mod",
      safe(async (data) => {
        if (!requireDev(socket)) return;
        const label = typeof data?.label === "string" ? data.label : "mod";
        const granted = await roles.grantModKey(label);
        logStaff(
          socket,
          "grant mod",
          `${granted.label}(${granted.hash.slice(0, 8)})`,
          "-",
        );
        // Plaintext key is shown to the dev once and never stored
        socket.emit("dev mod granted", {
          key: granted.key,
          hash: granted.hash,
          label: granted.label,
        });
        socket.emit("dev mod keys", roles.listModKeys());
      }),
    );

    socket.on(
      "dev revoke mod",
      safe(async (data) => {
        if (!requireDev(socket)) return;
        const hash = typeof data?.hash === "string" ? data.hash : "";
        if (!hash)
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.BAD_REQUEST, "hash required."),
          );
        const ok = await roles.revokeModKey(hash);
        if (ok) {
          // Live-downgrade any connected socket using this key
          for (const [, s] of io().sockets.sockets) {
            if (s.isMod && s.modKeyHash === hash) {
              s.isMod = false;
              s.modKeyHash = null;
              s.staffLabel = null;
              const uid = s.handshake?.session?.userId;
              if (uid && s.roomId) {
                const room = state.rooms.get(s.roomId);
                const u = room?.users?.find((x) => x.id === uid);
                if (u) {
                  u.isMod = false;
                  updateRoom(s.roomId);
                  updateLobby();
                }
              }
              s.emit("staff revoked", {});
            }
          }
        }
        logStaff(socket, "revoke mod", hash.slice(0, 8), "-");
        socket.emit("dev mod keys", roles.listModKeys());
        socket.emit("staff action result", {
          action: "revoke mod",
          ok,
          hash,
        });
      }),
    );

    socket.on(
      "dev list mod keys",
      safe(async () => {
        if (!requireDev(socket)) return;
        socket.emit("dev mod keys", roles.listModKeys());
      }),
    );

    // ── Accountability board feed (mod + dev) ───────────────────────────
    socket.on(
      "staff get audit",
      safe(async (data) => {
        if (!requireStaff(socket)) return;
        audit.setAuditSub(socket, true);
        const limit = Math.min(Number(data?.limit) || 800, 2000);
        socket.emit("audit snapshot", {
          entries: audit.recent(limit, !!socket.isDev),
          me: {
            role: socket.isDev ? "dev" : "mod",
            label: socket.staffLabel || null,
          },
          roster: {
            devs: roles.listDevKeys().map((d) => d.label),
            mods: roles.listModKeys().map((m) => m.label),
          },
        });
      }),
    );

    socket.on(
      "staff stop audit",
      safe(async () => {
        audit.setAuditSub(socket, false);
      }),
    );

    // ── Comment on a log entry (mod + dev) — for accountability discussion ─
    socket.on(
      "audit comment",
      safe(async (data) => {
        if (!requireStaff(socket)) return;
        const refId = Number(data?.entryId);
        if (!refId) return;
        const text = sanitizeMessage(
          typeof data?.text === "string" ? data.text : "",
        ).slice(0, 500);
        if (!text) return;
        audit.recordComment({
          entryId: refId,
          role: socket.isDev ? "dev" : "mod",
          label: socket.staffLabel || (socket.isDev ? "dev" : "mod"),
          text,
          ip: socket.clientIp || null,
        });
      }),
    );

    // ── Staff key-entry login (no console needed) ───────────────────────
    // Anyone may submit a key; the server says whether it's a dev/mod key so
    // the client can store it. Per-IP throttled to resist brute force.
    socket.on(
      "staff validate key",
      safe(async (data) => {
        const ip = socket.clientIp || "unknown";
        const now = Date.now();
        let rec = staffKeyAttempts.get(ip);
        if (!rec || now > rec.resetAt) {
          rec = { count: 0, resetAt: now + STAFF_KEY_WINDOW };
          staffKeyAttempts.set(ip, rec);
        }
        rec.count++;
        if (rec.count > STAFF_KEY_MAX_ATTEMPTS)
          return socket.emit("staff key result", {
            role: null,
            throttled: true,
          });
        const key = typeof data?.key === "string" ? data.key.trim() : "";
        if (!key) return socket.emit("staff key result", { role: null });
        const v = roles.validateKey(key);
        if (v.role) {
          rec.count = 0; // reset throttle on success
          audit.recordAction({
            roleTag: v.role,
            label: v.label,
            action: "staff key entered (login)",
            ip,
          });
        }
        socket.emit("staff key result", { role: v.role, label: v.label });
      }),
    );

    // ── Promote a connected user to mod, in-site (dev) ──────────────────
    // Generates a mod key and delivers it privately to that user's socket,
    // which stores it and reloads — no manual key hand-off.
    socket.on(
      "dev grant mod to user",
      safe(async (data) => {
        if (!requireDev(socket)) return;
        const targetUserId = data?.targetUserId;
        if (!targetUserId)
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.BAD_REQUEST,
              "targetUserId required.",
            ),
          );
        if (getUserStaffRole(targetUserId))
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.FORBIDDEN,
              "That user is already staff.",
            ),
          );
        const targets = findSocketsByUserId(targetUserId);
        if (targets.length === 0)
          return socket.emit(
            "error",
            createErrorResponse(ERROR_CODES.NOT_FOUND, "User not connected."),
          );
        const roomId = getUserCurrentRoom(targetUserId);
        const room = roomId ? state.rooms.get(roomId) : null;
        const targetUser = room?.users.find((u) => u.id === targetUserId);
        // Clear any votes already cast against them — staff are vote-immune, so
        // stale pre-promotion votes shouldn't linger.
        if (room?.votes) {
          let changed = false;
          for (const vid in room.votes)
            if (room.votes[vid] === targetUserId) {
              delete room.votes[vid];
              changed = true;
            }
          if (changed) emitRoomVoteUpdates(roomId);
        }
        let label =
          (data?.label && String(data.label).trim()) ||
          targetUser?.username ||
          "mod";
        label = label.slice(0, 40);
        const granted = await roles.grantModKey(label);
        for (const s of targets)
          s.emit("you are now mod", { key: granted.key, label: granted.label });
        logStaff(
          socket,
          "grant mod to user",
          targetUser || { id: targetUserId },
          room || "-",
          `label:${granted.label}`,
        );
        socket.emit("staff action result", {
          action: "make mod",
          ok: true,
          targetUserId,
        });
        socket.emit("dev mod keys", roles.listModKeys());
      }),
    );

    // ── Demote: revoke a connected user's mod key by userId (dev) ────────
    // Lets a dev remove a mod from inside a room (the lobby manage-keys list
    // revokes by hash; this revokes by the user you're looking at).
    socket.on(
      "dev revoke mod from user",
      safe(async (data) => {
        if (!requireDev(socket)) return;
        const targetUserId = data?.targetUserId;
        if (!targetUserId)
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.BAD_REQUEST,
              "targetUserId required.",
            ),
          );
        // A dev is never demoted this way; only mods can be removed.
        const targets = findSocketsByUserId(targetUserId);
        const hashes = new Set();
        for (const s of targets)
          if (s.isMod && !s.isDev && s.modKeyHash) hashes.add(s.modKeyHash);
        if (hashes.size === 0)
          return socket.emit(
            "error",
            createErrorResponse(
              ERROR_CODES.NOT_FOUND,
              "That user is not a moderator.",
            ),
          );
        const roomId = getUserCurrentRoom(targetUserId);
        const room = roomId ? state.rooms.get(roomId) : null;
        const targetUser = room?.users.find((u) => u.id === targetUserId);
        for (const hash of hashes) {
          await roles.revokeModKey(hash);
          // Live-downgrade every socket using this key
          for (const [, s] of io().sockets.sockets) {
            if (s.isMod && s.modKeyHash === hash) {
              s.isMod = false;
              s.modKeyHash = null;
              s.staffLabel = null;
              const uid = s.handshake?.session?.userId;
              if (uid && s.roomId) {
                const r = state.rooms.get(s.roomId);
                const u = r?.users?.find((x) => x.id === uid);
                if (u) {
                  u.isMod = false;
                  updateRoom(s.roomId);
                  updateLobby();
                }
              }
              s.emit("staff revoked", {});
            }
          }
        }
        logStaff(
          socket,
          "revoke mod from user",
          targetUser || { id: targetUserId },
          room || "-",
        );
        socket.emit("dev mod keys", roles.listModKeys());
        socket.emit("staff action result", {
          action: "remove mod",
          ok: true,
          targetUserId,
        });
      }),
    );

    // ── AFK Response ────────────────────────────────────────────────────
    socket.on(
      "afk response",
      safe(async () => {
        const userId = socket.handshake.session?.userId;
        if (userId && socket.roomId) setupAFKTimers(socket, userId);
      }),
    );

    // ── Disconnect ──────────────────────────────────────────────────────
    socket.on(
      "disconnect",
      safe(async (reason) => {
        const userId = socket.handshake.session?.userId;
        const username = socket.handshake.session?.username || "Unknown";
        const location = socket.handshake.session?.location || "Unknown";
        if (userId) {
          clearAFKTimers(userId);
          await leaveRoom(socket, userId);
          state.userMessageBuffers.delete(userId);
          state.devUsers.delete(userId);
          if (state.typingTimeouts.has(userId)) {
            clearTimeout(state.typingTimeouts.get(userId));
            state.typingTimeouts.delete(userId);
          }
          if (state.batchProcessingTimers.has(userId)) {
            clearTimeout(state.batchProcessingTimers.get(userId));
            state.batchProcessingTimers.delete(userId);
            state.pendingChatUpdates.delete(userId);
          }
          state.users.delete(userId);
        }
        if (socket.clientIp) {
          const c = state.ipConnections.get(socket.clientIp) || 0;
          if (c > 1) state.ipConnections.set(socket.clientIp, c - 1);
          else state.ipConnections.delete(socket.clientIp);
        }
        console.log(
          `Disconnected: "${username}" from "${location}" (${reason}) IP:${socket.clientIp}${socket.isBot ? " [BOT]" : ""}${socket.isDev ? " [DEV]" : ""}`,
        );
      }),
    );
  });
}

// ── Cleanup Intervals ───────────────────────────────────────────────────────

function startCleanupIntervals() {
  // Pressure cleanup (30s)
  setInterval(async () => {
    try {
      await pressureCleanup();
    } catch (err) {
      console.error("Pressure cleanup error:", err);
    }
  }, CONFIG.LIMITS.PRESSURE_CLEANUP_INTERVAL);

  // Bot detection cleanup (2 min)
  setInterval(() => {
    const now = Date.now();
    for (const [id, attempts] of state.userJoinAttempts.entries()) {
      const valid = attempts.filter(
        (t) => now - t < CONFIG.LIMITS.BOT_DETECTION_WINDOW,
      );
      if (valid.length === 0) state.userJoinAttempts.delete(id);
      else state.userJoinAttempts.set(id, valid);
    }
    for (const [ip, attempts] of state.ipJoinAttempts.entries()) {
      const valid = attempts.filter(
        (t) => now - t < CONFIG.LIMITS.BOT_DETECTION_WINDOW,
      );
      if (valid.length === 0) state.ipJoinAttempts.delete(ip);
      else state.ipJoinAttempts.set(ip, valid);
    }
    for (const [id, data] of state.suspiciousUsers.entries()) {
      if (now - data.firstDetection > CONFIG.TIMING.BOT_BLOCK_DURATION)
        state.suspiciousUsers.delete(id);
    }
  }, 120000);

  // Bot token cleanup (daily)
  setInterval(() => {
    const now = Date.now();
    let expired = 0;
    for (const [token, data] of state.botTokens.entries()) {
      if (now - data.createdAt > CONFIG.TIMING.BOT_TOKEN_EXPIRY) {
        state.botTokens.delete(token);
        expired++;
        const c = state.ipBotTokenCounts.get(data.ip) || 0;
        if (c > 1) state.ipBotTokenCounts.set(data.ip, c - 1);
        else state.ipBotTokenCounts.delete(data.ip);
      }
    }
    if (expired > 0) console.log(`Cleaned ${expired} expired bot tokens`);
  }, CONFIG.TIMING.BOT_TOKEN_CLEANUP_INTERVAL);

  // IP user cleanup (hourly)
  setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [ip, data] of state.ipBasedUsers.entries()) {
      if (now - data.lastSeen > CONFIG.LIMITS.IP_USER_CLEANUP_INTERVAL) {
        state.ipBasedUsers.delete(ip);
        cleaned++;
      }
    }
    if (cleaned > 0) console.log(`Cleaned ${cleaned} inactive IP users`);
  }, CONFIG.LIMITS.IP_USER_CLEANUP_INTERVAL);

  // Resource cleanup (5 min): drop buffers/timers for users no longer in rooms
  setInterval(() => {
    const active = new Set();
    for (const [, room] of state.rooms) {
      if (room.users) room.users.forEach((u) => active.add(u.id));
    }
    for (const id of state.userMessageBuffers.keys()) {
      if (!active.has(id)) state.userMessageBuffers.delete(id);
    }
    for (const id of state.typingTimeouts.keys()) {
      if (!active.has(id)) {
        clearTimeout(state.typingTimeouts.get(id));
        state.typingTimeouts.delete(id);
      }
    }
    for (const id of state.afkTimers.keys()) {
      if (!active.has(id)) clearAFKTimers(id);
    }
  }, 300000);

  // Cache cleanup (3 min)
  setInterval(() => {
    const active = new Set();
    for (const [, room] of state.rooms) {
      if (room.users) room.users.forEach((u) => active.add(u.id));
    }
    for (const id of state.batchProcessingTimers.keys()) {
      if (!active.has(id)) {
        clearTimeout(state.batchProcessingTimers.get(id));
        state.batchProcessingTimers.delete(id);
        state.pendingChatUpdates.delete(id);
      }
    }
    if (state.normalizeCache.size > 1000) {
      Array.from(state.normalizeCache.keys())
        .slice(0, 200)
        .forEach((k) => state.normalizeCache.delete(k));
    }
    const now = Date.now();
    for (const [k, v] of state.apiCache.entries()) {
      if (now - v.timestamp > state.API_CACHE_TTL) state.apiCache.delete(k);
    }
    for (const [ip, ts] of state.ipLastRoomCreation.entries()) {
      if (now - ts > 300000) state.ipLastRoomCreation.delete(ip);
    }
    for (const [ip, rec] of staffKeyAttempts.entries()) {
      if (now > rec.resetAt) staffKeyAttempts.delete(ip);
    }
    for (const roomId of state.roomSoloSince.keys()) {
      if (!state.rooms.has(roomId)) state.roomSoloSince.delete(roomId);
    }
    for (const roomId of state.roomLastChatActivity.keys()) {
      if (!state.rooms.has(roomId)) state.roomLastChatActivity.delete(roomId);
    }
    for (const roomId of boardState.keys()) {
      if (!state.rooms.has(roomId)) boardState.delete(roomId);
    }
  }, 180000);

  // Empty room cleanup (10 min)
  setInterval(async () => {
    const now = Date.now();
    const toDelete = [];
    for (const [id, room] of state.rooms) {
      if (
        (!room.users || room.users.length === 0) &&
        now - room.lastActiveTime > CONFIG.TIMING.ROOM_DELETION_TIMEOUT
      )
        toDelete.push(id);
    }
    for (const id of toDelete) {
      state.rooms.delete(id);
      state.roomSoloSince.delete(id);
      state.roomLastChatActivity.delete(id);
      cleanupBoardState(id);
      if (state.roomDeletionTimers.has(id)) {
        clearTimeout(state.roomDeletionTimers.get(id));
        state.roomDeletionTimers.delete(id);
      }
    }
    if (toDelete.length > 0) {
      updateLobby();
      await debouncedSaveRooms();
      console.log(`Cleaned ${toDelete.length} empty rooms`);
    }
  }, 600000);

  // Ghost user cleanup (1 min): removes room users with no live socket
  setInterval(() => {
    const activeIds = new Set();
    for (const [, s] of io().sockets.sockets) {
      const uid = s.handshake?.session?.userId;
      if (uid) activeIds.add(uid);
    }
    let ghostCount = 0;
    const affectedRooms = [];
    for (const [roomId, room] of state.rooms) {
      if (!room.users || room.users.length === 0) continue;
      const before = room.users.length;
      room.users = room.users.filter((u) => {
        if (!activeIds.has(u.id)) {
          console.log(`Ghost removed: "${u.username}" from "${room.name}"`);
          state.userMessageBuffers.delete(u.id);
          clearAFKTimers(u.id);
          state.devUsers.delete(u.id);
          finalizeBoardUserStroke(roomId, u.id);
          if (state.typingTimeouts.has(u.id)) {
            clearTimeout(state.typingTimeouts.get(u.id));
            state.typingTimeouts.delete(u.id);
          }
          if (state.batchProcessingTimers.has(u.id)) {
            clearTimeout(state.batchProcessingTimers.get(u.id));
            state.batchProcessingTimers.delete(u.id);
            state.pendingChatUpdates.delete(u.id);
          }
          return false;
        }
        return true;
      });
      const removed = before - room.users.length;
      if (removed > 0) {
        ghostCount += removed;
        affectedRooms.push(roomId);
      }
    }
    for (const id of affectedRooms) {
      const r = state.rooms.get(id);
      if (r) {
        updateRoom(id);
        updateRoomSoloTracking(id);
        if (r.users.length === 0) startRoomDeletionTimer(id);
      }
    }
    if (ghostCount > 0) {
      console.log(`Ghost cleanup: removed ${ghostCount} ghost(s)`);
      updateLobby();
      debouncedSaveRooms().catch(() => {});
    }
  }, 60000);

  // Server monitor (2 min): status log and memory pressure relief
  setInterval(() => {
    const mem = process.memoryUsage();
    const stats = getRoomStatistics();
    const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
    console.log(
      `[STATUS] Clients:${io().sockets.sockets.size} ` +
        `Rooms:${stats.totalRooms}/${stats.hardCap} ` +
        `Healthy:${stats.healthyRooms}/${stats.currentLimit} ` +
        `Solo:${stats.soloRooms} TTL:${stats.currentSoloTTL}s ` +
        `Users:${stats.totalUsers} Heap:${heapMB}MB ` +
        `Tokens:${state.botTokens.size} ` +
        `Devs:${state.devUsers.size} ` +
        `Boards:${boardState.size}`,
    );
    if (heapMB > 400) {
      console.warn(`MEMORY WARNING: ${heapMB}MB heap`);
      if (heapMB > 500) {
        for (const [id, msg] of state.userMessageBuffers.entries()) {
          if (msg.length > 1000)
            state.userMessageBuffers.set(id, msg.substring(0, 1000));
        }
        state.normalizeCache.clear();
        state.apiCache.clear();
        if (global.gc) global.gc();
      }
    }
  }, 120000);
}

// ── Ghost Purge (Startup) ───────────────────────────────────────────────────

function purgeAllGhostUsers() {
  let total = 0;
  for (const [roomId, room] of state.rooms) {
    if (room.users && room.users.length > 0) {
      console.log(
        `Startup purge: ${room.users.length} ghost(s) from "${room.name}"`,
      );
      total += room.users.length;
      room.users.forEach((u) => {
        state.userMessageBuffers.delete(u.id);
        clearAFKTimers(u.id);
        state.devUsers.delete(u.id);
      });
      room.users = [];
      room.votes = {};
      room.lastActiveTime = Date.now();
      cleanupBoardState(roomId);
      startRoomDeletionTimer(roomId);
    }
  }
  if (total > 0) {
    console.log(`Startup purge: removed ${total} ghost(s)`);
    debouncedSaveRooms().catch(() => {});
  } else console.log("Startup purge: no ghosts found");
}

// ── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  loadRooms,
  saveRooms,
  debouncedSaveRooms,
  registerSocketHandlers,
  startCleanupIntervals,
  purgeAllGhostUsers,
  updateLobby,
  getRoomStatistics,
  calculateCurrentRoomLimit,
  roomNameExists,
  startRoomDeletionTimer,
  leaveRoom,
  joinRoom,
};
