// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  lobby-client.js — Talkomatic Lobby Client                                ║
// ║  Server statistics, anti-spam lobby sorting, lobby visibility             ║
// ║                                                                           ║
// ║  PATCHED (June 2026 anniversary batch):                                   ║
// ║  • FIX #4: Access codes are NEVER placed in redirect URLs anymore.        ║
// ║    The server validates the code and stores it in the session BEFORE      ║
// ║    emitting "room joined" / "room created", so the room page joins        ║
// ║    via the session — no ?accessCode= in the address bar, history,         ║
// ║    or analytics. The lastUsedAccessCode variable has been removed         ║
// ║    entirely since it only existed to build those URLs.                    ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

// ============================================================================
// 1. CUSTOM MODAL SYSTEM (IIFE to avoid conflicts)
// ============================================================================
(function () {
  // Only initialize once to avoid duplicate event listeners
  if (window.modalFunctionsInitialized) {
    console.log("Custom modal already initialized");
    return;
  }
  window.modalFunctionsInitialized = true;

  // Get modal elements
  const customModal = document.getElementById("customModal");
  const modalTitle = document.getElementById("modalTitle");
  const modalMessage = document.getElementById("modalMessage");
  const modalInput = document.getElementById("modalInput");
  const modalInputContainer = document.getElementById("modalInputContainer");
  const modalInputError = document.getElementById("modalInputError");
  const modalCancelBtn = document.getElementById("modalCancelBtn");
  const modalConfirmBtn = document.getElementById("modalConfirmBtn");
  const closeModalBtn = document.querySelector(".close-modal-btn");

  let currentModalCallback = null;

  // Define the modal functions - make private to this scope
  function showModal(title, message, options = {}) {
    modalTitle.textContent = title;
    modalMessage.textContent = message;

    // Reset modal state
    modalInputContainer.style.display = "none";
    modalInput.value = "";
    modalInputError.style.display = "none";
    modalInputError.textContent = "";

    // Configure input if needed
    if (options.showInput) {
      modalInputContainer.style.display = "block";
      modalInput.placeholder = options.inputPlaceholder || "";
      modalInput.setAttribute("maxLength", options.maxLength || "6");
      modalInput.focus();
    }

    // Configure buttons
    modalCancelBtn.textContent = options.cancelText || "Cancel";
    modalConfirmBtn.textContent = options.confirmText || "Confirm";

    // Show/hide cancel button
    modalCancelBtn.style.display =
      options.showCancel !== false ? "block" : "none";

    // Store callback
    currentModalCallback = options.callback || null;

    // Show modal
    customModal.classList.add("show");

    // Prevent background scrolling
    document.body.style.overflow = "hidden";
  }

  function hideCustomModal() {
    customModal.classList.remove("show");
    document.body.style.overflow = "";
    currentModalCallback = null;
  }

  // Expose public methods to window
  const ERROR_CODES = {
    VALIDATION_ERROR: "Validation Error",
    SERVER_ERROR: "Server Error",
    UNAUTHORIZED: "Unauthorized",
    NOT_FOUND: "Not Found",
    RATE_LIMITED: "Rate Limited",
    ROOM_FULL: "Room Full",
    ACCESS_DENIED: "Access Denied",
    BAD_REQUEST: "Bad Request",
    FORBIDDEN: "Forbidden",
    CIRCUIT_OPEN: "Circuit Open",
    AFK_WARNING: "AFK Warning",
    AFK_TIMEOUT: "AFK Timeout",
  };

  window.showErrorModal = function (message, title) {
    showModal(ERROR_CODES[title] ?? "Error", message, {
      showCancel: false,
      confirmText: "OK",
    });
  };

  window.showInfoModal = function (message) {
    showModal("Information", message, {
      showCancel: false,
      confirmText: "OK",
    });
  };

  window.showConfirmModal = function (message, callback) {
    showModal("Confirmation", message, {
      confirmText: "Yes",
      cancelText: "No",
      callback: callback,
    });
  };

  window.showInputModal = function (title, message, options, callback) {
    showModal(title, message, {
      showInput: true,
      inputPlaceholder: options.placeholder || "",
      maxLength: options.maxLength || "6",
      confirmText: options.confirmText || "Submit",
      callback: (confirmed, inputValue) => {
        if (confirmed && options.validate) {
          const validationResult = options.validate(inputValue);
          if (validationResult !== true) {
            modalInputError.textContent = validationResult;
            modalInputError.style.display = "block";
            return false; // Prevent modal from closing
          }
        }
        callback(confirmed, inputValue);
        return true;
      },
    });
  };

  // Event listeners for modal
  modalConfirmBtn.addEventListener("click", () => {
    if (currentModalCallback) {
      const shouldClose = currentModalCallback(true, modalInput.value);
      if (shouldClose !== false) {
        hideCustomModal();
      }
    } else {
      hideCustomModal();
    }
  });

  modalCancelBtn.addEventListener("click", () => {
    if (currentModalCallback) {
      currentModalCallback(false);
    }
    hideCustomModal();
  });

  closeModalBtn.addEventListener("click", hideCustomModal);

  // Close modal when clicking outside the content
  customModal.addEventListener("click", (e) => {
    if (e.target === customModal) {
      hideCustomModal();
    }
  });

  // Validate input for numbers only
  modalInput.addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/[^0-9]/g, "");
  });

  // Close modal with Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && customModal.classList.contains("show")) {
      hideCustomModal();
    }
  });

  // Enter key in input field triggers confirm button
  modalInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      modalConfirmBtn.click();
    }
  });
})();

// ============================================================================
// 2. STATS FOR NERDS MODAL
// ============================================================================
class StatsModal {
  constructor() {
    this.modal = document.getElementById("statsModal");
    this.closeButton = document.getElementById("statsModalClose");
    this.refreshButton = document.getElementById("modalRefreshButton");
    this.isOpen = false;
    this.lastUpdateTime = null;

    // Modal content sections
    this.loadingSection = document.getElementById("statsLoadingSection");
    this.errorSection = document.getElementById("statsErrorSection");
    this.contentSection = document.getElementById("statsContentSection");

    // Stats display elements
    this.elements = {
      rooms: document.getElementById("modalStatsRooms"),
      users: document.getElementById("modalStatsUsers"),
      version: document.getElementById("modalStatsVersion"),
      uptime: document.getElementById("modalStatsUptime"),
      utilizationPercentage: document.getElementById(
        "modalUtilizationPercentage",
      ),
      utilizationFill: document.getElementById("modalUtilizationFill"),
      public: document.getElementById("modalStatsPublic"),
      semiPrivate: document.getElementById("modalStatsSemiPrivate"),
      private: document.getElementById("modalStatsPrivate"),
      lastUpdated: document.getElementById("modalLastUpdated"),
      refreshIndicator: document.getElementById("modalRefreshIndicator"),
    };

    this.init();
  }

  init() {
    this.closeButton.addEventListener("click", () => this.close());
    this.refreshButton.addEventListener("click", () => this.fetchStats());

    this.modal.addEventListener("click", (e) => {
      if (e.target === this.modal) {
        this.close();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen) {
        this.close();
      }
    });
  }

  async open() {
    this.isOpen = true;
    this.modal.classList.add("show");
    document.body.style.overflow = "hidden";

    this.showLoading();
    await this.fetchStats();
  }

  close() {
    this.isOpen = false;
    this.modal.classList.remove("show");
    document.body.style.overflow = "";
  }

  showLoading() {
    this.loadingSection.style.display = "block";
    this.errorSection.style.display = "none";
    this.contentSection.style.display = "none";
  }

  showError() {
    this.loadingSection.style.display = "none";
    this.errorSection.style.display = "block";
    this.contentSection.style.display = "none";
  }

  showContent() {
    this.loadingSection.style.display = "none";
    this.errorSection.style.display = "none";
    this.contentSection.style.display = "block";
  }

  async fetchStats() {
    try {
      if (this.isOpen) {
        this.showLoading();
      }

      const [healthResponse, configResponse] = await Promise.all([
        fetch("/api/v1/health", {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        }),
        fetch("/api/v1/config", {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        }).catch(() => null),
      ]);

      if (!healthResponse.ok) {
        throw new Error(
          `HTTP ${healthResponse.status}: ${healthResponse.statusText}`,
        );
      }

      const healthData = await healthResponse.json();
      const configData =
        configResponse && configResponse.ok
          ? await configResponse.json()
          : null;

      this.updateStatsDisplay(healthData, configData);
      this.setConnectionStatus(true);

      if (this.isOpen) {
        this.showContent();
      }
    } catch (error) {
      console.error("Error fetching server stats:", error);
      this.setConnectionStatus(false);

      if (this.isOpen) {
        this.showError();
      }
    }
  }

