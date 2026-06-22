// talkoboard.js v3.1 - Collaborative whiteboard for Talkomatic
//
// v3.1: Talkomatic palette (#202020 / #1a1a1a / #616161 / #ff9800) with
//       FontAwesome icons. No toolbar title.
// v3.0: Color panel (palette, custom picker, eyedropper, recents, teammates'
//       colors). Local undo/redo of your own strokes, synced to everyone.
//       Collapsible chat. Responsive toolbar.
// v2.1: Removed the "Clear board" button. Chat rate limiting (1 msg/sec,
//       10 per 30s burst window).
// v2:   Stroke lifecycle protocol (start/move/end) so there are no gaps
//       between batches. Server-side stroke storage so new joiners see
//       existing drawings. Quadratic bezier smoothing on full redraws.
//       Incremental rendering for live strokes. Distance-based point filtering.

class Talkoboard {
  constructor(socketRef, userId, username) {
    this.socket = socketRef;
    this.userId = userId;
    this.username = username || "Anonymous";
    this.isOpen = false;

    // ── Canvas state ────────────────────────────────────────────────
    this.canvas = null;
    this.ctx = null;
    this.drawing = false;
    this.lastPoint = null;

    // ── Infinite canvas: pan & zoom ─────────────────────────────────
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1;
    this.isPanning = false;
    this.panStart = null;
    this.MIN_ZOOM = 0.2;
    this.MAX_ZOOM = 5;

    // ── Completed strokes (for redraw on pan/zoom) ──────────────────
    this.strokes = [];

    // ── Current local stroke being drawn ────────────────────────────
    this.currentStroke = null;

    // ── Remote active strokes: userId → stroke object ───────────────
    this.remoteActiveStrokes = new Map();

    // ── Tools ───────────────────────────────────────────────────────
    this.color = "#000000";
    this.size = 3;
    this.eraser = false;
    this.panMode = false; // hand tool: drag to move the board (great on touch)

    // ── Gradient brush (null = solid color) ─────────────────────────
    this.gradient = null; // array of hex stops when a gradient is selected
    this.GRADIENT_PERIOD = 28; // points per full gradient cycle along a stroke
    this.gradientPresets = [
      { name: "Rainbow", stops: ["#ff0000", "#ff9800", "#ffeb3b", "#21d07a", "#2196f3", "#9c27b0"] },
      { name: "Sunset", stops: ["#ff512f", "#f09819", "#ffd200"] },
      { name: "Ocean", stops: ["#2193b0", "#6dd5ed", "#21d07a"] },
      { name: "Neon", stops: ["#00f260", "#0575e6"] },
      { name: "Fire", stops: ["#f12711", "#f5af19"] },
      { name: "Candy", stops: ["#ee0979", "#ff6a00", "#ffd200"] },
    ];

    // ── Undo / redo (your own strokes, synced to everyone) ──────────
    this.undoStack = []; // ids of strokes I drew, oldest → newest
    this.redoStack = []; // full stroke objects I undid, for redo
    this._strokeSeq = 0;

    // ── Color tools ─────────────────────────────────────────────────
    this.palette = [
      "#000000",
      "#ffffff",
      "#9e9e9e",
      "#e74c3c",
      "#ff9800",
      "#ffd54f",
      "#8bc34a",
      "#1abc9c",
      "#2196f3",
      "#3f51b5",
      "#9b59b6",
      "#ec407a",
    ];
    this.recentColors = [];
    this.MAX_RECENT = 8;
    this.eyedropperActive = false;

    // ── Other users' live colors (adopt a teammate's color) ─────────
    this.peerColors = new Map(); // userId → hex color
    this.peerNames = new Map(); // userId → username

    // ── Network batching ────────────────────────────────────────────
    this.pointBuffer = [];
    this.flushTimer = null;
    this.FLUSH_INTERVAL = 25;

    // ── Point simplification ────────────────────────────────────────
    this.MIN_POINT_DISTANCE_SQ = 2.25; // 1.5px squared

    // ── Live cursors ────────────────────────────────────────────────
    this.remoteCursors = new Map();
    this.cursorThrottle = 0;
    this.CURSOR_SEND_INTERVAL = 50;

    // ── Chat ────────────────────────────────────────────────────────
    this.chatMessages = [];
    this.MAX_CHAT_MESSAGES = 50;
    this.chatCollapsed = false;

    // ── Chat rate limiting ──────────────────────────────────────────
    this.chatTimestamps = [];
    this.CHAT_MIN_INTERVAL = 1000; // 1 message per second
    this.CHAT_BURST_WINDOW = 30000; // 30 second window
    this.CHAT_BURST_MAX = 10; // max 10 messages per window
    this.chatCooldownActive = false;

    // ── Saved chat text ─────────────────────────────────────────────
    this.savedChatText = "";

    // ── Display dimensions (set in resizeCanvas) ────────────────────
    this.displayWidth = 0;
    this.displayHeight = 0;
    this.dpr = 1;

    // ── Build everything ────────────────────────────────────────────
    this.modal = null;
    this.buildModal();
    this.setupSocketListeners();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CHAT RATE LIMITING
  // ═══════════════════════════════════════════════════════════════════════════

  canSendChat() {
    const now = Date.now();

    // Clean old timestamps outside the burst window
    this.chatTimestamps = this.chatTimestamps.filter(
      (t) => now - t < this.CHAT_BURST_WINDOW,
    );

    // Check burst limit (10 messages per 30s)
    if (this.chatTimestamps.length >= this.CHAT_BURST_MAX) {
      const oldest = this.chatTimestamps[0];
      const waitSec = Math.ceil(
        (this.CHAT_BURST_WINDOW - (now - oldest)) / 1000,
      );
      this.showChatRateWarning(`Slow down! Try again in ${waitSec}s`);
      return false;
    }

    // Check per-message interval (1 per second)
    if (this.chatTimestamps.length > 0) {
      const last = this.chatTimestamps[this.chatTimestamps.length - 1];
      if (now - last < this.CHAT_MIN_INTERVAL) {
        this.showChatRateWarning("Sending too fast");
        return false;
      }
    }

    this.chatTimestamps.push(now);
    return true;
  }

  showChatRateWarning(text) {
    if (this.chatCooldownActive) return;
    this.chatCooldownActive = true;

    const msg = document.createElement("div");
    msg.className = "tb-chat-msg tb-chat-system";
    const span = document.createElement("span");
    span.className = "tb-chat-text";
    span.textContent = text;
    msg.appendChild(span);
    this.chatLog.appendChild(msg);
    this.chatLog.scrollTop = this.chatLog.scrollHeight;

    setTimeout(() => {
      this.chatCooldownActive = false;
    }, 1000);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILD MODAL & UI
  // ═══════════════════════════════════════════════════════════════════════════

  // Small helper for themed toolbar buttons
  makeBtn(className, label, title) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = className;
    if (label != null) b.innerHTML = label;
    if (title) b.title = title;
    return b;
  }

  buildModal() {
    this.modal = document.createElement("div");
    this.modal.id = "talkoboardModal";
    this.modal.className = "tb-overlay";

    const container = document.createElement("div");
    container.className = "tb-container";

    // ── Header / Toolbar ────────────────────────────────────────────
    const header = document.createElement("div");
    header.className = "tb-header";

    const toolbar = document.createElement("div");
    toolbar.className = "tb-toolbar";

    // ── Group: pan / pen / eraser ───────────────────────────────────
    const drawGroup = document.createElement("div");
    drawGroup.className = "tb-group";

    // Hand tool sits left of the pen so you can drag to move the board with
    // one finger — much easier than two-finger panning on mobile.
    this.panBtn = this.makeBtn(
      "tb-tool-btn tb-icon-btn",
      '<i class="fas fa-hand"></i>',
      "Move (drag to pan)",
    );
    this.panBtn.addEventListener("click", () => this.setTool("pan"));

    this.penBtn = this.makeBtn(
      "tb-tool-btn tb-icon-btn active",
      '<i class="fas fa-pen"></i>',
      "Pen",
    );
    this.penBtn.addEventListener("click", () => this.setTool("pen"));

    this.eraserBtn = this.makeBtn(
      "tb-tool-btn tb-icon-btn",
      '<i class="fas fa-eraser"></i>',
      "Eraser",
    );
    this.eraserBtn.addEventListener("click", () => this.setTool("eraser"));

    drawGroup.appendChild(this.panBtn);
    drawGroup.appendChild(this.penBtn);
    drawGroup.appendChild(this.eraserBtn);

    // ── Group: color ────────────────────────────────────────────────
    const colorGroup = document.createElement("div");
    colorGroup.className = "tb-group";

    this.colorBtn = document.createElement("button");
    this.colorBtn.type = "button";
    this.colorBtn.className = "tb-color-btn";
    this.colorBtn.title = "Colors";
    this.colorSwatch = document.createElement("span");
    this.colorSwatch.className = "tb-color-current";
    this.colorSwatch.style.background = this.color;
    const colorCaret = document.createElement("span");
    colorCaret.className = "tb-color-caret";
    colorCaret.innerHTML = '<i class="fas fa-caret-down"></i>';
    this.colorBtn.appendChild(this.colorSwatch);
    this.colorBtn.appendChild(colorCaret);
    this.colorBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleColorPanel();
    });

