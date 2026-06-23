// server/invites.js
// Invite tracking + leaderboard credit. Each device gets a short, stable invite
// code; visiting with ?ref=<code> records (once) who referred you. A referral
// only *counts* when the invitee later becomes an active member (real elapsed
// time + engagement, see server/identity.js) AND does not share an IP with the
// inviter - so faking invites is expensive and self-farming on one network
// doesn't pay. Power is never granted automatically: hitting 10 active invites
// only auto-files a (human-reviewed) mod application.
//
// Persisted to invites.json (atomic tmp + rename, debounced), capped, never
// committed.

const path = require("path");
const fs = require("fs");
const fsp = require("fs").promises;
const crypto = require("crypto");

const INV_PATH = path.join(__dirname, "..", "invites.json");
const MAX_DEVICES = 50000;
const MAX_IPS = 8;
const MILESTONE_MOD = 10; // active invites → auto-files a mod application
const MILESTONE_DEV = 100; // a visible stretch goal (never grants anything)

// { codes: { code: deviceId }, devices: { deviceId: {
//     code, referrer, invited:{ inviteeId:{at,credited,ip} }, credited,
//     ips:[], lastSeen } } }
let store = { codes: {}, devices: {} };
let saveTimer = null;
let topThree = []; // deviceIds of the top inviters, for the lobby/room trophies

// Recompute the top 3 inviters for the trophy badges shown by usernames in the
// lobby and rooms. Uses the SAME ordering as leaderboard() so the people with a
// trophy by their name are exactly the top 3 on the board: active invites first
// (active overrides pending), then pending, then total. Anyone who has sent at
// least one invite can place, so the badges and the board always agree.
function recomputeTop() {
  topThree = Object.entries(store.devices)
    .map(([id, d]) => {
      const total = Object.keys(d.invited || {}).length;
      const active = d.credited || 0;
      return { id, active, pending: Math.max(0, total - active), total };
    })
    .filter((x) => x.total > 0)
    .sort(
      (a, b) => b.active - a.active || b.pending - a.pending || b.total - a.total,
    )
    .slice(0, 3)
    .map((x) => x.id);
}

// 1, 2, or 3 if this device is a top inviter, else 0 (for the trophy badge).
function rankBadge(deviceId) {
  if (!deviceId) return 0;
  const i = topThree.indexOf(deviceId);
  return i >= 0 ? i + 1 : 0;
}

function load() {
  try {
    const o = JSON.parse(fs.readFileSync(INV_PATH, "utf8"));
    if (o && typeof o === "object") store = o;
  } catch (err) {
    if (err.code !== "ENOENT") console.error("Error loading invites.json:", err);
  }
  if (!store.codes) store.codes = {};
  if (!store.devices) store.devices = {};
}

function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      prune();
      const tmp = INV_PATH + ".tmp";
      await fsp.writeFile(tmp, JSON.stringify(store), "utf8");
      await fsp.rename(tmp, INV_PATH);
    } catch (e) {
      console.error("invites save failed:", e);
    }
  }, 4000);
}

function genCode(deviceId) {
  const base = crypto
    .createHash("sha256")
    .update("inv:" + deviceId)
    .digest("hex")
    .slice(0, 8);
  let code = base;
  let i = 0;
  while (store.codes[code] && store.codes[code] !== deviceId)
    code = base + (++i).toString(36);
  return code;
}

function ensureDevice(deviceId) {
  if (!deviceId) return null;
  let d = store.devices[deviceId];
  if (!d) {
    const code = genCode(deviceId);
    d = store.devices[deviceId] = {
      code,
      referrer: null,
      invited: {},
      credited: 0,
      ips: [],
      lastSeen: Date.now(),
    };
    store.codes[code] = deviceId;
    saveSoon();
  }
  return d;
}

function codeFor(deviceId) {
  const d = ensureDevice(deviceId);
  return d ? d.code : null;
}

function recordIp(deviceId, ip) {
  const d = ensureDevice(deviceId);
  if (!d) return;
  d.lastSeen = Date.now();
  if (ip && !d.ips.includes(ip)) {
    d.ips.push(ip);
    if (d.ips.length > MAX_IPS) d.ips = d.ips.slice(-MAX_IPS);
  }
  saveSoon();
}

// Record who referred this device - once only, never yourself.
function setReferrer(inviteeDeviceId, code, inviteeIp) {
  if (!inviteeDeviceId || !code) return { ok: false };
  const inviterDeviceId = store.codes[code];
  if (!inviterDeviceId || inviterDeviceId === inviteeDeviceId)
    return { ok: false };
  const invitee = ensureDevice(inviteeDeviceId);
  if (invitee.referrer) return { ok: false, already: true };
  const inviter = ensureDevice(inviterDeviceId);
  invitee.referrer = inviterDeviceId;
  inviter.invited[inviteeDeviceId] = {
    at: Date.now(),
    credited: false,
    ip: inviteeIp || null,
  };
  // A new pending invite can change the top 3 (which now counts pending), so the
  // username trophy badges stay in sync with the board.
  recomputeTop();
  saveSoon();
  return { ok: true };
}