  updateStatsDisplay(healthData, configData) {
    const stats = healthData.roomStatistics || {};

    this.elements.rooms.textContent = `${stats.totalRooms || 0}/${
      stats.currentLimit || 15
    }`;
    this.elements.users.textContent = stats.totalUsers || 0;
    this.elements.version.textContent = healthData.version || "Unknown";

    const uptime = healthData.uptime || 0;
    this.elements.uptime.textContent = this.formatUptime(uptime);

    const utilization = stats.utilizationPercentage || 0;
    this.elements.utilizationPercentage.textContent = `${utilization}%`;
    this.elements.utilizationFill.style.width = `${Math.min(utilization, 100)}%`;

    if (stats.roomTypes) {
      this.elements.public.textContent = stats.roomTypes.public || 0;
      this.elements.semiPrivate.textContent =
        stats.roomTypes["semi-private"] || 0;
      this.elements.private.textContent = stats.roomTypes.private || 0;
    }

    this.lastUpdateTime = new Date();
    this.elements.lastUpdated.textContent = `Last updated ${this.formatTime(
      this.lastUpdateTime,
    )}`;
  }

  setConnectionStatus(connected) {
    if (connected) {
      this.elements.refreshIndicator.classList.remove("offline");
    } else {
      this.elements.refreshIndicator.classList.add("offline");
    }
  }

  formatTime(date) {
    return date.toLocaleTimeString("en-US", {
      hour12: true,
      hour: "numeric",
      minute: "2-digit",
    });
  }

  formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  }
}

// ============================================================================
// 3. CONNECTION STATUS INDICATOR
// ============================================================================

const connectionStatus = document.createElement("div");
connectionStatus.id = "connectionStatus";
connectionStatus.style.position = "fixed";
connectionStatus.style.bottom = "10px";
connectionStatus.style.right = "10px";
connectionStatus.style.padding = "5px 10px";
connectionStatus.style.borderRadius = "5px";
connectionStatus.style.fontSize = "12px";
connectionStatus.style.fontWeight = "bold";
connectionStatus.style.zIndex = "1000";
document.body.appendChild(connectionStatus);

function updateConnectionStatus() {
  if (socket.connected) {
    connectionStatus.textContent = "Connected";
    connectionStatus.style.backgroundColor = "#070707";
    connectionStatus.style.color = "white";
  } else {
    connectionStatus.textContent = "Disconnected";
    connectionStatus.style.backgroundColor = "#F44336";
    connectionStatus.style.color = "white";
  }
}

// ============================================================================
// 4. SOCKET.IO INITIALIZATION
// ============================================================================

// Socket.io initialization with robust connection settings
const socket = io({
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  timeout: 20000,
  autoConnect: true,
  withCredentials: true,
  auth: {
    devKey: localStorage.getItem("talkomatic_devKey") || undefined,
    modKey: localStorage.getItem("talkomatic_modKey") || undefined,
  },
});

// ============================================================================
// 5. DOM REFERENCES & STATE
// ============================================================================

// DOM elements
const logForm = document.getElementById("logform");
const createRoomForm = document.getElementById("lobbyForm");
const roomListContainer = document.querySelector(".roomList");
const dynamicRoomList = document.getElementById("dynamicRoomList");
const usernameInput = logForm.querySelector('input[placeholder="Your Name"]');
const locationInput = logForm.querySelector(
  'input[placeholder="Location (optional)"]',
);
const roomNameInput = createRoomForm.querySelector(
  'input[placeholder="Room Name"]',
);
const goChatButton = createRoomForm.querySelector(".go-chat-button");
const signInButton = logForm.querySelector('button[type="submit"]');
const signInMessage = document.getElementById("signInMessage");
const noRoomsMessage = document.getElementById("noRoomsMessage");
const accessCodeInput = document.getElementById("accessCodeInput");
const roomTypeRadios = document.querySelectorAll('input[name="roomType"]');

// Variables
let currentUsername = "";
let currentLocation = "";
let currentUserId = null;
let isSignedIn = false;
let connectionRetryCount = 0;
const MAX_RETRIES = 3;
const MAX_USERNAME_LENGTH = 15;
const MAX_LOCATION_LENGTH = 20;
const MAX_ROOM_NAME_LENGTH = 25;
let devLobbyCodes = {};
let statsModal = null;
let currentUserIsDev = false;
let currentUserIsMod = false;

// ============================================================================
// 6. SIGN-IN HELPERS
// ============================================================================

function checkSignInStatus() {
  if (socket.connected) {
    socket.emit("check signin status");
  } else {
    socket.once("connect", () => {
      socket.emit("check signin status");
    });
  }
}

function setSignedInButtonState() {
  while (signInButton.firstChild) {
    signInButton.removeChild(signInButton.firstChild);
  }
  signInButton.appendChild(document.createTextNode("Change "));

  const img = document.createElement("img");
  img.src = "images/icons/pencil.png";
  img.alt = "Arrow";
  img.classList.add("arrow-icon");
  signInButton.appendChild(img);
}

function setSignInState(username, location, shouldPersist = true) {
  currentUsername = username;
  currentLocation = location;
  isSignedIn = true;

  usernameInput.value = currentUsername;
  locationInput.value = currentLocation;
  setSignedInButtonState();
  createRoomForm.classList.remove("hidden");

  if (shouldPersist) {
    localStorage.setItem("talkomaticUsername", currentUsername);
    localStorage.setItem("talkomaticLocation", currentLocation);
  }
}

function emitJoinLobby(username, location) {
  const payload = {
    username,
    location,
  };

  if (socket.connected) {
    socket.emit("join lobby", payload);
  } else {
    socket.once("connect", () => {
      socket.emit("join lobby", payload);
    });
  }
}

// ============================================================================
// 7. SOCKET CONNECTION EVENTS
// ============================================================================

socket.on("connect", () => {
  console.log("Socket connected successfully");
  connectionRetryCount = 0;
  updateConnectionStatus();
});

socket.on("disconnect", (reason) => {
  console.log(`Socket disconnected: ${reason}`);
  updateConnectionStatus();

  if (reason === "io server disconnect") {
    socket.connect();
  }
});

socket.on("connect_error", (error) => {
  // IP block: the server attaches ban details. Show a clear ban screen with a
  // live countdown (or a permanent notice) instead of retrying forever.
  if (error?.data?.banned) {
    try {
      socket.io.opts.reconnection = false;
      socket.disconnect();
    } catch (_) {}
    showBanScreen(error.data);
    return;
  }

  console.error("Connection error:", error);
  updateConnectionStatus();

  if (connectionRetryCount < MAX_RETRIES) {
    connectionRetryCount++;
    console.log(
      `Retrying connection (${connectionRetryCount}/${MAX_RETRIES})...`,
    );

    if (socket.disconnected) {
      setTimeout(() => {
        console.log("Attempting reconnection with clean session...");
        socket.io.opts.query = { clean: "true" };
        socket.connect();
      }, 1000 * connectionRetryCount);
    }
  } else {
    window.showErrorModal(
      "Unable to connect to the server. Please refresh the page and try again.",
      "SERVER_ERROR",
    );
  }
});

socket.on("reconnect", (attemptNumber) => {
  console.log(`Reconnected after ${attemptNumber} attempts`);
  updateConnectionStatus();
  checkSignInStatus();
});

// One active tab per browser session: if another tab takes over this identity,
// pause this tab instead of letting two tabs fight over one identity.
let tabSuperseded = false;
function showTabSupersededOverlay() {
  if (tabSuperseded) return;
  tabSuperseded = true;
  try {
    socket.io.opts.reconnection = false;
    socket.disconnect();
  } catch (_) {}
  if (!document.getElementById("supersededStyles")) {
    const st = document.createElement("style");
    st.id = "supersededStyles";
    st.textContent = `
      #supersededOverlay{position:fixed;inset:0;z-index:1000002;background:#0a0a0a;
        display:flex;align-items:center;justify-content:center;padding:20px;font-family:Arial,sans-serif;}
      #supersededOverlay .ss-card{max-width:460px;width:100%;background:#181818;border:1px solid #616161;
        border-radius:10px;padding:36px 30px;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.6);}
      #supersededOverlay .ss-icon{font-size:52px;color:#ff9800;margin-bottom:16px;}
      #supersededOverlay h1{color:#ff9800;font-size:24px;margin:0 0 10px;}
      #supersededOverlay p{color:#dddddd;font-size:15px;line-height:1.6;margin:0 0 22px;}
      #supersededOverlay button{background:#ff9800;color:#000;border:none;border-radius:6px;
        padding:12px 26px;font-size:15px;font-weight:bold;cursor:pointer;font-family:inherit;}
      #supersededOverlay button:hover{background:#ffb74d;}
    `;
    document.head.appendChild(st);
  }
  const ov = document.createElement("div");
  ov.id = "supersededOverlay";
  ov.innerHTML =
    '<div class="ss-card">' +
    '<div class="ss-icon"><i class="fas fa-window-restore"></i></div>' +
    "<h1>This tab is paused</h1>" +
    "<p>Talkomatic is now open in another tab. Only one tab can be active at a time, so this one was paused.</p>" +
    '<button id="ssUseHere">Use this tab</button>' +
    "</div>";
  document.body.appendChild(ov);
  const btn = document.getElementById("ssUseHere");
  if (btn) btn.addEventListener("click", () => window.location.reload());
}
socket.on("session superseded", showTabSupersededOverlay);