    colorGroup.appendChild(this.colorBtn);

    // ── Group: size ─────────────────────────────────────────────────
    const sizeWrap = document.createElement("div");
    sizeWrap.className = "tb-group tb-size-wrap";
    this.sizeDot = document.createElement("span");
    this.sizeDot.className = "tb-size-dot";
    this.sizeInput = document.createElement("input");
    this.sizeInput.type = "range";
    this.sizeInput.min = "1";
    this.sizeInput.max = "30";
    this.sizeInput.value = String(this.size);
    this.sizeInput.title = "Brush size";
    this.sizeLabel = document.createElement("span");
    this.sizeLabel.className = "tb-size-label";
    this.sizeLabel.textContent = String(this.size);
    sizeWrap.appendChild(this.sizeDot);
    sizeWrap.appendChild(this.sizeInput);
    sizeWrap.appendChild(this.sizeLabel);
    this.sizeInput.addEventListener("input", (e) => {
      this.size = parseInt(e.target.value);
      this.sizeLabel.textContent = String(this.size);
      this.updateSizeDot();
      this.updateCursor();
    });
    this.updateSizeDot();

    // ── Group: undo / redo ──────────────────────────────────────────
    const historyGroup = document.createElement("div");
    historyGroup.className = "tb-group";
    this.undoBtn = this.makeBtn(
      "tb-tool-btn tb-icon-btn",
      '<i class="fas fa-rotate-left"></i>',
      "Undo (Ctrl+Z)",
    );
    this.redoBtn = this.makeBtn(
      "tb-tool-btn tb-icon-btn",
      '<i class="fas fa-rotate-right"></i>',
      "Redo (Ctrl+Y)",
    );
    this.undoBtn.addEventListener("click", () => this.undo());
    this.redoBtn.addEventListener("click", () => this.redo());
    historyGroup.appendChild(this.undoBtn);
    historyGroup.appendChild(this.redoBtn);

    toolbar.appendChild(drawGroup);
    toolbar.appendChild(colorGroup);
    toolbar.appendChild(sizeWrap);
    toolbar.appendChild(historyGroup);

    // ── Header right: save + zoom + close ───────────────────────────
    const headerRight = document.createElement("div");
    headerRight.className = "tb-header-right";

    // Save the whole board (all strokes, not just the visible part) as a PNG.
    this.saveBtn = this.makeBtn(
      "tb-tool-btn tb-icon-btn",
      '<i class="fas fa-download"></i>',
      "Save as image",
    );
    this.saveBtn.addEventListener("click", () => this.exportBoard());
    headerRight.appendChild(this.saveBtn);

    const zoomWrap = document.createElement("div");
    zoomWrap.className = "tb-group tb-zoom-wrap";
    const zoomOut = this.makeBtn(
      "tb-tool-btn tb-icon-btn",
      '<i class="fas fa-magnifying-glass-minus"></i>',
      "Zoom out",
    );
    this.zoomLabel = document.createElement("span");
    this.zoomLabel.className = "tb-zoom-label";
    this.zoomLabel.textContent = "100%";
    const zoomIn = this.makeBtn(
      "tb-tool-btn tb-icon-btn",
      '<i class="fas fa-magnifying-glass-plus"></i>',
      "Zoom in",
    );
    const zoomReset = this.makeBtn(
      "tb-tool-btn tb-icon-btn",
      '<i class="fas fa-expand"></i>',
      "Reset view",
    );
    zoomOut.addEventListener("click", () => this.adjustZoom(-0.15));
    zoomIn.addEventListener("click", () => this.adjustZoom(0.15));
    zoomReset.addEventListener("click", () => this.resetView());
    zoomWrap.appendChild(zoomOut);
    zoomWrap.appendChild(this.zoomLabel);
    zoomWrap.appendChild(zoomIn);
    zoomWrap.appendChild(zoomReset);

    const closeBtn = this.makeBtn(
      "tb-close",
      '<i class="fas fa-xmark"></i>',
      "Close",
    );
    closeBtn.addEventListener("click", () => this.close());

    headerRight.appendChild(zoomWrap);
    headerRight.appendChild(closeBtn);

    header.appendChild(toolbar);
    header.appendChild(headerRight);

    // ── Canvas area ─────────────────────────────────────────────────
    const canvasWrap = document.createElement("div");
    canvasWrap.className = "tb-canvas-wrap";

    this.canvas = document.createElement("canvas");
    this.canvas.id = "tbCanvas";
    this.ctx = this.canvas.getContext("2d");

    // Cursor layer for remote cursors
    this.cursorLayer = document.createElement("div");
    this.cursorLayer.className = "tb-cursor-layer";

    canvasWrap.appendChild(this.canvas);
    canvasWrap.appendChild(this.cursorLayer);

    // Color panel (docked top-left of the board)
    this.buildColorPanel(canvasWrap);

    // Transient hint toast
    this.hintEl = document.createElement("div");
    this.hintEl.className = "tb-hint";
    canvasWrap.appendChild(this.hintEl);

    this.canvasWrap = canvasWrap;

    // ── Chat panel ──────────────────────────────────────────────────
    this.buildChat(canvasWrap);

    // ── Assemble ────────────────────────────────────────────────────
    container.appendChild(header);
    container.appendChild(canvasWrap);
    this.modal.appendChild(container);
    document.body.appendChild(this.modal);

