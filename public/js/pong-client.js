class Pong {
  constructor(socket, userId, username) {
    this.socket = socket;
    this.userId = userId;
    this.username = username;
    this.isOpen = false;
    this.role = "spectator";
    this.color = null;
    this.state = null;
    this.previousState = null;
    this.stateReceivedAt = 0;
    this.root = null;
    this.canvas = null;
    this.ctx = null;
    this.frame = null;
    this.lastTargetSentAt = 0;
    this.pendingTarget = 0.5;

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onResize = this.onResize.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.renderLoop = this.renderLoop.bind(this);

    this.bindSocketEvents();
  }

  bindSocketEvents() {
    this.socket.on("pong role", (data) => {
      this.role = data?.role || "spectator";
      this.color = data?.color || null;
      this.updateRoleLabel();
    });

    this.socket.on("pong state", (state) => {
      const normalized = this.normalizeState(state);
      if (!normalized) return;
      this.previousState = this.state;
      this.state = normalized;
      this.stateReceivedAt = performance.now();
      this.updateStatusText();
      this.updatePlayerCount();
    });

    this.socket.on("connect", () => {
      if (this.isOpen) this.socket.emit("pong open");
    });
  }


  normalizeState(raw) {
    if (!raw || typeof raw !== "object") return null;

    const field = raw.field && Number.isFinite(raw.field.width) && Number.isFinite(raw.field.height)
      ? raw.field
      : { width: 1280, height: 720 };

    const paddle = raw.paddle && Number.isFinite(raw.paddle.width) && Number.isFinite(raw.paddle.height)
      ? raw.paddle
      : { width: 12, height: 92 };

    const players = Array.isArray(raw.players)
      ? raw.players.filter((player) => player && Number.isFinite(player.x) && Number.isFinite(player.y))
      : [];

    const ball = raw.ball && Number.isFinite(raw.ball.x) && Number.isFinite(raw.ball.y)
      ? raw.ball
      : { x: field.width / 2, y: field.height / 2, vx: 0, vy: 0 };

    const scores = raw.scores || raw.score || {};
    const teamCounts = raw.teamCounts || {};

    return {
      ...raw,
      field,
      paddle,
      players,
      ball,
      ballRadius: Number.isFinite(raw.ballRadius) ? raw.ballRadius : 11,
      scores: {
        left: Number.isFinite(scores.left) ? scores.left : 0,
        right: Number.isFinite(scores.right) ? scores.right : 0,
      },
      teamCounts: {
        left: Number.isFinite(teamCounts.left)
          ? teamCounts.left
          : players.filter((player) => player.side === "left").length,
        right: Number.isFinite(teamCounts.right)
          ? teamCounts.right
          : players.filter((player) => player.side === "right").length,
      },
      playerCount: Number.isFinite(raw.playerCount) ? raw.playerCount : players.length,
      spectatorCount: Number.isFinite(raw.spectatorCount) ? raw.spectatorCount : 0,
      maxPlayers: Number.isFinite(raw.maxPlayers) ? raw.maxPlayers : 100,
      status: typeof raw.status === "string" ? raw.status : "waiting",
    };
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.createUI();
    this.bindInput();
    this.socket.emit("pong open");
    this.frame = requestAnimationFrame(this.renderLoop);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.socket.emit("pong close");
    this.unbindInput();

    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = null;

    if (this.root) this.root.remove();
    this.root = null;
    this.canvas = null;
    this.ctx = null;
    this.state = null;
    this.previousState = null;
  }

  createUI() {
    this.root = document.createElement("div");
    this.root.className = "pong-app";
    this.root.innerHTML = `
      <header class="pong-topbar">
        <div class="pong-title">Pong</div>
        <div class="pong-role" id="pongRoleLabel">Joining…</div>
        <div class="pong-actions">
          <span class="pong-count" id="pongPlayerCount">0 / 100 players</span>
          <button id="pongRestartButton" class="pong-button" type="button">Restart</button>
          <button id="pongCloseButton" class="pong-button pong-close-button" type="button" aria-label="Close Pong">×</button>
        </div>
      </header>
      <main class="pong-stage">
        <canvas class="pong-canvas" width="1280" height="720"></canvas>
        <div class="pong-status" id="pongStatus">Connecting…</div>
        <div class="pong-help">Move the mouse vertically · W/S or ↑/↓</div>
      </main>
      <div class="pong-touch-controls">
        <button class="pong-button pong-touch-button" data-direction="-1" type="button">Up</button>
        <button class="pong-button pong-touch-button" data-direction="1" type="button">Down</button>
      </div>
    `;

    document.body.appendChild(this.root);
    this.canvas = this.root.querySelector(".pong-canvas");
    this.ctx = this.canvas.getContext("2d", { alpha: false });

    this.root.querySelector("#pongCloseButton").addEventListener("click", () => this.close());
    this.root.querySelector("#pongRestartButton").addEventListener("click", () => {
      this.socket.emit("pong restart");
    });

    for (const button of this.root.querySelectorAll(".pong-touch-button")) {
      const direction = Number(button.dataset.direction);
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        this.socket.emit("pong input", { direction });
      });
    }

    this.updateRoleLabel();
    this.updateStatusText();
    this.updatePlayerCount();
    this.onResize();
  }

  bindInput() {
    window.addEventListener("keydown", this.onKeyDown, { passive: false });
    window.addEventListener("resize", this.onResize);
    this.canvas.addEventListener("pointermove", this.onPointerMove, { passive: false });
    this.canvas.addEventListener("pointerdown", this.onPointerDown, { passive: false });
  }

  unbindInput() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("resize", this.onResize);
    if (this.canvas) {
      this.canvas.removeEventListener("pointermove", this.onPointerMove);
      this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    }
  }

  onKeyDown(event) {
    if (!this.isOpen) return;
    if (event.code === "Escape") {
      event.preventDefault();
      this.close();
      return;
    }

    if (event.repeat) return;
    if (event.code === "KeyW" || event.code === "ArrowUp") {
      event.preventDefault();
      this.socket.emit("pong input", { direction: -1 });
    } else if (event.code === "KeyS" || event.code === "ArrowDown") {
      event.preventDefault();
      this.socket.emit("pong input", { direction: 1 });
    }
  }

  onPointerDown(event) {
    if (!this.canvas) return;
    this.canvas.setPointerCapture?.(event.pointerId);
    this.onPointerMove(event);
  }

  onPointerMove(event) {
    if (!this.isOpen || !this.canvas || this.role === "spectator") return;
    event.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    this.pendingTarget = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));

    const now = performance.now();
    if (now - this.lastTargetSentAt >= 16) {
      this.lastTargetSentAt = now;
      this.socket.emit("pong target", { y: this.pendingTarget });
    }
  }

  onResize() {
    if (!this.canvas || !this.root) return;
    const stage = this.root.querySelector(".pong-stage");
    const ratio = 16 / 9;
    const availableWidth = stage.clientWidth;
    const availableHeight = stage.clientHeight;
    let width = availableWidth;
    let height = width / ratio;

    if (height > availableHeight) {
      height = availableHeight;
      width = height * ratio;
    }

    this.canvas.style.width = `${Math.floor(width)}px`;
    this.canvas.style.height = `${Math.floor(height)}px`;
  }

  updateRoleLabel() {
    if (!this.root) return;
    const label = this.root.querySelector("#pongRoleLabel");
    if (!label) return;

    if (this.role === "spectator") {
      label.textContent = "Spectating — player limit reached";
      label.style.color = "";
    } else {
      label.textContent = `${this.role === "left" ? "Left" : "Right"} team`;
      label.style.color = this.color || "";
    }
  }

  updatePlayerCount() {
    if (!this.root) return;
    const label = this.root.querySelector("#pongPlayerCount");
    if (!label) return;
    const count = this.state?.playerCount || 0;
    const max = this.state?.maxPlayers || 100;
    const spectators = this.state?.spectatorCount || 0;
    label.textContent = spectators > 0
      ? `${count} / ${max} players · ${spectators} watching`
      : `${count} / ${max} players`;
  }

  updateStatusText() {
    if (!this.root) return;
    const status = this.root.querySelector("#pongStatus");
    if (!status) return;

    if (!this.state) {
      status.textContent = "Connecting…";
      status.classList.add("show");
      return;
    }

    if (this.state.status === "waiting") {
      status.textContent = "Waiting for at least one player on each team…";
      status.classList.add("show");
    } else if (this.state.status === "finished") {
      status.textContent = `${this.state.winnerName || "A team"} wins — press Restart`;
      status.classList.add("show");
    } else {
      status.classList.remove("show");
    }
  }

  interpolatedState() {
    if (!this.state || !this.previousState) return this.state;
    if (!this.state.ball || !this.previousState.ball) return this.state;
    const amount = Math.min(1, (performance.now() - this.stateReceivedAt) / 34);
    const currentPlayers = new Map((this.state.players || []).map((player) => [player.userId, player]));
    const previousPlayers = new Map((this.previousState.players || []).map((player) => [player.userId, player]));
    const players = [];

    for (const [userId, player] of currentPlayers) {
      const previous = previousPlayers.get(userId) || player;
      players.push({
        ...player,
        x: previous.x + (player.x - previous.x) * amount,
        y: previous.y + (player.y - previous.y) * amount,
      });
    }

    return {
      ...this.state,
      players,
      ball: {
        x: this.previousState.ball.x + (this.state.ball.x - this.previousState.ball.x) * amount,
        y: this.previousState.ball.y + (this.state.ball.y - this.previousState.ball.y) * amount,
      },
    };
  }

  renderLoop() {
    if (!this.isOpen) return;
    this.render();
    this.frame = requestAnimationFrame(this.renderLoop);
  }

  render() {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const state = this.interpolatedState();

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(255,255,255,0.24)";
    ctx.lineWidth = 3;
    ctx.setLineDash([16, 16]);
    ctx.beginPath();
    ctx.moveTo(width / 2, 0);
    ctx.lineTo(width / 2, height);
    ctx.stroke();
    ctx.setLineDash([]);

    if (!state) return;

    const fieldWidth = state.field?.width || 1280;
    const fieldHeight = state.field?.height || 720;
    const paddle = state.paddle || { width: 12, height: 92 };
    const scores = state.scores || { left: 0, right: 0 };
    const teamCounts = state.teamCounts || { left: 0, right: 0 };
    const scaleX = width / fieldWidth;
    const scaleY = height / fieldHeight;
    const paddleWidth = paddle.width * scaleX;
    const paddleHeight = paddle.height * scaleY;

    for (const player of state.players) {
      const x = player.x * scaleX;
      const y = (player.y - paddle.height / 2) * scaleY;
      const isMe = player.userId === this.userId;

      ctx.fillStyle = player.color;
      ctx.fillRect(x, y, paddleWidth, paddleHeight);

      if (isMe) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 1, y - 1, paddleWidth + 2, paddleHeight + 2);
      }
    }

    ctx.fillStyle = "#f7f8fc";
    ctx.beginPath();
    ctx.arc(
      state.ball.x * scaleX,
      state.ball.y * scaleY,
      state.ballRadius * Math.min(scaleX, scaleY),
      0,
      Math.PI * 2,
    );
    ctx.fill();

    ctx.font = "bold 56px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(String(scores.left), width * 0.25, 24);
    ctx.fillText(String(scores.right), width * 0.75, 24);

    ctx.font = "14px Arial, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.64)";
    ctx.fillText(`${teamCounts.left} players`, width * 0.25, 96);
    ctx.fillText(`${teamCounts.right} players`, width * 0.75, 96);
  }
}

window.Pong = Pong;