// ── Ban screen: big, clear, with a live countdown or a permanent notice ───────
let banScreenShown = false;
function showBanScreen(info) {
  if (banScreenShown) return;
  banScreenShown = true;
  const DISCORD = "https://discord.gg/N7tJznESrE";

  if (!document.getElementById("banScreenStyles")) {
    const style = document.createElement("style");
    style.id = "banScreenStyles";
    style.textContent = `
      #banScreen{position:fixed;inset:0;z-index:1000001;background:#0a0a0a;
        display:flex;align-items:center;justify-content:center;padding:20px;
        font-family:Arial,sans-serif;}
      #banScreen .ban-card{max-width:540px;width:100%;background:#181818;
        border:1px solid #616161;border-radius:10px;padding:40px 32px;text-align:center;
        box-shadow:0 12px 40px rgba(0,0,0,.6);}
      #banScreen .ban-icon{font-size:60px;color:#ff5252;margin-bottom:18px;}
      #banScreen h1{color:#ff9800;font-size:30px;margin:0 0 10px;font-weight:bold;}
      #banScreen .ban-sub{color:#e0e0e0;font-size:16px;line-height:1.6;margin:0 0 22px;}
      #banScreen .ban-timer{background:#000;border:1px solid #616161;border-radius:8px;
        padding:18px;margin:0 0 22px;}
      #banScreen .ban-timer-label{color:#9a9a9a;font-size:12px;text-transform:uppercase;
        letter-spacing:1px;margin-bottom:8px;}
      #banScreen .ban-timer-value{color:#fff;font-size:34px;font-weight:bold;
        font-variant-numeric:tabular-nums;font-family:'Courier New',monospace;}
      #banScreen .ban-reason{background:#000;border:1px solid #616161;
        border-left:4px solid #ff9800;border-radius:8px;padding:14px 16px;
        margin:0 0 22px;text-align:left;}
      #banScreen .ban-reason-label{color:#ff9800;font-size:12px;text-transform:uppercase;
        letter-spacing:1px;margin-bottom:6px;font-weight:bold;}
      #banScreen .ban-reason-text{color:#e0e0e0;font-size:15px;line-height:1.5;
        white-space:pre-wrap;word-break:break-word;}
      #banScreen .ban-perm{display:inline-block;background:#ff5252;color:#000;
        font-weight:bold;font-size:15px;padding:10px 18px;border-radius:6px;
        text-transform:uppercase;letter-spacing:1px;margin:0 0 22px;}
      #banScreen .ban-discord{display:inline-flex;align-items:center;gap:10px;
        background:#5865f2;color:#fff;text-decoration:none;font-size:16px;font-weight:bold;
        padding:14px 26px;border-radius:8px;transition:background .2s;}
      #banScreen .ban-discord:hover{background:#4752c4;}
      #banScreen .ban-note{color:#8a8a8a;font-size:13px;margin-top:18px;line-height:1.5;}
    `;
    document.head.appendChild(style);
  }

  const permanent = !!info.permanent;
  const timerHtml = permanent
    ? '<div class="ban-perm"><i class="fas fa-ban"></i> Permanent ban</div>'
    : '<div class="ban-timer"><div class="ban-timer-label">Time remaining</div>' +
      '<div class="ban-timer-value" id="banCountdown">--:--:--</div></div>';

  const overlay = document.createElement("div");
  overlay.id = "banScreen";
  overlay.innerHTML =
    '<div class="ban-card">' +
    '<div class="ban-icon"><i class="fas fa-gavel"></i></div>' +
    "<h1>Access Blocked</h1>" +
    '<p class="ban-sub">' +
    (permanent
      ? "Your access to Talkomatic has been permanently blocked by a moderator."
      : "Your access to Talkomatic has been temporarily blocked by a moderator.") +
    "</p>" +
    '<div class="ban-reason" id="banReason" style="display:none">' +
    '<div class="ban-reason-label">' +
    '<i class="fas fa-comment-dots"></i> Reason from staff</div>' +
    '<div class="ban-reason-text" id="banReasonText"></div>' +
    "</div>" +
    timerHtml +
    '<a class="ban-discord" href="' +
    DISCORD +
    '" target="_blank" rel="noopener noreferrer">' +
    '<i class="fab fa-discord"></i> Appeal on our Discord</a>' +
    '<p class="ban-note">If you believe this was a mistake, join our Discord and let a staff member know. ' +
    (permanent ? "" : "This page refreshes automatically once your ban ends.") +
    "</p>" +
    "</div>";
  document.body.appendChild(overlay);

  // Reason is staff-entered free text: render via textContent, never as HTML.
  if (info.reason) {
    const rc = document.getElementById("banReason");
    const rt = document.getElementById("banReasonText");
    if (rc && rt) {
      rt.textContent = info.reason;
      rc.style.display = "block";
    }
  }

  if (!permanent && info.expiry) {
    const tick = () => {
      const el = document.getElementById("banCountdown");
      if (!el) return;
      const remaining = info.expiry - Date.now();
      if (remaining <= 0) {
        el.textContent = "00:00:00";
        window.location.reload();
        return;
      }
      el.textContent = formatBanRemaining(remaining);
    };
    tick();
    setInterval(tick, 1000);
  }
}

function formatBanRemaining(ms) {
  let s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const pad = (n) => String(n).padStart(2, "0");
  return (d > 0 ? d + "d " : "") + pad(h) + ":" + pad(m) + ":" + pad(s);
}

socket.on("dev lobby context", (codes) => {
  devLobbyCodes = codes || {};
});

// ============================================================================
// 8. FORM HANDLERS
// ============================================================================

// Show/hide access code field
roomTypeRadios.forEach((radio) => {
  radio.addEventListener("change", (e) => {
    if (e.target.value === "semi-private") {
      accessCodeInput.style.display = "block";
    } else {
      accessCodeInput.style.display = "none";
    }
  });
});

logForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const newUsername = usernameInput.value.trim().slice(0, MAX_USERNAME_LENGTH);
  const newLocation =
    locationInput.value.trim().slice(0, MAX_LOCATION_LENGTH) || "On The Web";

  if (newUsername) {
    localStorage.setItem("talkomaticUsername", newUsername);
    localStorage.setItem("talkomaticLocation", newLocation);

    if (currentUsername) {
      signInButton.textContent = "Changed";
      setTimeout(() => {
        setSignedInButtonState();
      }, 2000);
    } else {
      setSignedInButtonState();
      createRoomForm.classList.remove("hidden");
    }

    currentUsername = newUsername;
    currentLocation = newLocation;
    isSignedIn = true;

    if (socket.connected) {
      socket.emit("join lobby", {
        username: currentUsername,
        location: currentLocation,
      });
    } else {
      socket.once("connect", () => {
        socket.emit("join lobby", {
          username: currentUsername,
          location: currentLocation,
        });
      });
    }

    showRoomList();
  } else {
    window.showErrorModal("Please enter a username.");
  }
});

goChatButton.addEventListener("click", () => {
  if (!socket.connected) {
    window.showErrorModal(
      "Not connected to server. Please wait for connection or refresh the page.",
      "SERVER_ERROR",
    );
    return;
  }

  const roomName = roomNameInput.value.trim().slice(0, MAX_ROOM_NAME_LENGTH);
  const roomType = document.querySelector(
    'input[name="roomType"]:checked',
  )?.value;
  const roomLayout = document.querySelector(
    'input[name="roomLayout"]:checked',
  )?.value;
  const accessCode = accessCodeInput.querySelector("input").value;

  if (roomName && roomType && roomLayout) {
    if (roomType === "semi-private") {
      if (!accessCode || accessCode.length !== 6 || !/^\d+$/.test(accessCode)) {
        window.showErrorModal(
          "Please enter a valid 6-digit access code for the semi-private room.",
        );
        return;
      }
    }

    // FIX #4: The access code is sent to the server ONLY in this socket
    // event. The server validates it and stores it in the session before
    // confirming, so the redirect URL never needs to carry it.
    socket.emit("create room", {
      name: roomName,
      type: roomType,
      layout: roomLayout,
      accessCode,
    });
  } else {
    window.showErrorModal("Please fill in all room details.");
  }
});

dynamicRoomList.addEventListener("click", (e) => {
  if (e.target.classList.contains("enter-button") && !e.target.disabled) {
    if (!socket.connected) {
      window.showErrorModal(
        "Not connected to server. Please wait for connection or refresh the page.",
        "SERVER_ERROR",
      );
      return;
    }

    const roomElement = e.target.closest(".room");
    const roomId = roomElement.dataset.roomId;
    const roomType = roomElement.dataset.roomType;

    if (roomType === "semi-private") {
      promptAccessCode(roomId);
    } else {
      joinRoom(roomId);
    }
  }
});

