const games = new Map();

const TICK_RATE = 60;
const BROADCAST_RATE = 30;
const FIELD_WIDTH = 1280;
const FIELD_HEIGHT = 720;
const MAX_PLAYERS = 100;
const PADDLE_WIDTH = 12;
const PADDLE_HEIGHT = 92;
const PADDLE_MARGIN = 28;
const PADDLE_LANE_GAP = 7;
const PADDLE_FOLLOW_SPEED = 1450;
const BALL_RADIUS = 11;
const START_BALL_SPEED = 470;
const MAX_BALL_SPEED = 1050;
const WINNING_SCORE = 7;

let ioGetter = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function playerColor(userId) {
  const hue = hashString(String(userId)) % 360;
  return `hsl(${hue} 82% 62%)`;
}

function randomServeDirection() {
  return Math.random() < 0.5 ? -1 : 1;
}

function createGame(roomId) {
  const game = {
    roomId,
    players: new Map(),
    spectators: new Set(),
    ball: {
      x: FIELD_WIDTH / 2,
      y: FIELD_HEIGHT / 2,
      vx: 0,
      vy: 0,
    },
    scores: { left: 0, right: 0 },
    status: "waiting",
    winner: null,
    winnerName: null,
    lastTick: Date.now(),
    lastBroadcast: 0,
    interval: null,
  };

  game.interval = setInterval(() => tick(game), 1000 / TICK_RATE);
  if (typeof game.interval.unref === "function") game.interval.unref();
  games.set(roomId, game);
  return game;
}

function getGame(roomId) {
  return games.get(roomId) || createGame(roomId);
}

function getTeamCounts(game) {
  let left = 0;
  let right = 0;
  for (const player of game.players.values()) {
    if (player.side === "left") left += 1;
    else right += 1;
  }
  return { left, right };
}

function chooseSide(game) {
  const counts = getTeamCounts(game);
  return counts.left <= counts.right ? "left" : "right";
}

function addOrReconnectPlayer(game, socket) {
  const userId = socket.handshake?.session?.userId;
  const username = socket.handshake?.session?.username || "Anonymous";
  if (!userId) return "spectator";

  const existing = game.players.get(userId);
  if (existing) {
    existing.socketId = socket.id;
    existing.username = username;
    existing.connected = true;
    game.spectators.delete(userId);
    return existing.side;
  }

  if (game.players.size >= MAX_PLAYERS) {
    game.spectators.add(userId);
    return "spectator";
  }

  const side = chooseSide(game);
  game.players.set(userId, {
    userId,
    username,
    socketId: socket.id,
    side,
    color: playerColor(userId),
    y: FIELD_HEIGHT / 2,
    targetY: FIELD_HEIGHT / 2,
    connected: true,
  });
  game.spectators.delete(userId);
  return side;
}

function resetBall(game, direction = randomServeDirection()) {
  const angle = Math.random() * 0.78 - 0.39;
  game.ball.x = FIELD_WIDTH / 2;
  game.ball.y = FIELD_HEIGHT / 2;
  game.ball.vx = Math.cos(angle) * START_BALL_SPEED * direction;
  game.ball.vy = Math.sin(angle) * START_BALL_SPEED;
}

function startIfReady(game) {
  const counts = getTeamCounts(game);
  if (counts.left < 1 || counts.right < 1) {
    game.status = "waiting";
    game.ball.vx = 0;
    game.ball.vy = 0;
    return;
  }

  if (game.status === "waiting") {
    game.status = "playing";
    game.winner = null;
    game.winnerName = null;
    resetBall(game);
  }
}

function orderedPlayers(game, side) {
  return [...game.players.values()]
    .filter((player) => player.side === side)
    .sort((a, b) => String(a.userId).localeCompare(String(b.userId)));
}

function paddleX(side, laneIndex) {
  const offset = PADDLE_MARGIN + laneIndex * PADDLE_LANE_GAP;
  return side === "left"
    ? offset
    : FIELD_WIDTH - offset - PADDLE_WIDTH;
}