function sharesIp(a, b) {
  return !!(a && b && a.ips && b.ips && a.ips.some((ip) => b.ips.includes(ip)));
}

// Credit the inviter when this invitee has become active and isn't sharing an
// IP with the inviter. Returns { credited, inviterDeviceId, newCount } or null.
function creditIfEligible(inviteeDeviceId, isActiveFn) {
  const invitee = store.devices[inviteeDeviceId];
  if (!invitee || !invitee.referrer) return null;
  const inviter = store.devices[invitee.referrer];
  if (!inviter) return null;
  const rec = inviter.invited[inviteeDeviceId];
  if (!rec || rec.credited) return null;
  if (typeof isActiveFn === "function" && !isActiveFn(inviteeDeviceId))
    return null;
  if (sharesIp(invitee, inviter)) return null; // same network → don't count
  rec.credited = true;
  inviter.credited = (inviter.credited || 0) + 1;
  recomputeTop();
  saveSoon();
  return {
    credited: true,
    inviterDeviceId: invitee.referrer,
    newCount: inviter.credited,
  };
}

function stats(deviceId) {
  const d = ensureDevice(deviceId);
  if (!d) return { code: null, credited: 0, invitedTotal: 0, hasReferrer: false };
  return {
    code: d.code,
    credited: d.credited || 0,
    invitedTotal: Object.keys(d.invited || {}).length,
    hasReferrer: !!d.referrer,
  };
}

// The people this device referred, with whether each one has been credited
// (became active) yet. Lets an inviter see the status of their invites.
function invitees(deviceId) {
  const d = store.devices[deviceId];
  if (!d || !d.invited) return [];
  return Object.entries(d.invited).map(([id, rec]) => ({
    deviceId: id,
    credited: !!rec.credited,
    at: rec.at || 0,
  }));
}

// Everyone who has sent at least one invite (pending OR active), so the board is
// populated and people can find themselves. Ranked by active invites first (the
// metric that earns trophies and milestones), then by pending, then by total.
function leaderboard(limit = 100) {
  return Object.entries(store.devices)
    .map(([id, d]) => {
      const total = Object.keys(d.invited || {}).length;
      const active = d.credited || 0;
      return {
        deviceId: id,
        active,
        pending: Math.max(0, total - active),
        total,
      };
    })
    .filter((x) => x.total > 0)
    .sort(
      (a, b) => b.active - a.active || b.pending - a.pending || b.total - a.total,
    )
    .slice(0, Math.max(1, Math.min(limit, 200)));
}

// A device's position on the board, using the same ordering as leaderboard().
// Anyone who has sent at least one invite gets a rank; 0 means "not yet on it".
function rankOf(deviceId) {
  const me = store.devices[deviceId];
  if (!me) return 0;
  const total = Object.keys(me.invited || {}).length;
  if (total <= 0) return 0;
  const active = me.credited || 0;
  const pending = Math.max(0, total - active);
  let rank = 1;
  for (const id in store.devices) {
    if (id === deviceId) continue;
    const d = store.devices[id];
    const t = Object.keys(d.invited || {}).length;
    if (t <= 0) continue;
    const a = d.credited || 0;
    const p = Math.max(0, t - a);
    if (
      a > active ||
      (a === active && p > pending) ||
      (a === active && p === pending && t > total)
    )
      rank++;
  }
  return rank;
}

function prune() {
  const ids = Object.keys(store.devices);
  if (ids.length <= MAX_DEVICES) return;
  // Drop the least valuable devices first (no credit, no referral, no invites),
  // oldest seen.
  ids
    .filter((id) => {
      const d = store.devices[id];
      return (
        !(d.credited > 0) &&
        !d.referrer &&
        Object.keys(d.invited || {}).length === 0
      );
    })
    .sort((a, b) => (store.devices[a].lastSeen || 0) - (store.devices[b].lastSeen || 0))
    .slice(0, ids.length - MAX_DEVICES)
    .forEach((id) => {
      const d = store.devices[id];
      if (d && d.code) delete store.codes[d.code];
      delete store.devices[id];
    });
}

// Synchronous write for a clean shutdown (survives the debounce window).
function flushSync() {
  try {
    prune();
    const tmp = INV_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(store), "utf8");
    fs.renameSync(tmp, INV_PATH);
  } catch (e) {
    console.error("invites flush failed:", e);
  }
}

load();
recomputeTop();

module.exports = {
  ensureDevice,
  codeFor,
  recordIp,
  setReferrer,
  creditIfEligible,
  stats,
  invitees,
  leaderboard,
  rankOf,
  rankBadge,
  flushSync,
  MILESTONE_MOD,
  MILESTONE_DEV,
};