// ============================================================================
// 9. ROOM JOIN / CREATE FLOW
// ============================================================================

function promptAccessCode(roomId) {
  window.showInputModal(
    "Access Code Required",
    "Please enter the 6-digit access code for this room:",
    {
      placeholder: "6-digit code",
      maxLength: "6",
      validate: (value) => {
        if (!value) return "Access code is required";
        if (value.length !== 6 || !/^\d+$/.test(value)) {
          return "Invalid access code. Please enter a 6-digit number.";
        }
        return true;
      },
    },
    (confirmed, accessCode) => {
      if (confirmed && accessCode) {
        joinRoom(roomId, accessCode);
      }
    },
  );
}

function joinRoom(roomId, accessCode = null) {
  if (!socket.connected) {
    window.showErrorModal(
      "Not connected to server. Please wait for connection or refresh the page.",
      "SERVER_ERROR",
    );
    return;
  }

  socket.emit("join room", { roomId, accessCode });
}

socket.on("access code required", () => {
  const roomId = new URLSearchParams(window.location.search).get("roomId");
  promptAccessCode(roomId);
});

// FIX #4: Redirect with roomId ONLY. The server has already validated and
// stored the access code in the session (it awaits the session save before
// emitting this event), so room.html joins via the session — the code never
// touches the URL, browser history, or analytics.
socket.on("room joined", (data) => {
  window.location.href = `/room.html?roomId=${data.roomId}`;
});

// FIX #4: Same for room creation — roomId only.
socket.on("room created", (roomId) => {
  window.location.href = `/room.html?roomId=${roomId}`;
});

// ============================================================================
// 10. SIGN-IN STATUS & SIGN-OUT
// ============================================================================

socket.on("signin status", (data) => {
  currentUserIsDev = !!data.isDev;
  currentUserIsMod = !!data.isMod;
  if (currentUserIsDev) ensureDevPanelButton();
  updateStaffLink();
  if (data.isSignedIn) {
    currentUsername = data.username;
    currentLocation = data.location;
    currentUserId = data.userId;
    isSignedIn = true;

    usernameInput.value = currentUsername;
    locationInput.value = currentLocation;

    localStorage.setItem("talkomaticUsername", currentUsername);
    localStorage.setItem("talkomaticLocation", currentLocation);

    setSignedInButtonState();
    createRoomForm.classList.remove("hidden");

    showRoomList();
  } else {
    signInMessage.style.display = "block";
    roomListContainer.style.display = "none";
  }
});

function signOut() {
  localStorage.removeItem("talkomaticUsername");
  localStorage.removeItem("talkomaticLocation");

  currentUsername = "";
  currentLocation = "";
  currentUserId = null;
  isSignedIn = false;
  usernameInput.value = "";
  locationInput.value = "";

  while (signInButton.firstChild) {
    signInButton.removeChild(signInButton.firstChild);
  }
  signInButton.appendChild(document.createTextNode("Sign In"));

  createRoomForm.classList.add("hidden");
  signInMessage.style.display = "block";
  roomListContainer.style.display = "none";

  if (socket.connected) {
    socket.emit("leave lobby");
  }
}

// ============================================================================
// 11. LOBBY ROOM LIST
// ============================================================================

socket.on("lobby update", (rooms) => {
  updateLobby(rooms);
});

socket.on("error", (error) => {
  console.log(error);
  window.showErrorModal(
    (error.error.replaceDefaultText ? "" : `An error occurred: `) +
      error.error.message,
    error.error.code,
  );
});

function getJoinableCount(room) {
  if (!room) return 0;
  if (typeof room.userCount === "number") return room.userCount;
  if (!Array.isArray(room.users)) return 0;
  return room.users.filter((user) => !user?.isDev).length;
}

function createRoomElement(room) {
  const roomElement = document.createElement("div");
  roomElement.classList.add("room");
  roomElement.dataset.roomId = room.id;
  roomElement.dataset.roomType = room.type;
  if (room.spotlight) roomElement.classList.add("spotlight-room");

  const joinableCount = getJoinableCount(room);
  const capacity = room.capacity || 5;
  const isFull = !!room.isFull || joinableCount >= capacity;

  const enterButton = document.createElement("button");
  enterButton.classList.add("enter-button");
  if (isFull) {
    enterButton.textContent = "Full";
    enterButton.disabled = true;
    roomElement.classList.add("full");
  } else {
    enterButton.textContent = "Enter";
  }

  const roomTop = document.createElement("div");
  roomTop.classList.add("room-top");

  const roomInfo = document.createElement("div");
  roomInfo.classList.add("room-info");

  const roomNameDiv = document.createElement("div");
  roomNameDiv.classList.add("room-name");
  roomNameDiv.textContent = `${room.name} (${joinableCount}/${capacity} People)`;
  if (room.spotlight) {
    const star = document.createElement("span");
    star.className = "official-badge";
    star.textContent = "★ OFFICIAL";
    roomNameDiv.prepend(star);
  }

  const roomDetailsDiv = document.createElement("div");
  roomDetailsDiv.classList.add("room-details");
  roomDetailsDiv.textContent = `${getRoomTypeDisplay(room.type)} Room`;

  const usersDetailDiv = document.createElement("div");
  usersDetailDiv.classList.add("users-detail");

  (room.users || []).forEach((user, index) => {
    const userDiv = document.createElement("div");

    const userNumberSpan = document.createElement("span");
    userNumberSpan.classList.add("user-number");
    userNumberSpan.textContent = `${index + 1}.`;

    const userNameSpan = document.createElement("span");
    userNameSpan.classList.add("user-name");
    userNameSpan.textContent = user.username;

    userDiv.appendChild(userNumberSpan);

    if (user.isDev && !user.isHidden) {
      const crown = document.createElement("img");
      crown.src = "images/icons/crown.gif";
      crown.alt = "";
      crown.className = "dev-lobby-badge";
      userDiv.appendChild(crown);
    }

    if (user.isMod && !user.isDev && !user.isHidden) {
      const mb = document.createElement("span");
      mb.className = "mod-lobby-badge";
      mb.textContent = "MOD";
      userDiv.appendChild(mb);
    }

    userDiv.appendChild(userNameSpan);
    userDiv.append(` / ${user.location}`);

    usersDetailDiv.appendChild(userDiv);
  });

  roomInfo.appendChild(roomNameDiv);
  roomInfo.appendChild(roomDetailsDiv);

  if (devLobbyCodes[room.id]) {
    const codeDiv = document.createElement("div");
    codeDiv.className = "dev-access-code";
    codeDiv.textContent = "\uD83D\uDD11 " + devLobbyCodes[room.id];
    roomInfo.appendChild(codeDiv);
  }

  roomInfo.appendChild(usersDetailDiv);

  roomTop.appendChild(roomInfo);
  roomElement.appendChild(enterButton);
  roomElement.appendChild(roomTop);

  // Per-room staff controls: spectate is dev + mod; spotlight stays dev-only.
  if (currentUserIsDev || currentUserIsMod) {
    const devRow = document.createElement("div");
    devRow.className = "lobby-dev-controls";

    const spectateBtn = document.createElement("button");
    spectateBtn.type = "button";
    spectateBtn.className = "lobby-dev-btn";
    spectateBtn.innerHTML = '<i class="fas fa-eye"></i> Spectate';
    spectateBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      window.location.href = `/room.html?roomId=${room.id}&spectate=1`;
    });
    devRow.appendChild(spectateBtn);

    if (currentUserIsDev) {
      const spotBtn = document.createElement("button");
      spotBtn.type = "button";
      spotBtn.className = "lobby-dev-btn";
      spotBtn.textContent = room.spotlight ? "★ Unspotlight" : "★ Spotlight";
      spotBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        socket.emit("staff spotlight", {
          roomId: room.id,
          on: !room.spotlight,
        });
      });
      devRow.appendChild(spotBtn);
    }

    roomElement.appendChild(devRow);
  }

  return roomElement;
}

function getRoomTypeDisplay(type) {
  switch (type) {
    case "public":
      return "Public";
    case "semi-private":
      return "Semi-Private";
    case "private":
      return "Private";
    default:
      return type;
  }
}

// ============================================================================
// 12. ANTI-SPAM: ACTIVITY-BASED ROOM SORTING
// ============================================================================

function sortRoomsByActivity(rooms) {
  return rooms.slice().sort((a, b) => {
    // Spotlighted ("Official") rooms are always pinned to the top
    if (!!a.spotlight !== !!b.spotlight) return a.spotlight ? -1 : 1;

    const aCount = getJoinableCount(a);
    const bCount = getJoinableCount(b);

    if (aCount !== bCount) {
      return bCount - aCount;
    }

    const aActivity = a.lastChatActivity || 0;
    const bActivity = b.lastChatActivity || 0;
    if (aActivity !== bActivity) {
      return bActivity - aActivity;
    }

    const aCreated = a.createdAt || 0;
    const bCreated = b.createdAt || 0;
    return bCreated - aCreated;
  });
}