function serialize(game) {
  const players = [];
  for (const side of ["left", "right"]) {
    const team = orderedPlayers(game, side);
    team.forEach((player, laneIndex) => {
      players.push({
        userId: player.userId,
        username: player.username,
        side: player.side,
        color: player.color,
        x: paddleX(side, laneIndex),
        y: player.y,
      });
    });
  }

  return {
    field: { width: FIELD_WIDTH, height: FIELD_HEIGHT },
    paddle: { width: PADDLE_WIDTH, height: PADDLE_HEIGHT },
    ballRadius: BALL_RADIUS,
    maxPlayers: MAX_PLAYERS,
    players,
    playerCount: game.players.size,
    spectatorCount: game.spectators.size,
    teamCounts: getTeamCounts(game),
    ball: { ...game.ball },
    scores: { ...game.scores },
    status: game.status,
    winner: game.winner,
    winnerName: game.winnerName,
    winningScore: WINNING_SCORE,
  };
}

function emitState(game) {
  const io = ioGetter?.();
  if (!io) return;
  io.to(game.roomId).emit("pong state", serialize(game));
}

function scorePoint(game, side) {
  game.scores[side] += 1;
  if (game.scores[side] >= WINNING_SCORE) {
    game.status = "finished";
    game.winner = side;
    game.winnerName = `${side === "left" ? "Left" : "Right"} team`;
    game.ball.vx = 0;
    game.ball.vy = 0;
    return;
  }
  resetBall(game, side === "left" ? 1 : -1);
}

function collideWithPaddles(game, side) {
  const ball = game.ball;
  const movingToward = side === "left" ? ball.vx < 0 : ball.vx > 0;
  if (!movingToward) return false;

  const halfHeight = PADDLE_HEIGHT / 2;
  const team = orderedPlayers(game, side);

  for (let laneIndex = 0; laneIndex < team.length; laneIndex += 1) {
    const player = team[laneIndex];
    const left = paddleX(side, laneIndex);
    const right = left + PADDLE_WIDTH;
    const overlapsX = ball.x + BALL_RADIUS >= left && ball.x - BALL_RADIUS <= right;
    const overlapsY = ball.y + BALL_RADIUS >= player.y - halfHeight && ball.y - BALL_RADIUS <= player.y + halfHeight;
    if (!overlapsX || !overlapsY) continue;

    const offset = clamp((ball.y - player.y) / halfHeight, -1, 1);
    const speed = Math.min(MAX_BALL_SPEED, Math.max(START_BALL_SPEED, Math.hypot(ball.vx, ball.vy) * 1.035));
    const angle = offset * 1.02;
    const direction = side === "left" ? 1 : -1;

    ball.vx = Math.cos(angle) * speed * direction;
    ball.vy = Math.sin(angle) * speed;
    ball.x = side === "left" ? right + BALL_RADIUS : left - BALL_RADIUS;
    return true;
  }

  return false;
}

function movePlayers(game, dt) {
  const minY = PADDLE_HEIGHT / 2;
  const maxY = FIELD_HEIGHT - PADDLE_HEIGHT / 2;
  const maxStep = PADDLE_FOLLOW_SPEED * dt;

  for (const player of game.players.values()) {
    const delta = player.targetY - player.y;
    if (Math.abs(delta) <= maxStep) player.y = player.targetY;
    else player.y += Math.sign(delta) * maxStep;
    player.y = clamp(player.y, minY, maxY);
  }
}

function tick(game) {
  const now = Date.now();
  const dt = Math.min(0.05, Math.max(0, (now - game.lastTick) / 1000));
  game.lastTick = now;

  movePlayers(game, dt);

  if (game.status === "playing") {
    game.ball.x += game.ball.vx * dt;
    game.ball.y += game.ball.vy * dt;

    if (game.ball.y - BALL_RADIUS <= 0 && game.ball.vy < 0) {
      game.ball.y = BALL_RADIUS;
      game.ball.vy *= -1;
    } else if (game.ball.y + BALL_RADIUS >= FIELD_HEIGHT && game.ball.vy > 0) {
      game.ball.y = FIELD_HEIGHT - BALL_RADIUS;
      game.ball.vy *= -1;
    }

    collideWithPaddles(game, "left");
    collideWithPaddles(game, "right");

    if (game.ball.x + BALL_RADIUS < 0) scorePoint(game, "right");
    else if (game.ball.x - BALL_RADIUS > FIELD_WIDTH) scorePoint(game, "left");
  }

  if (now - game.lastBroadcast >= 1000 / BROADCAST_RATE) {
    game.lastBroadcast = now;
    emitState(game);
  }
}