    this.updateUndoRedoButtons();
    this.bindCanvasEvents();
  }

  // ── Color panel ──────────────────────────────────────────────────
  buildColorPanel(parent) {
    const panel = document.createElement("div");
    panel.className = "tb-color-panel";
    panel.addEventListener("pointerdown", (e) => e.stopPropagation());

    // Preset palette
    const presetTitle = document.createElement("div");
    presetTitle.className = "tb-pop-title";
    presetTitle.textContent = "Palette";
    const presetGrid = document.createElement("div");
    presetGrid.className = "tb-swatch-grid";
    for (const c of this.palette) {
      presetGrid.appendChild(this.makeSwatch(c, c));
    }

    // Custom picker + eyedropper
    const customRow = document.createElement("div");
    customRow.className = "tb-custom-row";

    const customLabel = document.createElement("label");
    customLabel.className = "tb-custom-pick";
    customLabel.title = "Custom color";
    this.colorInput = document.createElement("input");
    this.colorInput.type = "color";
    this.colorInput.value = this.color;
    const customText = document.createElement("span");
    customText.textContent = "Custom";
    customLabel.appendChild(this.colorInput);
    customLabel.appendChild(customText);
    // Live preview while dragging; commit to "recent" only on change
    this.colorInput.addEventListener("input", (e) =>
      this.setColor(e.target.value, false),
    );
    this.colorInput.addEventListener("change", (e) =>
      this.addRecentColor(e.target.value),
    );

    this.eyedropperBtn = document.createElement("button");
    this.eyedropperBtn.type = "button";
    this.eyedropperBtn.className = "tb-eyedropper";
    this.eyedropperBtn.title = "Eyedropper: pick a color from the board";
    this.eyedropperBtn.innerHTML = '<i class="fas fa-eye-dropper"></i>';
    this.eyedropperBtn.addEventListener("click", () =>
      this.activateEyedropper(),
    );

    customRow.appendChild(customLabel);
    customRow.appendChild(this.eyedropperBtn);

    // Gradient brushes (the stroke flows through the colors as you draw)
    const gradTitle = document.createElement("div");
    gradTitle.className = "tb-pop-title";
    gradTitle.textContent = "Gradients";
    const gradRow = document.createElement("div");
    gradRow.className = "tb-swatch-row tb-gradient-row";
    this.gradientEls = [];
    for (const g of this.gradientPresets) {
      const sw = document.createElement("button");
      sw.type = "button";
      sw.className = "tb-swatch tb-gradient-swatch";
      sw.title = g.name;
      sw.style.background =
        "linear-gradient(135deg, " + g.stops.join(", ") + ")";
      sw.addEventListener("click", () => this.setGradient(g.stops));
      gradRow.appendChild(sw);
      this.gradientEls.push({ el: sw, stops: g.stops });
    }

    // Recent colors
    const recentTitle = document.createElement("div");
    recentTitle.className = "tb-pop-title";
    recentTitle.textContent = "Recent";
    this.recentRow = document.createElement("div");
    this.recentRow.className = "tb-swatch-row";

    // Other users' colors
    const usersTitle = document.createElement("div");
    usersTitle.className = "tb-pop-title";
    usersTitle.textContent = "People here";
    this.usersRow = document.createElement("div");
    this.usersRow.className = "tb-swatch-row tb-users-row";

    panel.appendChild(presetTitle);
    panel.appendChild(presetGrid);
    panel.appendChild(customRow);
    panel.appendChild(gradTitle);
    panel.appendChild(gradRow);
    panel.appendChild(recentTitle);
    panel.appendChild(this.recentRow);
    panel.appendChild(usersTitle);
    panel.appendChild(this.usersRow);

    this.colorPanel = panel;
    parent.appendChild(panel);

    this.renderRecentColors();
    this.renderUserColors();
  }

  makeSwatch(color, title, onClick) {
    const s = document.createElement("button");
    s.type = "button";
    s.className = "tb-swatch";
    s.style.background = color;
    if (title) s.title = title;
    // White/very-light swatches get a visible ring
    s.addEventListener("click", () =>
      onClick ? onClick() : this.setColor(color),
    );
    return s;
  }

  toggleColorPanel(force) {
    const open =
      force != null ? force : !this.colorPanel.classList.contains("show");
    this.colorPanel.classList.toggle("show", open);
    this.colorBtn.classList.toggle("active", open);
    if (open) {
      this.renderRecentColors();
      this.renderUserColors();
    }
  }

  renderRecentColors() {
    if (!this.recentRow) return;
    this.recentRow.innerHTML = "";
    if (this.recentColors.length === 0) {
      const empty = document.createElement("span");
      empty.className = "tb-pop-empty";
      empty.textContent = "No recent colors";
      this.recentRow.appendChild(empty);
      return;
    }
    for (const c of this.recentColors) {
      this.recentRow.appendChild(this.makeSwatch(c, c));
    }
  }

  renderUserColors() {
    if (!this.usersRow) return;
    this.usersRow.innerHTML = "";
    const entries = [];
    for (const [uid, color] of this.peerColors) {
      if (uid === this.userId) continue;
      entries.push({ uid, color, name: this.peerNames.get(uid) || "User" });
    }
    if (entries.length === 0) {
      const empty = document.createElement("span");
      empty.className = "tb-pop-empty";
      empty.textContent = "No one else is drawing yet";
      this.usersRow.appendChild(empty);
      return;
    }
    for (const e of entries) {
      const wrap = document.createElement("button");
      wrap.type = "button";
      wrap.className = "tb-user-swatch";
      wrap.title = `Use ${e.name}'s color`;
      const dot = document.createElement("span");
      dot.className = "tb-swatch";
      dot.style.background = e.color;
      const name = document.createElement("span");
      name.className = "tb-user-name";
      name.textContent = e.name;
      wrap.appendChild(dot);
      wrap.appendChild(name);
      wrap.addEventListener("click", () => this.setColor(e.color, true));
      this.usersRow.appendChild(wrap);
    }
  }

  // ── Chat panel ───────────────────────────────────────────────────
  buildChat(parent) {
    const chat = document.createElement("div");
    chat.className = "tb-chat";

    const chatHeader = document.createElement("div");
    chatHeader.className = "tb-chat-header";
    const chatTitle = document.createElement("span");
    chatTitle.innerHTML = '<i class="fas fa-comment"></i> <span>Chat</span>';
    this.chatToggle = document.createElement("button");
    this.chatToggle.type = "button";
    this.chatToggle.className = "tb-chat-toggle";
    this.chatToggle.innerHTML = '<i class="fas fa-minus"></i>';
    this.chatToggle.title = "Collapse chat";
    this.chatToggle.addEventListener("click", () => this.toggleChat());
    chatHeader.appendChild(chatTitle);
    chatHeader.appendChild(this.chatToggle);
    chatHeader.addEventListener("click", (e) => {
      if (e.target === this.chatToggle) return;
      if (this.chatCollapsed) this.toggleChat();
    });

    this.chatLog = document.createElement("div");
    this.chatLog.className = "tb-chat-log";

    const chatInputWrap = document.createElement("div");
    chatInputWrap.className = "tb-chat-input-wrap";
    this.chatInput = document.createElement("input");
    this.chatInput.type = "text";
    this.chatInput.className = "tb-chat-input";
    this.chatInput.placeholder = "Type a message…";
    this.chatInput.maxLength = 200;
    this.chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && this.chatInput.value.trim()) {
        this.sendChat(this.chatInput.value.trim());
        this.chatInput.value = "";
      }
      e.stopPropagation();
    });
    chatInputWrap.appendChild(this.chatInput);

    chat.appendChild(chatHeader);
    chat.appendChild(this.chatLog);
    chat.appendChild(chatInputWrap);

    this.chatEl = chat;
    parent.appendChild(chat);
  }

  toggleChat() {
    this.chatCollapsed = !this.chatCollapsed;
    this.chatEl.classList.toggle("collapsed", this.chatCollapsed);
    this.chatToggle.innerHTML = this.chatCollapsed
      ? '<i class="fas fa-plus"></i>'
      : '<i class="fas fa-minus"></i>';
    this.chatToggle.title = this.chatCollapsed
      ? "Expand chat"
      : "Collapse chat";
  }

  // ── Canvas event wiring (extracted from buildModal for clarity) ──
  bindCanvasEvents() {
    this.canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    this.canvas.addEventListener("pointermove", (e) => this.onPointerMove(e));
    this.canvas.addEventListener("pointerup", (e) => this.onPointerUp(e));
    this.canvas.addEventListener("pointerleave", (e) => this.onPointerUp(e));
    this.canvas.addEventListener("pointercancel", (e) => this.onPointerUp(e));

    this.canvas.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length < 2) e.preventDefault();
      },
      { passive: false },
    );
    this.canvas.addEventListener("touchmove", (e) => e.preventDefault(), {
      passive: false,
    });

    // Wheel zoom
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.08 : 0.08;
        this.adjustZoom(delta, e);
      },
      { passive: false },
    );

    // Middle-click pan
    this.canvas.addEventListener("mousedown", (e) => {
      if (e.button === 1) {
        e.preventDefault();
        this.isPanning = true;
        this.panStart = {
          x: e.clientX,
          y: e.clientY,
          px: this.panX,
          py: this.panY,
        };
      }
    });
    window.addEventListener("mousemove", (e) => {
      if (this.isPanning && this.panStart) {
        this.panX = this.panStart.px + (e.clientX - this.panStart.x);
        this.panY = this.panStart.py + (e.clientY - this.panStart.y);
        this.redraw();
      }
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 1) this.isPanning = false;
    });

    // Two-finger pan on touch
    let lastTouches = null;
    this.canvas.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length === 2) {
          lastTouches = this.getTouchCenter(e.touches);
          this.isPanning = true;
        }
      },
      { passive: true },
    );
    this.canvas.addEventListener(
      "touchmove",
      (e) => {
        if (e.touches.length === 2 && lastTouches) {
          const center = this.getTouchCenter(e.touches);
          this.panX += center.x - lastTouches.x;
          this.panY += center.y - lastTouches.y;
          lastTouches = center;
          this.redraw();
        }
      },
      { passive: true },
    );
    this.canvas.addEventListener(
      "touchend",
      () => {
        if (lastTouches) {
          lastTouches = null;
          this.isPanning = false;
        }
      },
      { passive: true },
    );

    // Close color panel when tapping the board
    this.canvas.addEventListener("pointerdown", () =>
      this.toggleColorPanel(false),
    );

    // Escape to close board / panel
    this._escHandler = (e) => {
      if (e.key !== "Escape" || !this.isOpen) return;
      if (this.colorPanel.classList.contains("show")) {
        this.toggleColorPanel(false);
        return;
      }
      this.close();
    };
    document.addEventListener("keydown", this._escHandler);

    // Undo / redo keyboard shortcuts
    this._undoKeyHandler = (e) => {
      if (!this.isOpen) return;
      if (e.target === this.chatInput) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        this.undo();
      } else if (k === "y" || (k === "z" && e.shiftKey)) {
        e.preventDefault();
        this.redo();
      }
    };
    document.addEventListener("keydown", this._undoKeyHandler);

    // Space to pan
    this._spaceDown = false;
    this._spaceHandler = (e) => {
      if (!this.isOpen) return;
      if (e.target === this.chatInput) return;
      if (e.key === " ") {
        e.preventDefault();
        this._spaceDown = e.type === "keydown";
        this.updateCursor();
      }
    };
    document.addEventListener("keydown", this._spaceHandler);
    document.addEventListener("keyup", this._spaceHandler);

    // Resize
    this._resizeHandler = () => {
      if (this.isOpen) {
        this.resizeCanvas();
        this.redraw();
      }
    };
    window.addEventListener("resize", this._resizeHandler);
  }

  getTouchCenter(touches) {
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TOOLS
  // ═══════════════════════════════════════════════════════════════════════════

  setTool(name) {
    this.panMode = name === "pan";
    this.eraser = name === "eraser";
    this.penBtn.classList.toggle("active", name === "pen");
    this.eraserBtn.classList.toggle("active", name === "eraser");
    if (this.panBtn) this.panBtn.classList.toggle("active", name === "pan");
    this.updateCursor();
  }

  // Back-compat: a few callers just want to return to the pen.
  setEraser(on) {
    this.setTool(on ? "eraser" : "pen");
  }

  setColor(color, addRecent) {
    if (!color) return;
    this.color = color;
    this.gradient = null; // a solid color clears any selected gradient
    this.colorSwatch.style.background = color;
    if (this.colorInput) this.colorInput.value = this.normalizeHex(color);
    // Choosing a color switches you back to the pen
    if (this.eraser || this.panMode) this.setTool("pen");
    this.updateSizeDot();
    this.updateCursor();
    this.updateGradientSelection();
    if (addRecent) this.addRecentColor(color);
  }

  // Pick a multi-stop gradient brush. Strokes drawn with it flow through the
  // colors along their length, and everyone in the room sees the same flow.
  setGradient(stops) {
    if (!Array.isArray(stops) || stops.length < 2) return;
    this.gradient = stops.slice();
    this.colorSwatch.style.background =
      "linear-gradient(135deg, " + stops.join(", ") + ")";
    if (this.eraser || this.panMode) this.setTool("pen");
    this.updateSizeDot();
    this.updateGradientSelection();
  }

  addRecentColor(color) {
    if (!color) return;
    const hex = color.toLowerCase();
    this.recentColors = this.recentColors.filter(
      (c) => c.toLowerCase() !== hex,
    );
    this.recentColors.unshift(color);
    if (this.recentColors.length > this.MAX_RECENT)
      this.recentColors = this.recentColors.slice(0, this.MAX_RECENT);
    this.renderRecentColors();
  }

  updateSizeDot() {
    if (!this.sizeDot) return;
    const d = Math.max(4, Math.min(22, this.size + 3));
    this.sizeDot.style.width = d + "px";
    this.sizeDot.style.height = d + "px";
    this.sizeDot.style.background = this.eraser
      ? "#bbb"
      : this.gradient
        ? "linear-gradient(135deg, " + this.gradient.join(", ") + ")"
        : this.color;
  }

  // ── Gradient helpers ────────────────────────────────────────────
  hexToRgb(hex) {
    const h = this.normalizeHex(hex).slice(1);
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  lerpColor(a, b, t) {
    const pa = this.hexToRgb(a);
    const pb = this.hexToRgb(b);
    return this.rgbToHex(
      Math.round(pa.r + (pb.r - pa.r) * t),
      Math.round(pa.g + (pb.g - pa.g) * t),
      Math.round(pa.b + (pb.b - pa.b) * t),
    );
  }

  sampleGradient(stops, t) {
    if (!stops || stops.length === 0) return "#000000";
    if (stops.length === 1) return stops[0];
    t = Math.max(0, Math.min(1, t));
    const seg = t * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(seg));
    return this.lerpColor(stops[i], stops[i + 1], seg - i);
  }

  // Color of the segment ending at point i. Depends only on the point index
  // (not total length) so the incremental live draw and the full redraw agree.
  strokeSegmentColor(stroke, i) {
    if (!stroke.gradient || stroke.gradient.length < 2) return stroke.color;
    const p = this.GRADIENT_PERIOD;
    return this.sampleGradient(stroke.gradient, (i % p) / p);
  }

  updateGradientSelection() {
    if (!this.gradientEls) return;
    for (const { el, stops } of this.gradientEls) {
      const on =
        this.gradient && stops.join(",") === this.gradient.join(",");
      el.classList.toggle("active", !!on);
    }
  }

  normalizeHex(color) {
    if (typeof color !== "string") return "#000000";
    if (/^#[0-9a-f]{6}$/i.test(color)) return color;
    if (/^#[0-9a-f]{3}$/i.test(color)) {
      return (
        "#" +
        color
          .slice(1)
          .split("")
          .map((c) => c + c)
          .join("")
      );
    }
    return "#000000";
  }

  rgbToHex(r, g, b) {
    const h = (n) => n.toString(16).padStart(2, "0");
    return "#" + h(r) + h(g) + h(b);
  }

  // ── Eyedropper ──────────────────────────────────────────────────
  async activateEyedropper() {
    this.toggleColorPanel(false);
    // Native EyeDropper API picks from anywhere on screen
    if (window.EyeDropper) {
      try {
        const ed = new window.EyeDropper();
        const res = await ed.open();
        if (res && res.sRGBHex) this.setColor(res.sRGBHex, true);
      } catch (_) {
        /* user cancelled */
      }
      return;
    }
    // Fallback: sample the board on the next tap
    this.eyedropperActive = true;
    this.canvas.style.cursor = "copy";
    this.showHint("Tap the board to pick a color");
  }

  deactivateEyedropper() {
    this.eyedropperActive = false;
    this.updateCursor();
  }

  sampleCanvasColor(e) {
    try {
      const rect = this.canvas.getBoundingClientRect();
      const x = Math.round((e.clientX - rect.left) * this.dpr);
      const y = Math.round((e.clientY - rect.top) * this.dpr);
      const d = this.ctx.getImageData(x, y, 1, 1).data;
      if (d[3] === 0) return "#ffffff"; // empty board area
      return this.rgbToHex(d[0], d[1], d[2]);
    } catch (_) {
      return null;
    }
  }

  showHint(text) {
    if (!this.hintEl) return;
    this.hintEl.textContent = text;
    this.hintEl.classList.add("show");
    clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => {
      this.hintEl.classList.remove("show");
    }, 1800);
  }

  // ── Peer color/name tracking ────────────────────────────────────
  notePeerColor(userId, color) {
    if (!userId || userId === this.userId || !color) return;
    if (this.peerColors.get(userId) === color) return;
    this.peerColors.set(userId, color);
    if (this.colorPanel && this.colorPanel.classList.contains("show"))
      this.renderUserColors();
  }

  notePeerName(userId, name) {
    if (!userId || userId === this.userId || !name) return;
    if (this.peerNames.get(userId) === name) return;
    this.peerNames.set(userId, name);
    if (this.colorPanel && this.colorPanel.classList.contains("show"))
      this.renderUserColors();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UNDO / REDO (own strokes, synced to everyone)
  // ═══════════════════════════════════════════════════════════════════════════

  nextStrokeId() {
    this._strokeSeq += 1;
    return `${this.userId}:${this._strokeSeq}`;
  }

  undo() {
    if (this.undoStack.length === 0) return;
    const id = this.undoStack.pop();
    const idx = this.strokes.findIndex((s) => s.id === id);
    if (idx === -1) {
      this.updateUndoRedoButtons();
      return;
    }
    const [stroke] = this.strokes.splice(idx, 1);
    this.redoStack.push(stroke);
    this.socket.emit("board stroke remove", { id });
    this.redraw();
    this.updateUndoRedoButtons();
  }

  redo() {
    if (this.redoStack.length === 0) return;
    const stroke = this.redoStack.pop();
    this.strokes.push(stroke);
    this.undoStack.push(stroke.id);
    this.socket.emit("board stroke add", {
      stroke: {
        id: stroke.id,
        points: stroke.points,
        color: stroke.color,
        size: stroke.size,
        eraser: stroke.eraser,
        gradient: stroke.gradient || null,
      },
    });
    this.redraw();
    this.updateUndoRedoButtons();
  }

  updateUndoRedoButtons() {
    if (this.undoBtn)
      this.undoBtn.classList.toggle("disabled", this.undoStack.length === 0);
    if (this.redoBtn)
      this.redoBtn.classList.toggle("disabled", this.redoStack.length === 0);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // OPEN / CLOSE
  // ═══════════════════════════════════════════════════════════════════════════

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.modal.classList.add("show");
    this.resizeCanvas();
    this.redraw();
    this.updateCursor();
    this.updateUndoRedoButtons();

    this.socket.emit("board open");

    this.savedChatText = typeof selfRawText === "string" ? selfRawText : "";
    if (typeof socket !== "undefined") {
      socket.emit("chat update", {
        diff: {
          type: "full-replace",
          text: "Using Talkoboard. Open Apps (top right) > Talkoboard to join!",
        },
      });
    }
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;

    // End any in-progress local stroke
    if (this.drawing) {
      this.flush();
      this.socket.emit("board stroke end");
      if (this.currentStroke) {
        this.strokes.push(this.currentStroke);
        this.undoStack.push(this.currentStroke.id);
        this.redoStack = [];
        this.currentStroke = null;
      }
      this.drawing = false;
      this.lastPoint = null;
      this.updateUndoRedoButtons();
    }

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    this.toggleColorPanel(false);
    this.deactivateEyedropper();
    this.modal.classList.remove("show");
    this.socket.emit("board close");

    if (typeof socket !== "undefined") {
      socket.emit("chat update", {
        diff: { type: "full-replace", text: this.savedChatText },
      });
    }

    if (typeof chatInput !== "undefined" && chatInput) {
      setTimeout(() => chatInput.focus(), 50);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CANVAS SETUP
  // ═══════════════════════════════════════════════════════════════════════════

  resizeCanvas() {
    const wrap = this.canvasWrap;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = rect.width + "px";
    this.canvas.style.height = rect.height + "px";

    this.displayWidth = rect.width;
    this.displayHeight = rect.height;
    this.dpr = dpr;
  }

  updateCursor() {
    if (!this.canvas) return;
    if (this.eyedropperActive) {
      this.canvas.style.cursor = "copy";
      return;
    }
    this.canvas.style.cursor =
      this._spaceDown || this.panMode ? "grab" : "crosshair";
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COORDINATE TRANSFORMS (screen <-> world)
  // ═══════════════════════════════════════════════════════════════════════════

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.panX) / this.zoom,
      y: (sy - this.panY) / this.zoom,
    };
  }

  worldToScreen(wx, wy) {
    return {
      x: wx * this.zoom + this.panX,
      y: wy * this.zoom + this.panY,
    };
  }

  getCanvasPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return this.screenToWorld(sx, sy);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PAN & ZOOM
  // ═══════════════════════════════════════════════════════════════════════════

  adjustZoom(delta, e) {
    const oldZoom = this.zoom;
    this.zoom = Math.min(
      this.MAX_ZOOM,
      Math.max(this.MIN_ZOOM, this.zoom + delta),
    );

    if (e) {
      const rect = this.canvas.getBoundingClientRect();
      const mx = (e.clientX || rect.width / 2) - rect.left;
      const my = (e.clientY || rect.height / 2) - rect.top;
      this.panX = mx - (mx - this.panX) * (this.zoom / oldZoom);
      this.panY = my - (my - this.panY) * (this.zoom / oldZoom);
    }

    this.zoomLabel.textContent = Math.round(this.zoom * 100) + "%";
    this.redraw();
  }

  resetView() {
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1;
    this.zoomLabel.textContent = "100%";
    this.redraw();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPORT — save the WHOLE board (every stroke) as a PNG, regardless of the
  // current pan/zoom. Renders strokes onto an offscreen canvas sized to their
  // bounding box, flattened onto white so erased areas read as white.
  // ═══════════════════════════════════════════════════════════════════════════

  exportBoard() {
    const all = [...this.strokes];
    for (const [, s] of this.remoteActiveStrokes) all.push(s);
    if (this.currentStroke) all.push(this.currentStroke);

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const s of all) {
      if (!s.points) continue;
      const r = s.size / 2 + 2;
      for (const p of s.points) {
        if (p.x - r < minX) minX = p.x - r;
        if (p.y - r < minY) minY = p.y - r;
        if (p.x + r > maxX) maxX = p.x + r;
        if (p.y + r > maxY) maxY = p.y + r;
      }
    }
    if (!isFinite(minX)) {
      this.showHint("Nothing to save yet");
      return;
    }

    const pad = 28;
    const worldW = maxX - minX + pad * 2;
    const worldH = maxY - minY + pad * 2;
    // Cap the output so a sprawling board can't allocate a giant canvas.
    const MAX_DIM = 4096;
    const scale = Math.min(2, MAX_DIM / worldW, MAX_DIM / worldH);
    const W = Math.max(1, Math.round(worldW * scale));
    const H = Math.max(1, Math.round(worldH * scale));

    // Strokes on a transparent layer first (so eraser punches holes), then
    // composite onto white so those holes read as white in the saved image.
    const layer = document.createElement("canvas");
    layer.width = W;
    layer.height = H;
    const lctx = layer.getContext("2d");
    lctx.scale(scale, scale);
    lctx.translate(pad - minX, pad - minY);
    for (const s of this.strokes) this.renderStrokeSmooth(lctx, s);
    for (const [, s] of this.remoteActiveStrokes) this.renderStrokeSmooth(lctx, s);
    if (this.currentStroke) this.renderStrokeSmooth(lctx, this.currentStroke);

    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    const octx = out.getContext("2d");
    octx.fillStyle = "#ffffff";
    octx.fillRect(0, 0, W, H);
    octx.drawImage(layer, 0, 0);

    const done = (url, revoke) => {
      const a = document.createElement("a");
      a.href = url;
      a.download = "talkoboard.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (revoke) setTimeout(() => URL.revokeObjectURL(url), 2000);
      this.showHint("Saved board image");
    };
    if (out.toBlob) {
      out.toBlob((blob) => {
        if (blob) done(URL.createObjectURL(blob), true);
        else done(out.toDataURL("image/png"), false);
      }, "image/png");
    } else {
      done(out.toDataURL("image/png"), false);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DRAWING — FULL REDRAW (pan/zoom/resize triggers this)
  // ═══════════════════════════════════════════════════════════════════════════

  redraw() {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const w = this.displayWidth;
    const h = this.displayHeight;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // White background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);

    // Grid
    this.drawGrid(ctx, w, h);

    // All completed strokes (bezier-smoothed)
    for (const stroke of this.strokes) {
      this.renderStrokeSmooth(ctx, stroke);
    }

    // Remote active strokes (bezier-smoothed)
    for (const [, stroke] of this.remoteActiveStrokes) {
      this.renderStrokeSmooth(ctx, stroke);
    }

    // Current local in-progress stroke (bezier-smoothed)
    if (this.currentStroke) {
      this.renderStrokeSmooth(ctx, this.currentStroke);
    }

    ctx.restore();
  }

  drawGrid(ctx, screenW, screenH) {
    const spacing = 40;
    const tl = this.screenToWorld(0, 0);
    const br = this.screenToWorld(screenW, screenH);

    ctx.fillStyle = "#e3e3e3";
    const startX = Math.floor(tl.x / spacing) * spacing;
    const startY = Math.floor(tl.y / spacing) * spacing;

    for (let x = startX; x < br.x; x += spacing) {
      for (let y = startY; y < br.y; y += spacing) {
        ctx.beginPath();
        ctx.arc(x, y, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STROKE RENDERING — BEZIER SMOOTH (used in full redraws)
  // ═══════════════════════════════════════════════════════════════════════════

  renderStrokeSmooth(ctx, stroke) {
    const pts = stroke.points;
    if (!pts || pts.length === 0) return;

    if (!stroke.eraser && stroke.gradient && stroke.gradient.length >= 2) {
      this.renderStrokeGradient(ctx, stroke);
      return;
    }

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = stroke.size;

    if (stroke.eraser) {
      ctx.globalCompositeOperation = "destination-out";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = stroke.color;
    }

    if (pts.length === 1) {
      // Single dot
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, stroke.size / 2, 0, Math.PI * 2);
      ctx.fillStyle = stroke.eraser ? "rgba(0,0,0,1)" : stroke.color;
      ctx.fill();
    } else if (pts.length === 2) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
      ctx.stroke();
    } else {
      // Quadratic bezier through midpoints for smooth curves
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);

      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) * 0.5;
        const my = (pts[i].y + pts[i + 1].y) * 0.5;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }

      // Final segment to last point
      const last = pts[pts.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  // Gradient strokes: the line flows through the colors as it goes. Each piece
  // is a smooth quadratic curve through the midpoints (same smoothing as solid
  // strokes), just with its own interpolated color, so it isn't jaggy.
  renderStrokeGradient(ctx, stroke) {
    const pts = stroke.points;
    ctx.save();
    if (pts.length === 1) {
      ctx.lineWidth = stroke.size;
      ctx.globalCompositeOperation = "source-over";
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, stroke.size / 2, 0, Math.PI * 2);
      ctx.fillStyle = this.strokeSegmentColor(stroke, 0);
      ctx.fill();
    } else {
      this.renderGradientPieces(ctx, stroke, 1);
    }
    ctx.restore();
  }

  // Draws smooth colored pieces of a gradient stroke for point indices
  // [from .. end]. Each piece is the quadratic from one midpoint to the next
  // (control = the actual point), which is what removes the jaggedness. Round
  // caps/joins make neighbouring pieces blend seamlessly; colors are opaque so
  // re-stroking the tail during a live draw leaves no visible seam.
  renderGradientPieces(ctx, stroke, from) {
    const pts = stroke.points;
    const n = pts.length;
    if (n < 2) return;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = stroke.size;
    ctx.globalCompositeOperation = "source-over";
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    if (n === 2) {
      ctx.strokeStyle = this.strokeSegmentColor(stroke, 1);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
      ctx.stroke();
      return;
    }
    const startI = Math.max(1, from);
    for (let i = startI; i <= n - 2; i++) {
      const s = i === 1 ? pts[0] : mid(pts[i - 1], pts[i]);
      const e = mid(pts[i], pts[i + 1]);
      ctx.strokeStyle = this.strokeSegmentColor(stroke, i);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, e.x, e.y);
      ctx.stroke();
    }
    // Final tail from the last midpoint to the last point
    const fs = mid(pts[n - 2], pts[n - 1]);
    ctx.strokeStyle = this.strokeSegmentColor(stroke, n - 1);
    ctx.beginPath();
    ctx.moveTo(fs.x, fs.y);
    ctx.lineTo(pts[n - 1].x, pts[n - 1].y);
    ctx.stroke();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STROKE RENDERING — INCREMENTAL (used during live drawing, no full redraw)
  // Draws only from fromIndex onward, connecting to existing canvas content.
  // ═══════════════════════════════════════════════════════════════════════════

  drawSegmentsIncremental(stroke, fromIndex) {
    if (!this.isOpen) return;
    const pts = stroke.points;
    if (fromIndex >= pts.length) return;

    const ctx = this.ctx;
    const dpr = this.dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = stroke.size;

    if (stroke.eraser) {
      ctx.globalCompositeOperation = "destination-out";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = stroke.color;
    }

    const start = Math.max(0, fromIndex);

    // Gradient strokes draw smooth quadratic pieces. Re-stroke a couple of tail
    // pieces so the new curve joins the previous ones without a kink.
    if (!stroke.eraser && stroke.gradient && stroke.gradient.length >= 2) {
      this.renderGradientPieces(ctx, stroke, Math.max(1, start - 2));
      ctx.restore();
      return;
    }

    // Start from the point just before the new segment to bridge the gap
    ctx.beginPath();
    ctx.moveTo(pts[start].x, pts[start].y);
    for (let i = start + 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();

    ctx.restore();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // POINTER HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  onPointerDown(e) {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);

    // Eyedropper fallback: sample the board where the user taps
    if (this.eyedropperActive) {
      const c = this.sampleCanvasColor(e);
      if (c) this.setColor(c, true);
      this.deactivateEyedropper();
      return;
    }

    // Hand tool, space+click, or middle-click = pan the board
    if (this.panMode || this._spaceDown || e.button === 1) {
      this.isPanning = true;
      this.panStart = {
        x: e.clientX,
        y: e.clientY,
        px: this.panX,
        py: this.panY,
      };
      this.canvas.style.cursor = "grabbing";
      return;
    }

    if (e.button !== 0) return;

    this.drawing = true;
    const pt = this.getCanvasPoint(e);
    this.lastPoint = pt;

    // Start a new local stroke (id lets us undo/redo it across everyone)
    const id = this.nextStrokeId();
    const gradient = this.eraser ? null : this.gradient;
    this.currentStroke = {
      id,
      points: [pt],
      color: this.color,
      size: this.size,
      eraser: this.eraser,
      gradient,
    };

    // Emit stroke start to server
    this.socket.emit("board stroke start", {
      id,
      point: pt,
      color: this.color,
      size: this.size,
      eraser: this.eraser,
      gradient,
    });

    // Begin network flush timer
    this.pointBuffer = [];
    if (!this.flushTimer) {
      this.flushTimer = setInterval(() => this.flush(), this.FLUSH_INTERVAL);
    }
  }

  onPointerMove(e) {
    // Send cursor position to others
    this.sendCursorPosition(e);

    if (this.isPanning && this.panStart) {
      this.panX = this.panStart.px + (e.clientX - this.panStart.x);
      this.panY = this.panStart.py + (e.clientY - this.panStart.y);
      this.redraw();
      return;
    }

    if (!this.drawing) return;
    e.preventDefault();

    const pt = this.getCanvasPoint(e);

    // Distance-based filtering: skip points too close to the last one
    if (this.currentStroke && this.currentStroke.points.length > 0) {
      const last =
        this.currentStroke.points[this.currentStroke.points.length - 1];
      const dx = pt.x - last.x;
      const dy = pt.y - last.y;
      if (dx * dx + dy * dy < this.MIN_POINT_DISTANCE_SQ) return;
    }

    // Store the point, then draw the new segment from the real stroke so
    // gradient coloring uses the true point index (matching what everyone
    // else renders). Zero-latency feedback, no temporary stroke needed.
    if (this.currentStroke) {
      this.currentStroke.points.push(pt);
      this.drawSegmentsIncremental(
        this.currentStroke,
        this.currentStroke.points.length - 2,
      );
    }
    this.lastPoint = pt;

    // Buffer for network
    this.pointBuffer.push(pt);
  }

  onPointerUp(e) {
    if (this.isPanning) {
      this.isPanning = false;
      this.panStart = null;
      this.updateCursor();
      return;
    }

    if (!this.drawing) return;
    this.drawing = false;
    this.lastPoint = null;

    // Flush remaining points
    this.flush();

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Tell server the stroke is done
    this.socket.emit("board stroke end");

    // Move completed stroke to storage + record it for undo
    if (this.currentStroke) {
      this.strokes.push(this.currentStroke);
      this.undoStack.push(this.currentStroke.id);
      this.redoStack = [];
      this.updateUndoRedoButtons();
      this.currentStroke = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NETWORK
  // ═══════════════════════════════════════════════════════════════════════════

  flush() {
    if (this.pointBuffer.length === 0) return;
    const points = this.pointBuffer.splice(0);
    this.socket.emit("board stroke move", { points });
  }

  sendCursorPosition(e) {
    const now = Date.now();
    if (now - this.cursorThrottle < this.CURSOR_SEND_INTERVAL) return;
    this.cursorThrottle = now;
    const pt = this.getCanvasPoint(e);
    this.socket.emit("board cursor", { x: pt.x, y: pt.y });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REMOTE STROKE HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  handleRemoteStrokeStart(data) {
    if (data.userId === this.userId) return;

    // Create a new active stroke for this remote user
    const stroke = {
      id: data.id,
      points: [data.point],
      color: data.color || "#000000",
      size: data.size || 3,
      eraser: !!data.eraser,
      gradient:
        Array.isArray(data.gradient) && data.gradient.length >= 2
          ? data.gradient
          : null,
    };

    // Track this user's color so others can adopt it
    if (!stroke.eraser) this.notePeerColor(data.userId, stroke.color);

    // If they had an unfinished stroke, finalize it
    this.finalizeRemoteStroke(data.userId);

    this.remoteActiveStrokes.set(data.userId, stroke);

    // Render the initial dot
    if (this.isOpen) {
      const ctx = this.ctx;
      const dpr = this.dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.save();
      ctx.translate(this.panX, this.panY);
      ctx.scale(this.zoom, this.zoom);

      ctx.beginPath();
      ctx.arc(data.point.x, data.point.y, stroke.size / 2, 0, Math.PI * 2);
      if (stroke.eraser) {
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = "rgba(0,0,0,1)";
      } else {
        ctx.fillStyle = stroke.gradient
          ? this.strokeSegmentColor(stroke, 0)
          : stroke.color;
      }
      ctx.fill();
      ctx.restore();
    }
  }

  handleRemoteStrokeMove(data) {
    if (data.userId === this.userId) return;

    const stroke = this.remoteActiveStrokes.get(data.userId);
    if (!stroke) return;

    const prevLen = stroke.points.length;
    for (const p of data.points) {
      stroke.points.push(p);
    }

    // Incremental render: draw from the last existing point through new points
    // This bridges the gap between batches — the key smoothness fix
    if (this.isOpen && prevLen > 0) {
      this.drawSegmentsIncremental(stroke, prevLen - 1);
    }
  }

  handleRemoteStrokeEnd(data) {
    if (data.userId === this.userId) return;
    this.finalizeRemoteStroke(data.userId);
  }

  // A teammate undid one of their strokes; drop it everywhere.
  handleRemoteStrokeRemove(data) {
    if (!data || !data.id) return;
    const idx = this.strokes.findIndex((s) => s.id === data.id);
    if (idx !== -1) this.strokes.splice(idx, 1);
    if (this.isOpen) this.redraw();
  }

  // A teammate redid a stroke; add it back everywhere.
  handleRemoteStrokeAdd(data) {
    if (!data || data.userId === this.userId) return;
    const s = data.stroke;
    if (!s || !s.points || s.points.length === 0) return;
    if (s.id && this.strokes.some((x) => x.id === s.id)) return; // already have it
    this.strokes.push(s);
    if (!s.eraser) this.notePeerColor(data.userId, s.color);
    if (this.isOpen) this.redraw();
  }

  /**
   * Move a remote user's active stroke into completed strokes.
   */
  finalizeRemoteStroke(userId) {
    const stroke = this.remoteActiveStrokes.get(userId);
    if (stroke && stroke.points.length > 0) {
      this.strokes.push(stroke);
    }
    this.remoteActiveStrokes.delete(userId);
  }

  /**
   * Load full board state from server (on open or reconnect).
   */
  handleBoardState(data) {
    // Replace local state with server truth
    this.strokes = [];
    this.remoteActiveStrokes.clear();

    if (data.strokes && Array.isArray(data.strokes)) {
      for (const s of data.strokes) {
        if (s && s.points && s.points.length > 0) {
          this.strokes.push(s);
          if (s.owner && !s.eraser) this.notePeerColor(s.owner, s.color);
        }
      }
    }

    if (data.active && typeof data.active === "object") {
      for (const [uid, s] of Object.entries(data.active)) {
        if (uid !== this.userId && s && s.points && s.points.length > 0) {
          this.remoteActiveStrokes.set(uid, s);
          if (!s.eraser) this.notePeerColor(uid, s.color);
        }
      }
    }

    if (this.isOpen) this.redraw();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIVE CURSORS
  // ═══════════════════════════════════════════════════════════════════════════

  updateRemoteCursor(data) {
    let cursor = this.remoteCursors.get(data.userId);

    if (!cursor) {
      const el = document.createElement("div");
      el.className = "tb-remote-cursor";

      const dot = document.createElement("div");
      dot.className = "tb-cursor-dot";

      const label = document.createElement("span");
      label.className = "tb-cursor-label";
      label.textContent = data.username;

      el.appendChild(dot);
      el.appendChild(label);
      this.cursorLayer.appendChild(el);

      cursor = { el, x: 0, y: 0, username: data.username };
      this.remoteCursors.set(data.userId, cursor);
    }

    cursor.x = data.x;
    cursor.y = data.y;

    const screen = this.worldToScreen(data.x, data.y);
    cursor.el.style.transform = `translate(${screen.x}px, ${screen.y}px)`;

    const visible =
      screen.x >= -50 &&
      screen.x <= this.displayWidth + 50 &&
      screen.y >= -50 &&
      screen.y <= this.displayHeight + 50;
    cursor.el.style.display = visible ? "block" : "none";

    if (cursor.timeout) clearTimeout(cursor.timeout);
    cursor.timeout = setTimeout(() => {
      cursor.el.style.display = "none";
    }, 3000);
  }

  removeRemoteCursor(userId) {
    const cursor = this.remoteCursors.get(userId);
    if (cursor) {
      if (cursor.timeout) clearTimeout(cursor.timeout);
      if (cursor.el.parentNode) cursor.el.parentNode.removeChild(cursor.el);
      this.remoteCursors.delete(userId);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CHAT
  // ═══════════════════════════════════════════════════════════════════════════

  sendChat(text) {
    if (!this.canSendChat()) return;
    this.socket.emit("board chat", { text });
  }

  // Deterministic, readable color for a chat name (when we don't know the
  // user's drawing color). Keeps names distinguishable in the log.
  nameColor(userId) {
    const known = this.peerColors.get(userId);
    if (known) return known;
    let h = 0;
    const s = String(userId || "x");
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffff;
    return `hsl(${h % 360}, 70%, 72%)`;
  }

  addChatMessage(data) {
    this.chatMessages.push(data);
    if (this.chatMessages.length > this.MAX_CHAT_MESSAGES) {
      this.chatMessages.shift();
      if (this.chatLog.firstChild)
        this.chatLog.removeChild(this.chatLog.firstChild);
    }

    if (data.userId && data.username)
      this.notePeerName(data.userId, data.username);

    const isSelf = data.userId === this.userId;
    const col = isSelf ? "#ff9800" : this.nameColor(data.userId);

    const msg = document.createElement("div");
    msg.className = "tb-chat-msg";
    if (isSelf) msg.classList.add("tb-chat-self");

    // A small colored avatar with the sender's initial gives each person a
    // consistent identity in the log.
    const avatar = document.createElement("span");
    avatar.className = "tb-chat-avatar";
    avatar.style.background = col;
    avatar.textContent =
      (data.username || "?").trim().charAt(0).toUpperCase() || "?";

    const body = document.createElement("div");
    body.className = "tb-chat-body";

    const name = document.createElement("span");
    name.className = "tb-chat-name";
    name.textContent = data.username;
    name.style.color = col;

    const text = document.createElement("span");
    text.className = "tb-chat-text";
    text.textContent = data.text;

    body.appendChild(name);
    body.appendChild(text);
    msg.appendChild(avatar);
    msg.appendChild(body);
    this.chatLog.appendChild(msg);
    this.chatLog.scrollTop = this.chatLog.scrollHeight;

    // Nudge the user if a message arrives while chat is collapsed
    if (this.chatCollapsed && data.userId !== this.userId) {
      this.chatToggle.classList.add("tb-chat-unread");
      setTimeout(
        () => this.chatToggle.classList.remove("tb-chat-unread"),
        2500,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SOCKET LISTENERS
  // ═══════════════════════════════════════════════════════════════════════════

  setupSocketListeners() {
    // ── Stroke lifecycle (v2) ────────────────────────────────────────
    this.socket.on("board stroke start", (data) =>
      this.handleRemoteStrokeStart(data),
    );
    this.socket.on("board stroke move", (data) =>
      this.handleRemoteStrokeMove(data),
    );
    this.socket.on("board stroke end", (data) =>
      this.handleRemoteStrokeEnd(data),
    );

    // ── Undo / redo sync (v3) ───────────────────────────────────────
    this.socket.on("board stroke remove", (data) =>
      this.handleRemoteStrokeRemove(data),
    );
    this.socket.on("board stroke add", (data) =>
      this.handleRemoteStrokeAdd(data),
    );

    // ── Full state sync ─────────────────────────────────────────────
    this.socket.on("board state", (data) => this.handleBoardState(data));

    // ── Clear ────────────────────────────────────────────────────────
    this.socket.on("board clear", () => {
      this.strokes = [];
      this.currentStroke = null;
      this.remoteActiveStrokes.clear();
      this.undoStack = [];
      this.redoStack = [];
      this.updateUndoRedoButtons();
      if (this.isOpen) this.redraw();
    });

    // ── Cursors ──────────────────────────────────────────────────────
    this.socket.on("board cursor", (data) => {
      if (data.userId === this.userId) return;
      this.notePeerName(data.userId, data.username);
      this.updateRemoteCursor(data);
    });

    // ── Chat ─────────────────────────────────────────────────────────
    this.socket.on("board chat", (data) => {
      this.addChatMessage(data);
    });

    // ── User left room ──────────────────────────────────────────────
    this.socket.on("user left", (userId) => {
      this.removeRemoteCursor(userId);
      this.finalizeRemoteStroke(userId);
      this.peerColors.delete(userId);
      this.peerNames.delete(userId);
      if (this.colorPanel && this.colorPanel.classList.contains("show"))
        this.renderUserColors();
    });

    this.socket.on("board user status", (data) => {
      if (!data.open) {
        this.removeRemoteCursor(data.userId);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLEANUP
  // ═══════════════════════════════════════════════════════════════════════════

  destroy() {
    if (this.isOpen) this.close();
    if (this.flushTimer) clearInterval(this.flushTimer);
    document.removeEventListener("keydown", this._escHandler);
    document.removeEventListener("keydown", this._undoKeyHandler);
    document.removeEventListener("keydown", this._spaceHandler);
    document.removeEventListener("keyup", this._spaceHandler);
    window.removeEventListener("resize", this._resizeHandler);
    for (const [, cursor] of this.remoteCursors) {
      if (cursor.timeout) clearTimeout(cursor.timeout);
    }
    if (this.modal && this.modal.parentNode) {
      this.modal.parentNode.removeChild(this.modal);
    }
  }
}

window.Talkoboard = Talkoboard;