function updateLobby(rooms) {
  dynamicRoomList.innerHTML = "";
  const publicRooms = rooms.filter((room) => room.type !== "private");

  if (publicRooms.length === 0) {
    noRoomsMessage.style.display = "block";
    dynamicRoomList.style.display = "none";
  } else {
    noRoomsMessage.style.display = "none";
    dynamicRoomList.style.display = "block";

    const sortedRooms = sortRoomsByActivity(publicRooms);
    sortedRooms.forEach((room) => {
      const roomElement = createRoomElement(room);
      dynamicRoomList.appendChild(roomElement);
    });
  }
}

function showRoomList() {
  signInMessage.style.display = "none";
  roomListContainer.style.display = "block";

  if (socket.connected) {
    socket.emit("get rooms");
  } else {
    socket.once("connect", () => {
      socket.emit("get rooms");
    });
  }
}

// ============================================================================
// 13. INITIALIZATION
// ============================================================================

function initLobby() {
  document.querySelector('input[name="roomType"][value="public"]').checked =
    true;
  document.querySelector(
    'input[name="roomLayout"][value="horizontal"]',
  ).checked = true;

  statsModal = new StatsModal();

  // Guard the optional stats button: it was removed from the lobby menu, so
  // getElementById returns null. Without this guard the throw aborts the rest
  // of initLobby — including the Update Notes binding below.
  const statsBtn = document.getElementById("statsForNerdsButton");
  if (statsBtn)
    statsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      if (statsModal) {
        statsModal.open();
      }
    });

  // Update Notes: re-open the update popup (popup.js) on demand.
  const updateNotesBtn = document.getElementById("updateNotesButton");
  if (updateNotesBtn)
    updateNotesBtn.addEventListener("click", (e) => {
      e.preventDefault();
      if (window.TalkomaticPopup) window.TalkomaticPopup.forceShowPopup();
    });

  setTimeout(() => {
    const savedUsername = localStorage.getItem("talkomaticUsername");
    const savedLocation = localStorage.getItem("talkomaticLocation");

    if (savedUsername) {
      currentUsername = savedUsername;
      currentLocation = savedLocation || "On The Web";
      isSignedIn = true;

      usernameInput.value = currentUsername;
      locationInput.value = currentLocation;

      setSignedInButtonState();
      createRoomForm.classList.remove("hidden");

      emitJoinLobby(savedUsername, savedLocation || "On The Web");
      showRoomList();
    } else {
      const guestDigits = Math.floor(10000 + Math.random() * 90000);
      const guestUsername = `Guest${guestDigits}`;
      const guestLocation = "Earth";

      usernameInput.value = guestUsername;
      locationInput.value = guestLocation;

      localStorage.setItem("talkomaticUsername", guestUsername);
      localStorage.setItem("talkomaticLocation", guestLocation);

      currentUsername = guestUsername;
      currentLocation = guestLocation;
      isSignedIn = true;

      setSignedInButtonState();
      createRoomForm.classList.remove("hidden");

      emitJoinLobby(guestUsername, guestLocation);
      showRoomList();
    }
  }, 500);

  updateConnectionStatus();
}

window.addEventListener("load", () => {
  initLobby();
});

socket.on("initial rooms", (rooms) => {
  updateLobby(rooms);
});