function promoteSpectators(game, roomId) {
  if (game.players.size >= MAX_PLAYERS || game.spectators.size === 0) return;
  const io = ioGetter?.();
  if (!io) return;

  for (const userId of [...game.spectators]) {
    if (game.players.size >= MAX_PLAYERS) break;
    const socket = [...io.sockets.sockets.values()].find((candidate) =>
      candidate.roomId === roomId &&
      candidate.handshake?.session?.userId === userId &&
      candidate.pongOpen
    );
    if (!socket) continue;

    const role = addOrReconnectPlayer(game, socket);
    socket.emit("pong role", { role, color: game.players.get(userId)?.color || null });
  }
}

function leave(roomId, userId) {
  const game = games.get(roomId);
  if (!game || !userId) return;

  game.players.delete(userId);
  game.spectators.delete(userId);
  promoteSpectators(game, roomId);

  const counts = getTeamCounts(game);
  if (counts.left < 1 || counts.right < 1) {
    game.status = "waiting";
    game.winner = null;
    game.winnerName = null;
    game.scores.left = 0;
    game.scores.right = 0;
    game.ball.x = FIELD_WIDTH / 2;
    game.ball.y = FIELD_HEIGHT / 2;
    game.ball.vx = 0;
    game.ball.vy = 0;
  }

  startIfReady(game);
  emitState(game);
}

function destroyRoom(roomId) {
  const game = games.get(roomId);
  if (!game) return;
  clearInterval(game.interval);
  games.delete(roomId);
}

function registerSocket(socket, getIo) {
  if (getIo) ioGetter = getIo;

  socket.on("pong open", () => {
    const roomId = socket.roomId;
    const userId = socket.handshake?.session?.userId;
    if (!roomId || !userId || socket.spectating) return;

    socket.pongOpen = true;
    const game = getGame(roomId);
    const role = addOrReconnectPlayer(game, socket);
    startIfReady(game);
    socket.emit("pong role", { role, color: game.players.get(userId)?.color || null });
    socket.emit("pong state", serialize(game));
    emitState(game);
  });

  socket.on("pong close", () => {
    const roomId = socket.roomId;
    const userId = socket.handshake?.session?.userId;
    socket.pongOpen = false;
    if (roomId && userId) leave(roomId, userId);
  });

  socket.on("pong target", (data) => {
    const roomId = socket.roomId;
    const userId = socket.handshake?.session?.userId;
    if (!roomId || !userId || !socket.pongOpen) return;

    const game = games.get(roomId);
    const player = game?.players.get(userId);
    if (!player) return;

    const normalizedY = clamp(Number(data?.y) || 0, 0, 1);
    player.targetY = clamp(
      normalizedY * FIELD_HEIGHT,
      PADDLE_HEIGHT / 2,
      FIELD_HEIGHT - PADDLE_HEIGHT / 2,
    );
  });

  socket.on("pong input", (data) => {
    const roomId = socket.roomId;
    const userId = socket.handshake?.session?.userId;
    if (!roomId || !userId || !socket.pongOpen) return;

    const game = games.get(roomId);
    const player = game?.players.get(userId);
    if (!player) return;

    const direction = Number(data?.direction);
    const amount = direction < 0 ? -0.075 : direction > 0 ? 0.075 : 0;
    player.targetY = clamp(
      player.targetY + FIELD_HEIGHT * amount,
      PADDLE_HEIGHT / 2,
      FIELD_HEIGHT - PADDLE_HEIGHT / 2,
    );
  });

  socket.on("pong restart", () => {
    const roomId = socket.roomId;
    const userId = socket.handshake?.session?.userId;
    if (!roomId || !userId) return;

    const game = games.get(roomId);
    if (!game || !game.players.has(userId)) return;
    const counts = getTeamCounts(game);
    if (counts.left < 1 || counts.right < 1) return;

    game.scores.left = 0;
    game.scores.right = 0;
    game.winner = null;
    game.winnerName = null;
    game.status = "playing";
    resetBall(game);
    emitState(game);
  });
}

module.exports = {
  registerSocket,
  leave,
  destroyRoom,
  games,
};