window.addEventListener("beforeunload", () => {
  if (statsModal) {
    statsModal.close();
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 14. DEV / STAFF UI (lobby) — built on the shared StaffUI kit. The server
// validates the dev key on every action; this layer is presentation only.
// ════════════════════════════════════════════════════════════════════════════

let manageKeysOpen = false;
let blocksOpen = false;
let blocksCtrl = null;

function lobbyNotify(message, type, opts) {
  if (window.StaffUI)
    window.StaffUI.toast(
      message,
      Object.assign({ type: type || "info" }, opts || {}),
    );
}

function ensureDevPanelButton() {
  if (document.getElementById("devPanelButton")) return;
  const btn = document.createElement("button");
  btn.id = "devPanelButton";
  btn.type = "button";
  btn.innerHTML = '<i class="fas fa-screwdriver-wrench"></i> Dev Panel';
  btn.title = "Dev tools";
  btn.addEventListener("click", openDevPanel);
  document.body.appendChild(btn);
}

function openDevPanel() {
  if (!window.StaffUI) return;
  StaffUI.panel({
    title: "Dev panel",
    icon: '<i class="fas fa-screwdriver-wrench"></i>',
    subtitle: "Global staff tools",
    wide: true,
    onHelp: () => StaffUI.help("dev"),
    groups: [
      {
        title: "Moderators",
        items: [
          {
            icon: '<i class="fas fa-user-plus"></i>',
            label: "Grant mod key…",
            desc: "Create a key for a new mod (shown once)",
            onClick: async () => {
              const label = await StaffUI.prompt({
                title: "Grant mod key",
                icon: '<i class="fas fa-user-plus"></i>',
                fields: [
                  {
                    name: "value",
                    label: "Mod's name / label",
                    placeholder: "e.g. Alice",
                    required: true,
                    maxLength: 40,
                  },
                ],
                confirmText: "Generate key",
              });
              if (label) socket.emit("dev grant mod", { label });
            },
          },
          {
            icon: '<i class="fas fa-list"></i>',
            label: "Manage / revoke mod keys…",
            desc: "List current mods and revoke instantly",
            onClick: () => {
              manageKeysOpen = true;
              socket.emit("dev list mod keys");
            },
          },
        ],
      },
      {
        title: "Broadcast",
        items: [
          {
            icon: '<i class="fas fa-newspaper"></i>',
            label: "Lobby ticker…",
            desc: "Editable banner at the top of the lobby",
            onClick: async () => {
              const msg = await StaffUI.prompt({
                title: "Lobby ticker",
                icon: '<i class="fas fa-newspaper"></i>',
                fields: [
                  {
                    name: "value",
                    label: "Ticker message (blank to clear)",
                    type: "textarea",
                    maxLength: 200,
                  },
                ],
                confirmText: "Set ticker",
              });
              if (msg !== null) socket.emit("dev set ticker", { message: msg });
            },
          },
          {
            icon: '<i class="fas fa-tower-broadcast"></i>',
            label: "Megaphone everywhere…",
            desc: "Announcement to all rooms + lobby",
            onClick: async () => {
              const msg = await StaffUI.prompt({
                title: "Megaphone (everywhere)",
                icon: '<i class="fas fa-tower-broadcast"></i>',
                fields: [
                  {
                    name: "value",
                    label: "Announcement",
                    type: "textarea",
                    maxLength: 300,
                    required: true,
                  },
                ],
                confirmText: "Broadcast",
              });
              if (msg)
                socket.emit("staff megaphone", { scope: "all", message: msg });
            },
          },
        ],
      },
      {
        title: "Server",
        items: [
          {
            icon: '<i class="fas fa-flag"></i>',
            label: "Feature flags…",
            desc: "Word filter / room creation / limit",
            onClick: () => socket.emit("dev get flags"),
          },
          {
            icon: '<i class="fas fa-screwdriver-wrench"></i>',
            label: "Maintenance mode (toggle)",
            desc: "Pause new rooms + joins",
            onClick: () => socket.emit("dev set maintenance", {}),
          },
          {
            icon: '<i class="fas fa-fire-extinguisher"></i>',
            label: "Clear bot blacklist",
            desc: "Lift all bot-blacklist entries",
            onClick: async () => {
              if (
                await StaffUI.confirm({
                  title: "Clear blacklist",
                  message: "Clear the entire bot blacklist?",
                })
              )
                socket.emit("dev clear blacklist");
            },
          },
          {
            icon: '<i class="fas fa-unlock"></i>',
            label: "Blocked IPs…",
            desc: "See who is blocked and unblock them",
            onClick: () => {
              blocksOpen = true;
              socket.emit("dev list blocks");
            },
          },
          {
            icon: '<i class="fas fa-bomb"></i>',
            label: "NUKE all rooms",
            danger: true,
            desc: "Emergency clear of every room",
            onClick: async () => {
              const r = await StaffUI.prompt({
                title: "Nuke all rooms",
                icon: '<i class="fas fa-bomb"></i>',
                danger: true,
                message:
                  "Clears EVERY room and removes ALL users. Type NUKE to confirm.",
                fields: [
                  {
                    name: "value",
                    label: "Type NUKE",
                    placeholder: "NUKE",
                    required: true,
                  },
                ],
                confirmText: "NUKE",
              });
              if (r && r.trim().toUpperCase() === "NUKE")
                socket.emit("staff nuke", { confirm: true });
              else if (r != null)
                lobbyNotify("Nuke cancelled. The text did not match.", "info");
            },
          },
        ],
      },
      {
        title: "Accountability",
        items: [
          {
            icon: '<i class="fas fa-clipboard"></i>',
            label: "Open Mod Dashboard",
            desc: "Every staff action + identity change",
            onClick: () => window.open("/mod.html", "_blank"),
          },
        ],
      },
    ],
  });
}

// ── Mod key results ──────────────────────────────────────────────────────────
socket.on("dev mod granted", (data) => {
  if (!data || !data.key || !window.StaffUI) return;
  const cmd = `localStorage.setItem('talkomatic_modKey','${data.key}')`;
  const wrap = StaffUI.el("div");
  wrap.appendChild(
    StaffUI.el("p", {
      text: `New mod key for "${data.label}". This is shown ONCE, so copy it now and send it to them.`,
    }),
  );
  const input = StaffUI.el("input", {
    class: "tk-input",
    type: "text",
    readonly: "readonly",
    value: data.key,
  });
  input.addEventListener("focus", () => input.select());
  wrap.appendChild(input);
  wrap.appendChild(
    StaffUI.el("p", {
      class: "tk-help",
      text: "They activate it by running this in their browser console, then reloading:",
    }),
  );
  const code = StaffUI.el("div", {
    style:
      "font-family:monospace;font-size:11px;color:#ffd700;background:#0e0f12;border:1px solid #23262e;border-radius:7px;padding:8px;word-break:break-all;margin-top:4px;",
  });
  code.textContent = cmd;
  wrap.appendChild(code);
  StaffUI.modal({
    title: "Mod key granted",
    icon: '<i class="fas fa-key"></i>',
    wide: true,
    body: wrap,
    actions: [
      {
        label: "Copy key",
        kind: "ghost",
        onClick: () => {
          StaffUI.copy(data.key);
          lobbyNotify("Key copied.", "success");
          return false;
        },
      },
      {
        label: "Copy command",
        kind: "ghost",
        onClick: () => {
          StaffUI.copy(cmd);
          lobbyNotify("Command copied.", "success");
          return false;
        },
      },
      { label: "Done", kind: "primary", onClick: () => {} },
    ],
  });
});

socket.on("dev mod keys", (keys) => {
  if (!manageKeysOpen || !window.StaffUI) return;
  const list = Array.isArray(keys) ? keys : [];
  const items = list.length
    ? list.map((k) => ({
        icon: '<i class="fas fa-user-shield"></i>',
        label: k.label,
        desc: "key " + k.hash.slice(0, 12) + "…",
        danger: true,
        keepOpen: true,
        onClick: async () => {
          if (
            await StaffUI.confirm({
              title: "Revoke mod",
              message: `Revoke "${k.label}"? They are downgraded instantly.`,
              danger: true,
              confirmText: "Revoke",
            })
          )
            socket.emit("dev revoke mod", { hash: k.hash });
        },
      }))
    : [
        {
          icon: "·",
          label: "No mod keys yet",
          desc: "Use Grant mod key to create one",
        },
      ];
  StaffUI.menu({
    title: "Mod keys",
    icon: '<i class="fas fa-list"></i>',
    subtitle: `${list.length} active`,
    groups: [{ items }],
    onHelp: () => StaffUI.help("dev"),
  });
});

socket.on("dev blocks", (list) => {
  if (!blocksOpen || !window.StaffUI) return;
  const blocks = Array.isArray(list) ? list : [];
  const fmtExpiry = (b) => {
    if (b.permanent) return "permanent";
    if (!b.expiry) return "active";
    const mins = Math.round((b.expiry - Date.now()) / 60000);
    if (mins <= 0) return "expiring";
    if (mins < 60) return mins + " min left";
    const hrs = Math.round(mins / 60);
    if (hrs < 48) return hrs + " hr left";
    return Math.round(hrs / 24) + " days left";
  };
  const items = blocks.length
    ? blocks.map((b) => ({
        icon: '<i class="fas fa-ban"></i>',
        label: (b.label ? b.label + "  " : "") + b.ip,
        desc:
          fmtExpiry(b) +
          (b.by ? "  •  blocked by " + b.by : "") +
          (b.reason ? "  •  " + b.reason : "") +
          "  •  tap to unblock",
        danger: true,
        keepOpen: true,
        onClick: async () => {
          if (
            await StaffUI.confirm({
              title: "Unblock",
              message:
                "Unblock " +
                (b.label ? b.label + " (" + b.ip + ")" : b.ip) +
                "?",
              confirmText: "Unblock",
            })
          )
            socket.emit("dev unblock ip", { ip: b.ip });
        },
      }))
    : [
        {
          icon: "·",
          label: "No blocked IPs",
          desc: "Nobody is currently blocked",
        },
      ];
  if (blocksCtrl) blocksCtrl.close();
  blocksCtrl = StaffUI.menu({
    title: "Blocked IPs",
    icon: '<i class="fas fa-unlock"></i>',
    subtitle: blocks.length + " active",
    groups: [{ items }],
  });
});

socket.on("dev flags", (flags) => {
  if (!flags || !window.StaffUI) return;
  StaffUI.menu({
    title: "Feature flags",
    icon: '<i class="fas fa-flag"></i>',
    subtitle: "Live server configuration",
    groups: [
      {
        items: [
          {
            icon: flags.wordFilter
              ? '<i class="fas fa-circle-check"></i>'
              : '<i class="fas fa-ban"></i>',
            label: `Word filter (global): ${flags.wordFilter ? "ON" : "OFF"}`,
            desc: "Toggle the global word filter",
            onClick: () =>
              socket.emit("dev set flags", { wordFilter: !flags.wordFilter }),
          },
          {
            icon: flags.roomCreation
              ? '<i class="fas fa-circle-check"></i>'
              : '<i class="fas fa-ban"></i>',
            label: `Room creation: ${flags.roomCreation ? "ON" : "OFF"}`,
            desc: "Allow users to create rooms",
            onClick: () =>
              socket.emit("dev set flags", {
                roomCreation: !flags.roomCreation,
              }),
          },
          {
            icon: '<i class="fas fa-hashtag"></i>',
            label: `Room limit: ${flags.baseMaxRooms}`,
            desc: "How many rooms can exist at once",
            onClick: async () => {
              const v = await StaffUI.prompt({
                title: "Room limit",
                fields: [
                  {
                    name: "value",
                    label: "Base room limit",
                    type: "number",
                    value: String(flags.baseMaxRooms),
                    required: true,
                  },
                ],
              });
              const n = parseInt(v, 10);
              if (Number.isFinite(n))
                socket.emit("dev set flags", { baseMaxRooms: n });
            },
          },
          {
            icon: '<i class="fas fa-users"></i>',
            label: `Max room size: ${flags.maxRoomCapacity} people`,
            desc: "How many users fit in one room (2 to 50)",
            onClick: async () => {
              const v = await StaffUI.prompt({
                title: "Max room size",
                icon: '<i class="fas fa-users"></i>',
                message: "How many people can be in a single room (2 to 50)?",
                fields: [
                  {
                    name: "value",
                    label: "Max users per room",
                    type: "number",
                    value: String(flags.maxRoomCapacity),
                    required: true,
                  },
                ],
              });
              const n = parseInt(v, 10);
              if (Number.isFinite(n))
                socket.emit("dev set flags", { maxRoomCapacity: n });
            },
          },
          {
            icon: flags.maintenance
              ? '<i class="fas fa-screwdriver-wrench"></i>'
              : '<i class="fas fa-circle-check"></i>',
            label: `Maintenance: ${flags.maintenance ? "ON" : "OFF"}`,
            desc: "Toggle maintenance mode",
            onClick: () => socket.emit("dev set maintenance", {}),
          },
        ],
      },
    ],
  });
});

socket.on("staff action result", (data) => {
  if (data)
    lobbyNotify(
      (data.ok ? "Done: " : "Failed: ") + data.action,
      data.ok ? "success" : "error",
    );
});

socket.on("staff revoked", () => {
  localStorage.removeItem("talkomatic_modKey");
  currentUserIsMod = false;
  lobbyNotify("Your mod key was revoked.", "warning", { timeout: 6000 });
  setTimeout(() => window.location.reload(), 1500);
});

// ── Staff key entry (no console needed) ──────────────────────────────────────
let pendingStaffKey = null;
async function openStaffKeyEntry() {
  if (!window.StaffUI) return;
  const key = await StaffUI.prompt({
    title: "Staff access",
    icon: '<i class="fas fa-key"></i>',
    subtitle: "Enter your dev or mod key",
    message:
      "All keys are verified, logged, and monitored on our servers. Sharing your key with anyone will result in a permanent ban from Talkomatic.",
    fields: [
      {
        name: "value",
        label: "Staff key",
        type: "password",
        placeholder: "paste your key",
        required: true,
      },
    ],
    confirmText: "Unlock",
  });
  if (key) {
    pendingStaffKey = key;
    socket.emit("staff validate key", { key });
  }
}
socket.on("staff key result", (d) => {
  if (!d || !d.role) {
    lobbyNotify(
      d && d.throttled
        ? "Too many attempts. Wait a few minutes."
        : "That key was not recognized.",
      "error",
    );
    pendingStaffKey = null;
    return;
  }
  if (d.role === "dev")
    localStorage.setItem("talkomatic_devKey", pendingStaffKey);
  else localStorage.setItem("talkomatic_modKey", pendingStaffKey);
  pendingStaffKey = null;
  lobbyNotify(
    `Key accepted. You are ${d.role}${d.label ? " (" + d.label + ")" : ""}. Reloading…`,
    "success",
  );
  setTimeout(() => window.location.reload(), 1200);
});
socket.on("you are now mod", (d) => {
  if (!d || !d.key) return;
  localStorage.setItem("talkomatic_modKey", d.key);
  lobbyNotify("You've been promoted to Moderator! Reloading…", "success", {
    title: "You are now a mod",
    timeout: 4000,
  });
  setTimeout(() => window.location.reload(), 1600);
});
// Key entry is reachable from the "Staff Access" link in the lobby menu, by
// opening the lobby with #staff in the URL, or via the deep link from mod.html.
const staffLoginLink = document.getElementById("staffLoginLink");
if (staffLoginLink)
  staffLoginLink.addEventListener("click", (e) => {
    e.preventDefault();
    // Already signed in as staff: jump straight to the dashboard (mod.html is
    // exempt from the single-tab guard). Otherwise open the key-entry box.
    if (currentUserIsDev || currentUserIsMod)
      window.open("/mod.html", "_blank");
    else openStaffKeyEntry();
  });

// Reflect the server-proven staff role in the menu link: "Staff Access" becomes
// "Mod Dashboard" for mods and "Dev Dashboard" for devs once a key validates.
function updateStaffLink() {
  const link = document.getElementById("staffLoginLink");
  if (!link) return;
  if (currentUserIsDev)
    link.innerHTML = '<i class="fas fa-gauge-high"></i> Dev Dashboard';
  else if (currentUserIsMod)
    link.innerHTML = '<i class="fas fa-gauge-high"></i> Mod Dashboard';
  else link.innerHTML = '<i class="fas fa-key"></i> Staff Access';
}
updateStaffLink();
if (window.location.hash === "#staff") setTimeout(openStaffKeyEntry, 700);
window.addEventListener("hashchange", () => {
  if (window.location.hash === "#staff") openStaffKeyEntry();
});

// ── Lobby ticker bar ─────────────────────────────────────────────────────────
function setLobbyTicker(message) {
  let bar = document.getElementById("lobbyTickerBar");
  if (!message) {
    if (bar) bar.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "lobbyTickerBar";
    document.body.appendChild(bar);
  }
  bar.textContent = message;
}
socket.on("lobby ticker", (data) =>
  setLobbyTicker((data && data.message) || ""),
);

socket.on("megaphone", (data) => {
  if (data && data.message)
    lobbyNotify(data.message, "warning", {
      title: "Announcement",
      fullWidth: true,
      timeout: 14000,
    });
});

socket.on("maintenance status", (data) => {
  let bar = document.getElementById("lobbyMaintenanceBar");
  if (data && data.enabled) {
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "lobbyMaintenanceBar";
      bar.textContent =
        "Maintenance mode: creating rooms and joining are paused.";
      document.body.appendChild(bar);
    }
  } else if (bar) {
    bar.remove();
  }
});

// Lobby staff styles (badges, spotlight, dev button, ticker / maintenance bars)
(function injectLobbyStaffStyles() {
  const css = `
    .mod-lobby-badge{display:inline-block;background:#00bcd4;color:#003;font-size:8px;font-weight:bold;padding:1px 4px;border-radius:6px;margin:0 4px;letter-spacing:.5px;vertical-align:middle;}
    .official-badge{display:inline-block;background:#ffd700;color:#3a2c00;font-size:9px;font-weight:bold;padding:1px 6px;border-radius:8px;margin-right:6px;letter-spacing:.5px;}
    .room.spotlight-room{border:1px solid #ffd700 !important;box-shadow:0 0 0 1px rgba(255,215,0,.25) inset;}
    .lobby-dev-controls{display:flex;gap:6px;margin-top:6px;}
    .lobby-dev-btn{flex:1;background:#15161a;color:#ff9800;border:1px solid #2c2f37;border-radius:6px;padding:5px 6px;font-size:11px;cursor:pointer;font-weight:600;}
    .lobby-dev-btn:hover{border-color:#ff9800;background:#1d1a12;}
    #devPanelButton{position:fixed;bottom:16px;right:16px;z-index:99990;background: #030303;color: #ffffff;border:1px solid #ff9800;border-radius:8px;padding:10px 16px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.5);}
    #devPanelButton:hover{background: #252525;}
    #lobbyTickerBar{position:fixed;top:0;left:0;right:0;z-index:99980;background:#ff9800;color:#1a1206;text-align:center;font-size:13px;font-weight:700;padding:7px 16px;letter-spacing:.3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-sizing:border-box;}
    #lobbyMaintenanceBar{position:fixed;bottom:0;left:0;right:0;z-index:99980;background:#5c2d91;color:#fff;text-align:center;font-size:13px;font-weight:700;padding:7px 16px;box-sizing:border-box;}
  `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
})();

// ============================================================================
// 15. 2ND ANNIVERSARY (festive, themed to match Talkomatic). A birthday banner
//     plus an auto-opening modal with a cake, the story, confetti, the party
//     horn, and a LIVE community "candles lit" counter shared across everyone.
//     Auto-opens once per session; revisit anytime from the cake in the menu.
// ============================================================================
(function anniversary() {
  const SEEN_KEY = "tk_anniv_seen_v1";
  const BANNER_KEY = "tk_anniv_banner_dismissed_v1";
  let celebrated = sessionStorage.getItem("tk_anniv_celebrated") === "1";
  let hornAudio = null;

  const css = `
    .tk-anniv-banner{display:flex;align-items:center;gap:10px;background:#1a1a1a;border:1px solid #000000;border-radius:2px;padding:10px 12px;color:#fff;font-size:13.5px;}
    .tk-anniv-banner .cake{font-size:22px;line-height:1;}
    .tk-anniv-banner .msg{flex:1;line-height:1.25;min-width:0;font-weight:700;}
    .tk-anniv-banner .msg small{display:block;font-weight:500;color:#bbb;font-size:11px;}
    .tk-anniv-banner .celebrate{background:#ff9800;color:#000;border:none;border-radius:2px;padding:7px 13px;font-weight:700;cursor:pointer;font-size:12.5px;white-space:nowrap;}
    .tk-anniv-banner .celebrate:hover{background:#ffb74d;}
    .tk-anniv-banner .x{background:none;border:none;color:#888;font-size:18px;cursor:pointer;line-height:1;padding:0 2px;}
    .tk-anniv-banner .x:hover{color:#ff9800;}
    .tk-anniv-overlay{position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,.82);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;animation:tkAFade .2s ease;}
    @keyframes tkAFade{from{opacity:0}to{opacity:1}}
    .tk-anniv-card{position:relative;background:linear-gradient(135deg,#1a1a1a 0%,#2a2a2a 100%);border:2px solid #ff9800;border-radius:12px;max-width:430px;width:100%;max-height:92vh;overflow-y:auto;padding:26px 24px 20px;text-align:center;color:#eee;box-shadow:0 16px 50px rgba(0,0,0,.6);box-sizing:border-box;animation:tkARise .3s ease;}
    @keyframes tkARise{from{transform:translateY(16px);opacity:0}to{transform:translateY(0);opacity:1}}
    .tk-anniv-card .ax{position:absolute;top:10px;right:14px;background:#000;border:1px solid #616161;color:#ff9800;font-size:18px;cursor:pointer;line-height:1;width:30px;height:30px;border-radius:2px;}
    .tk-anniv-card .ax:hover{background:#ff9800;color:#000;}
    .tk-anniv-tag{display:inline-block;background:#ff9800;color:#000;font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;padding:3px 12px;border-radius:2px;margin-bottom:10px;}
    .tk-anniv-cake{width:156px;height:148px;display:block;margin:2px auto 8px;}
    .tk-anniv-flame{transform-box:fill-box;transform-origin:center bottom;animation:tkFlame 2.2s ease-in-out infinite;}
    .tk-anniv-flame.f2{animation-duration:2.6s;animation-delay:.5s;}
    @keyframes tkFlame{0%,100%{transform:rotate(-2deg) scaleX(1) scaleY(1);opacity:.92}25%{transform:rotate(1.5deg) scaleX(.97) scaleY(1.03);opacity:1}50%{transform:rotate(2.5deg) scaleX(1) scaleY(.99);opacity:.96}75%{transform:rotate(-1deg) scaleX(1.02) scaleY(1.02);opacity:1}}
    .tk-anniv-title{font-size:23px;font-weight:800;color:#ff9800;margin:0 0 3px;}
    .tk-anniv-sub{color:#cfcfcf;font-size:13px;margin:0 0 14px;}
    .tk-anniv-body{color:#ddd;font-size:13.5px;line-height:1.6;margin:0 0 15px;}
    .tk-anniv-timeline{display:flex;justify-content:center;gap:8px;margin:0 0 15px;}
    .tk-anniv-tl{flex:1;min-width:0;background:#000;border:1px solid #616161;border-radius:2px;padding:9px 6px;}
    .tk-anniv-tl .y{color:#ff9800;font-weight:800;font-size:15px;}
    .tk-anniv-tl .t{color:#aaa;font-size:10.5px;line-height:1.3;margin-top:3px;}
    .tk-anniv-count{background:#000;border:1px solid #616161;border-radius:2px;padding:12px;margin:0 0 14px;}
    .tk-anniv-count .n{font-size:27px;font-weight:800;color:#ff9800;line-height:1.1;}
    .tk-anniv-count .l{font-size:12px;color:#aaa;margin-top:2px;}
    .tk-anniv-btn{background:#ff9800;color:#000;border:none;border-radius:2px;padding:13px 20px;font-size:15px;font-weight:800;cursor:pointer;width:100%;box-sizing:border-box;text-transform:uppercase;letter-spacing:.5px;}
    .tk-anniv-btn:hover{background:#ffb74d;}
    .tk-anniv-foot{color:#8a8a8a;font-size:11.5px;margin:13px 0 0;}
    .tk-confetti-piece{position:fixed;top:-14px;z-index:100060;pointer-events:none;}
  `;
  const styleEl = document.createElement("style");
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  const CAKE = `
    <svg class="tk-anniv-cake" viewBox="0 0 160 148" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <ellipse cx="80" cy="130" rx="62" ry="8" fill="#000"/>
      <rect x="34" y="86" width="92" height="40" rx="3" fill="#ff7a18"/>
      <rect x="34" y="86" width="92" height="13" rx="3" fill="#fff1dd"/>
      <rect x="52" y="56" width="56" height="34" rx="3" fill="#ff9800"/>
      <rect x="52" y="56" width="56" height="12" rx="3" fill="#fff1dd"/>
      <circle cx="50" cy="112" r="2" fill="#fff1dd"/><circle cx="72" cy="117" r="2" fill="#ffce85"/>
      <circle cx="92" cy="111" r="2" fill="#fff1dd"/><circle cx="110" cy="117" r="2" fill="#ffce85"/>
      <circle cx="66" cy="79" r="1.8" fill="#fff1dd"/><circle cx="94" cy="81" r="1.8" fill="#ffce85"/>
      <rect x="65" y="30" width="6" height="28" rx="1" fill="#fff1dd"/>
      <rect x="89" y="30" width="6" height="28" rx="1" fill="#ffce85"/>
      <ellipse class="tk-anniv-flame" cx="68" cy="24" rx="4.6" ry="8.5" fill="#ffce85"/>
      <ellipse class="tk-anniv-flame" cx="68" cy="25" rx="2.2" ry="4.8" fill="#ff7a18"/>
      <ellipse class="tk-anniv-flame f2" cx="92" cy="24" rx="4.6" ry="8.5" fill="#ffce85"/>
      <ellipse class="tk-anniv-flame f2" cx="92" cy="25" rx="2.2" ry="4.8" fill="#ff7a18"/>
    </svg>`;

  function confetti(n) {
    const colors = ["#ff9800", "#ffb454", "#ffce85", "#ffffff", "#ff7a18"];
    for (let i = 0; i < n; i++) {
      const p = document.createElement("div");
      p.className = "tk-confetti-piece";
      const size = 6 + Math.random() * 8;
      p.style.left = Math.random() * 100 + "vw";
      p.style.width = size + "px";
      p.style.height = size * 0.5 + "px";
      p.style.background = colors[i % colors.length];
      const dur = 2200 + Math.random() * 2200;
      const dir = Math.random() > 0.5 ? 1 : -1;
      p.animate(
        [
          { transform: "translateY(-20px) rotate(0deg)", opacity: 1 },
          {
            transform: `translateY(106vh) rotate(${720 * dir}deg)`,
            opacity: 0.9,
          },
        ],
        { duration: dur, easing: "cubic-bezier(.3,.6,.5,1)" },
      );
      document.body.appendChild(p);
      setTimeout(() => p.remove(), dur + 120);
    }
  }
  function playHorn() {
    try {
      if (!hornAudio) hornAudio = new Audio("audio/party-horn.mp3");
      hornAudio.currentTime = 0;
      hornAudio.play().catch(() => {});
    } catch (_) {}
  }

  function setCount(c) {
    const el = document.getElementById("annivCount");
    if (el && typeof c === "number") el.textContent = c.toLocaleString();
  }
  function requestCount() {
    if (socket.connected) socket.emit("get anniversary");
    else socket.once("connect", () => socket.emit("get anniversary"));
  }
  socket.on("anniversary count", (d) => {
    if (d) setCount(d.count);
  });

  function celebrate() {
    confetti(120);
    playHorn();
    if (!celebrated) {
      celebrated = true;
      sessionStorage.setItem("tk_anniv_celebrated", "1");
      socket.emit("celebrate");
      const btn = document.getElementById("annivCelebrateBtn");
      if (btn) btn.textContent = "Celebrate again";
    }
  }

  let overlay = null;
  function closeModal() {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
  }
  function openModal() {
    closeModal();
    overlay = document.createElement("div");
    overlay.className = "tk-anniv-overlay";
    const card = document.createElement("div");
    card.className = "tk-anniv-card";
    card.innerHTML =
      '<button class="ax" aria-label="Close">&times;</button>' +
      '<div class="tk-anniv-tag">Two years</div>' +
      CAKE +
      '<h2 class="tk-anniv-title">Happy Birthday, Talkomatic!</h2>' +
      '<p class="tk-anniv-sub">The open source edition turns two today.</p>' +
      '<p class="tk-anniv-body">It started in 1973 on the PLATO system as the very first online chat. In 2024 it came back to life, open source. Two years on, people are still here typing letter by letter with strangers around the world. Thank you for keeping it alive.</p>' +
      '<div class="tk-anniv-timeline">' +
      '<div class="tk-anniv-tl"><div class="y">1973</div><div class="t">Born on PLATO</div></div>' +
      '<div class="tk-anniv-tl"><div class="y">2024</div><div class="t">Reborn, open source</div></div>' +
      '<div class="tk-anniv-tl"><div class="y">2026</div><div class="t">Turns two</div></div>' +
      "</div>" +
      '<div class="tk-anniv-count"><div class="n" id="annivCount">...</div><div class="l">candles lit by the community</div></div>' +
      '<button class="tk-anniv-btn" id="annivCelebrateBtn">Light a candle</button>' +
      '<p class="tk-anniv-foot">Come back anytime from the cake in the menu.</p>';
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    if (celebrated) {
      const btn = card.querySelector("#annivCelebrateBtn");
      if (btn) btn.textContent = "Celebrate again";
    }
    card.querySelector(".ax").addEventListener("click", closeModal);
    card
      .querySelector("#annivCelebrateBtn")
      .addEventListener("click", celebrate);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
    });
    document.addEventListener("keydown", function esc(e) {
      if (e.key === "Escape") {
        closeModal();
        document.removeEventListener("keydown", esc);
      }
    });
    requestCount();
    confetti(70);
  }

  function buildBanner() {
    if (localStorage.getItem(BANNER_KEY) === "1") return;
    const panel = document.querySelector(".right-panel");
    if (!panel || document.querySelector(".tk-anniv-banner")) return;
    const banner = document.createElement("div");
    banner.className = "tk-anniv-banner";
    banner.innerHTML =
      '<span class="cake">🎂</span>' +
      '<div class="msg">Talkomatic is 2 today!<small>2024 to 2026. Thanks for being here.</small></div>' +
      '<button class="celebrate" type="button">Celebrate</button>' +
      '<button class="x" type="button" aria-label="Dismiss">&times;</button>';
    banner.querySelector(".celebrate").addEventListener("click", openModal);
    banner.querySelector(".x").addEventListener("click", () => {
      localStorage.setItem(BANNER_KEY, "1");
      banner.remove();
    });
    panel.insertBefore(banner, panel.firstChild);
  }

  function init() {
    buildBanner();
    requestCount();
    const link = document.getElementById("anniversaryLink");
    if (link)
      link.addEventListener("click", (e) => {
        e.preventDefault();
        openModal();
      });
    if (!sessionStorage.getItem(SEEN_KEY)) {
      sessionStorage.setItem(SEEN_KEY, "1");
      setTimeout(openModal, 900);
    }
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else init();
})();
