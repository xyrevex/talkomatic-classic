/**
 * Talkomatic Update Popup Manager
 * Handles showing update popups based on version changes and time intervals
 */
class TalkomaticPopupManager {
  constructor() {
    // Current version - update this when you release new versions.
    // Bumping this re-shows the popup to everyone (see shouldShowPopup).
    this.currentVersion = "5.3.0";
    // Cookie names
    this.cookieNames = {
      lastShown: "talkomatic_popup_last_shown",
      lastVersion: "talkomatic_popup_last_version",
    };
    // Time intervals (in milliseconds)
    this.intervals = {
      thirtyDays: 30 * 24 * 60 * 60 * 1000, // 30 days in milliseconds
    };
    this.popupContainer = null;
    this.isPopupVisible = false;
  }

  /**
   * Initialize the popup manager - call this on page load
   */
  init() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () =>
        this.checkAndShowPopup(),
      );
    } else {
      this.checkAndShowPopup();
    }
  }

  /**
   * Check if popup should be shown and display it if needed
   */
  checkAndShowPopup() {
    if (this.shouldShowPopup()) {
      this.createAndShowPopup();
    }
  }

  /**
   * Determine if the popup should be shown
   * @returns {boolean} - true if popup should be shown
   */
  shouldShowPopup() {
    const lastShown = this.getCookie(this.cookieNames.lastShown);
    const lastVersion = this.getCookie(this.cookieNames.lastVersion);
    // First visit - show popup
    if (!lastShown || !lastVersion) {
      return true;
    }
    // Version changed - show popup regardless of time
    if (lastVersion !== this.currentVersion) {
      return true;
    }
    // Same version - check if 30 days have passed
    const lastShownDate = new Date(parseInt(lastShown));
    const now = new Date();
    const timeDifference = now.getTime() - lastShownDate.getTime();
    return timeDifference >= this.intervals.thirtyDays;
  }

  /**
   * Create popup styles
   */
  createPopupStyles() {
    const styleId = "talkomatic-popup-styles";
    if (document.getElementById(styleId)) {
      return; // Styles already added
    }
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
            /* Talkomatic Popup Styles */
            .talkomatic-popup-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.85);
                z-index: 999999;
                display: flex;
                justify-content: center;
                align-items: center;
                padding: 20px;
                box-sizing: border-box;
                animation: talkomaticFadeIn 0.3s ease-in-out;
            }
            @keyframes talkomaticFadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            @keyframes talkomaticFadeOut {
                from { opacity: 1; }
                to { opacity: 0; }
            }
            @keyframes talkomaticSlideIn {
                from {
                    transform: translateY(-30px);
                    opacity: 0;
                }
                to {
                    transform: translateY(0);
                    opacity: 1;
                }
            }
            .talkomatic-popup-content {
                background-color: #202020;
                border: 1px solid #616161;
                border-radius: 2px;
                max-width: 950px;
                width: 100%;
                max-height: 90vh;
                overflow-y: auto;
                position: relative;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
                color: white;
                font-family: Arial, sans-serif;
                animation: talkomaticSlideIn 0.3s ease-out;
            }
            .talkomatic-popup-header {
                background: linear-gradient(to bottom, #616161, #303030);
                padding: 2rem;
                position: relative;
                border-bottom: 1px solid #616161;
            }
            .talkomatic-popup-close {
                position: absolute;
                right: 1rem;
                top: 1rem;
                font-size: 1.8rem;
                cursor: pointer;
                color: #FF9800;
                transition: all 0.2s;
                width: 32px;
                height: 32px;
                display: flex;
                align-items: center;
                justify-content: center;
                border: 1px solid #616161;
                border-radius: 2px;
                background-color: #000000;
            }
            .talkomatic-popup-close:hover {
                background-color: #FF9800;
                color: #000000;
                transform: scale(1.1);
            }
            .talkomatic-popup-title {
                margin: 0;
                font-size: 26px;
                font-weight: bold;
                color: #FF9800;
                margin-bottom: 0.5rem;
                padding-right: 40px;
                text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
            }
            .talkomatic-popup-version {
                margin: 0;
                font-size: 14px;
                color: #ffffff;
                opacity: 0.9;
                font-weight: 500;
            }
            .talkomatic-version-pill {
                display: inline-block;
                background: #FF9800;
                color: #000000;
                font-size: 12px;
                font-weight: bold;
                padding: 3px 12px;
                border-radius: 2px;
                margin-top: 10px;
                letter-spacing: 1px;
                text-transform: uppercase;
            }
            .talkomatic-popup-body {
                padding: 2rem;
                line-height: 1.6;
            }
            .talkomatic-update-section {
                margin-bottom: 3rem;
            }
            .talkomatic-update-section h3 {
                color: #FF9800;
                margin-bottom: 1.5rem;
                font-size: 22px;
                font-weight: bold;
                border-bottom: 2px solid #FF9800;
                padding-bottom: 0.5rem;
            }
            .talkomatic-feature-list {
                list-style: none;
                padding: 0;
                margin-bottom: 1rem;
            }
            .talkomatic-feature-list li {
                padding: 15px 0;
                border-bottom: 1px solid #404040;
                position: relative;
                padding-left: 30px;
                color: #ffffff;
                font-size: 15px;
                transition: background-color 0.2s ease;
            }
            .talkomatic-feature-list li:hover {
                background-color: rgba(255, 152, 0, 0.05);
                border-radius: 2px;
                margin: 0 -10px;
                padding-left: 40px;
                padding-right: 10px;
            }
            .talkomatic-feature-list li:before {
                content: "\\2022";
                color: #FF9800;
                font-weight: bold;
                position: absolute;
                left: 0;
                font-size: 20px;
            }
            .talkomatic-feature-list li:last-child {
                border-bottom: none;
            }
            .talkomatic-feature-list.tk-iconed li {
                padding-left: 40px;
            }
            .talkomatic-feature-list.tk-iconed li:hover {
                margin: 0;
                padding-left: 40px;
                padding-right: 0;
            }
            .talkomatic-feature-list.tk-iconed li:before {
                display: none;
            }
            .talkomatic-feature-list .tk-lic {
                position: absolute;
                left: 8px;
                top: 18px;
                color: #FF9800;
                font-size: 15px;
                width: 22px;
                text-align: center;
            }
            .talkomatic-update-section h3 i {
                margin-right: 8px;
            }
            .talkomatic-feature-icon i {
                line-height: 1;
            }
            .talkomatic-badge {
                display: inline-block;
                padding: 4px 10px;
                border-radius: 2px;
                font-size: 11px;
                font-weight: bold;
                margin-left: 12px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .talkomatic-badge.new {
                background: #FF9800;
                color: #000000;
                box-shadow: 0 2px 4px rgba(255, 152, 0, 0.3);
            }
            .talkomatic-badge.improved {
                background: #01ffff;
                color: #000000;
                box-shadow: 0 2px 4px rgba(1, 255, 255, 0.3);
            }
            .talkomatic-badge.fixed {
                background: #616161;
                color: #ffffff;
                box-shadow: 0 2px 4px rgba(97, 97, 97, 0.3);
            }
            .talkomatic-badge.privacy {
                background: #4caf50;
                color: #000000;
                box-shadow: 0 2px 4px rgba(76, 175, 80, 0.3);
            }
            .talkomatic-feature-grid {
                display: grid;
                gap: 1.5rem;
                margin-top: 1rem;
            }
            .talkomatic-feature-item {
                background-color: #000000;
                padding: 2rem;
                border-radius: 2px;
                border: 1px solid #616161;
                transition: all 0.3s ease;
                text-align: center;
            }
            .talkomatic-feature-item:hover {
                border-color: #FF9800;
                transform: translateY(-4px);
                box-shadow: 0 8px 20px rgba(255, 152, 0, 0.15);
            }
            .talkomatic-feature-icon {
                width: 56px;
                height: 56px;
                margin: 0 auto 1.5rem;
                background: linear-gradient(135deg, #FF9800, #ff8c42);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 28px;
                color: #000000;
                box-shadow: 0 4px 12px rgba(255, 152, 0, 0.3);
            }
            .talkomatic-feature-item h4 {
                margin: 0.5rem 0 1rem 0;
                color: #FF9800;
                font-size: 18px;
                font-weight: bold;
            }
            .talkomatic-feature-item p {
                margin: 0;
                color: #cccccc;
                font-size: 15px;
                line-height: 1.6;
            }
            .talkomatic-highlight-box {
                background: linear-gradient(135deg, #000000, #1a1a1a);
                border: 2px solid #FF9800;
                border-radius: 2px;
                padding: 2rem;
                margin: 2rem 0;
                position: relative;
                overflow: hidden;
            }
            .talkomatic-highlight-box:before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 4px;
                background: linear-gradient(90deg, #FF9800, #ff8c42, #FF9800);
            }
            .talkomatic-highlight-box h4 {
                color: #FF9800;
                margin-bottom: 1rem;
                font-size: 20px;
                font-weight: bold;
            }
            .talkomatic-highlight-box p {
                color: #ffffff;
                margin: 0;
                font-size: 16px;
                line-height: 1.6;
            }
            .talkomatic-popup-footer {
                padding: 24px 2rem;
                background: linear-gradient(to bottom, #000000, #1a1a1a);
                border-radius: 0 0 2px 2px;
                border-top: 1px solid #616161;
                text-align: center;
            }
            .talkomatic-popup-footer button {
                padding: 14px 24px;
                background-color: #000000;
                color: white;
                border: 2px solid #FF9800;
                border-radius: 2px;
                cursor: pointer;
                font-size: 16px;
                font-weight: bold;
                transition: all 0.3s ease;
                font-family: inherit;
                text-transform: uppercase;
                letter-spacing: 1px;
            }
            .talkomatic-popup-footer button:hover {
                background-color: #FF9800;
                color: #000000;
                transform: translateY(-2px);
                box-shadow: 0 6px 16px rgba(255, 152, 0, 0.4);
            }
            .talkomatic-popup-content::-webkit-scrollbar {
                width: 12px;
            }
            .talkomatic-popup-content::-webkit-scrollbar-track {
                background: #202020;
            }
            .talkomatic-popup-content::-webkit-scrollbar-thumb {
                background: #FF9800;
                border-radius: 2px;
            }
            @media (min-width: 768px) {
                .talkomatic-feature-grid {
                    grid-template-columns: repeat(2, 1fr);
                }
            }
            @media (min-width: 992px) {
                .talkomatic-feature-grid {
                    grid-template-columns: repeat(3, 1fr);
                }
            }
            @media (max-width: 767px) {
                .talkomatic-popup-content {
                    width: 95%;
                    margin: 1rem;
                    max-height: 95vh;
                }
                .talkomatic-popup-header {
                    padding: 1.5rem;
                }
                .talkomatic-popup-body {
                    padding: 1.5rem;
                }
                .talkomatic-popup-title {
                    font-size: 22px;
                    margin-bottom: 1rem;
                }
                .talkomatic-update-section h3 {
                    font-size: 20px;
                    margin-bottom: 1rem;
                }
                .talkomatic-feature-item {
                    padding: 1.5rem;
                }
                .talkomatic-feature-item h4 {
                    font-size: 16px;
                }
                .talkomatic-feature-item p {
                    font-size: 14px;
                }
                .talkomatic-popup-close {
                    right: 0.5rem;
                    top: 0.5rem;
                }
                .talkomatic-feature-grid {
                    grid-template-columns: 1fr;
                }
            }
            @media (max-width: 600px) {
                .talkomatic-popup-footer button {
                    padding: 12px 20px;
                    font-size: 14px;
                }
            }
        `;
    document.head.appendChild(style);
  }

  /**
   * Create popup HTML content
   */
  createPopupHTML() {
    const currentDate = new Date().toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
    return `
            <div class="talkomatic-popup-overlay">
                <div class="talkomatic-popup-content">
                    <div class="talkomatic-popup-header">
                        <button class="talkomatic-popup-close" data-action="close">&times;</button>
                        <h2 class="talkomatic-popup-title"><i class="fas fa-wand-magic-sparkles"></i> What's New in Talkomatic</h2>
                        <p class="talkomatic-popup-version">Spectate, Suggestions, Moderation &amp; Reliability, ${currentDate}</p>
                        <span class="talkomatic-version-pill">Version 5.3</span>
                    </div>

                    <div class="talkomatic-popup-body">

                        <div class="talkomatic-update-section">
                            <div class="talkomatic-highlight-box">
                                <h4>A big one</h4>
                                <p>This update brings features people asked for plus a pile of reliability work. You can now watch any public room without joining, send the team feature ideas straight from the lobby, and joining, emotes, and reconnecting are all steadier. Staff also picked up a proper set of tools behind the scenes.</p>
                            </div>
                        </div>

                        <div class="talkomatic-update-section">
                            <h3><i class="fas fa-star"></i> The Highlights</h3>
                            <div class="talkomatic-feature-grid">
                                <div class="talkomatic-feature-item">
                                    <div class="talkomatic-feature-icon"><i class="fas fa-eye"></i></div>
                                    <h4>Spectate Any Room</h4>
                                    <p>Watch any public room read-only, right from the lobby. Look before you join, or just lurk. It even works when a room is full.</p>
                                </div>
                                <div class="talkomatic-feature-item">
                                    <div class="talkomatic-feature-icon"><i class="fas fa-lightbulb"></i></div>
                                    <h4>Suggest a Feature</h4>
                                    <p>Got an idea for Talkomatic? Send it straight from the lobby menu and the team reviews every suggestion.</p>
                                </div>
                                <div class="talkomatic-feature-item">
                                    <div class="talkomatic-feature-icon"><i class="fas fa-right-to-bracket"></i></div>
                                    <h4>Joining Just Works</h4>
                                    <p>No more being bounced back to the lobby near a full room, and your text box now shows up every time you join.</p>
                                </div>
                            </div>
                        </div>

                        <div class="talkomatic-update-section">
                            <h3><i class="fas fa-wand-magic-sparkles"></i> New for Everyone</h3>
                            <ul class="talkomatic-feature-list tk-iconed">
                                <li><i class="fas fa-eye tk-lic"></i> A spectate eye sits next to Enter on public rooms, so anyone can watch a room read-only without taking a seat <span class="talkomatic-badge new">NEW</span></li>
                                <li><i class="fas fa-lightbulb tk-lic"></i> A "Suggest a feature" link in the lobby menu sends your idea to the team <span class="talkomatic-badge new">NEW</span></li>
                                <li><i class="fas fa-plug-circle-check tk-lic"></i> If reconnecting to your room ever stalls, you now get a Rejoin button instead of an endless spinner <span class="talkomatic-badge improved">IMPROVED</span></li>
                            </ul>
                        </div>

                        <div class="talkomatic-update-section">
                            <h3><i class="fas fa-right-to-bracket"></i> Joining and Rooms</h3>
                            <ul class="talkomatic-feature-list tk-iconed">
                                <li><i class="fas fa-users tk-lic"></i> Joining a room that is one seat from full no longer bounces you back to the lobby by mistake <span class="talkomatic-badge fixed">FIXED</span></li>
                                <li><i class="fas fa-keyboard tk-lic"></i> Your text box now appears every time you join, so you no longer have to refresh to start typing <span class="talkomatic-badge fixed">FIXED</span></li>
                                <li><i class="fas fa-bolt tk-lic"></i> Entering a room no longer waits on emotes to finish loading, so joins feel quicker <span class="talkomatic-badge improved">IMPROVED</span></li>
                            </ul>
                        </div>

                        <div class="talkomatic-update-section">
                            <h3><i class="fas fa-face-smile"></i> Emotes</h3>
                            <ul class="talkomatic-feature-list tk-iconed">
                                <li><i class="fas fa-icons tk-lic"></i> The Emoticons picker now fills in properly, even when emotes finish loading a moment after you open the room <span class="talkomatic-badge fixed">FIXED</span></li>
                                <li><i class="fas fa-cloud-arrow-down tk-lic"></i> Emotes load with a timeout and a cleaner request, so a slow or blocked source no longer stalls the room <span class="talkomatic-badge improved">IMPROVED</span></li>
                                <li><i class="fas fa-arrows-rotate tk-lic"></i> A momentary failure on the emote source keeps your existing emotes instead of dropping every one to plain text <span class="talkomatic-badge fixed">FIXED</span></li>
                            </ul>
                        </div>

                        <div class="talkomatic-update-section">
                            <h3><i class="fas fa-shield-halved"></i> Moderation and Safety</h3>
                            <ul class="talkomatic-feature-list tk-iconed">
                                <li><i class="fas fa-ban tk-lic"></i> Staff can now ban an IP directly by typing it in, without needing to catch the user online first <span class="talkomatic-badge new">NEW</span></li>
                                <li><i class="fas fa-people-group tk-lic"></i> The ban list shows which accounts have been seen behind each banned address <span class="talkomatic-badge new">NEW</span></li>
                                <li><i class="fas fa-network-wired tk-lic"></i> Block an entire IPv6 range in one click, with the range worked out automatically, to stop evaders who rotate their address <span class="talkomatic-badge new">NEW</span></li>
                                <li><i class="fas fa-lock tk-lic"></i> Semi-private rooms are tighter: moderators enter the access code like everyone else or watch via spectate, and only developers bypass it <span class="talkomatic-badge improved">IMPROVED</span></li>
                                <li><i class="fas fa-circle-info tk-lic"></i> The ban screen no longer reloads itself in a loop after a repeat ban, and its appeal checks no longer trip the rate limiter <span class="talkomatic-badge fixed">FIXED</span></li>
                                <li><i class="fas fa-user-secret tk-lic"></i> Your IP address stays private. Only developers can ever see it, never moderators or other users <span class="talkomatic-badge privacy">PRIVACY</span></li>
                            </ul>
                        </div>

                        <div class="talkomatic-update-section">
                            <h3><i class="fas fa-bug-slash"></i> Also Fixed</h3>
                            <ul class="talkomatic-feature-list tk-iconed">
                                <li><i class="fas fa-user-clock tk-lic"></i> Moderator applications can no longer be spammed. Three tries in a day and the form takes a 24 hour breather <span class="talkomatic-badge fixed">FIXED</span></li>
                                <li><i class="fas fa-compress tk-lic"></i> Shrinking a room's size now enforces the new limit instead of leaving the room over capacity <span class="talkomatic-badge fixed">FIXED</span></li>
                            </ul>
                        </div>

                        <div class="talkomatic-update-section">
                            <div class="talkomatic-highlight-box">
                                <h4>Built with you</h4>
                                <p>Talkomatic is open source and shaped by community feedback. Report a bug, suggest an idea from the lobby, or just hang out with us on Discord. Thanks for typing letter by letter with us.</p>
                            </div>
                        </div>

                    </div>

                    <div class="talkomatic-popup-footer">
                        <button data-action="close">Got it</button>
                    </div>
                </div>
            </div>
`;
  }

  /**
   * Create and show the popup
   */
  createAndShowPopup() {
    try {
      this.createPopupStyles();
      this.createPopupContainer();
      this.popupContainer.innerHTML = this.createPopupHTML();
      document.body.appendChild(this.popupContainer);
      this.showPopup();
      this.setupEventHandlers();
      this.isPopupVisible = true;
    } catch (error) {
      console.error("Error creating popup:", error);
    }
  }

  /**
   * Create the popup container element
   */
  createPopupContainer() {
    this.popupContainer = document.createElement("div");
    this.popupContainer.id = "talkomatic-popup-container";
    this.popupContainer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 999999;
            pointer-events: all;
        `;
  }

  /**
   * Show the popup with animation
   */
  showPopup() {
    if (this.popupContainer) {
      this.popupContainer.style.display = "block";
      document.body.style.overflow = "hidden";
    }
  }

  /**
   * Set up event handlers for closing the popup
   */
  setupEventHandlers() {
    this.popupContainer.addEventListener("click", (e) => {
      if (e.target.dataset.action === "close") {
        this.closePopup();
      }
      if (e.target.classList.contains("talkomatic-popup-overlay")) {
        this.closePopup();
      }
    });
    this.keyHandler = (e) => {
      if (e.key === "Escape" && this.isPopupVisible) {
        this.closePopup();
      }
    };
    document.addEventListener("keydown", this.keyHandler);
  }

  /**
   * Close the popup and save the state
   */
  closePopup() {
    if (!this.isPopupVisible) return;
    const popupElement = this.popupContainer?.querySelector(
      ".talkomatic-popup-overlay",
    );
    if (popupElement) {
      popupElement.style.animation = "talkomaticFadeOut 0.3s ease-in-out";
      setTimeout(() => {
        if (this.popupContainer && this.popupContainer.parentNode) {
          this.popupContainer.parentNode.removeChild(this.popupContainer);
        }
        document.body.style.overflow = "";
        this.savePopupState();
        if (this.keyHandler) {
          document.removeEventListener("keydown", this.keyHandler);
          this.keyHandler = null;
        }
        this.isPopupVisible = false;
        this.popupContainer = null;
      }, 300);
    }
  }

  /**
   * Save the current state to cookies
   */
  savePopupState() {
    const now = new Date().getTime();
    const expiryDate = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    this.setCookie(this.cookieNames.lastShown, now.toString(), expiryDate);
    this.setCookie(
      this.cookieNames.lastVersion,
      this.currentVersion,
      expiryDate,
    );
  }

  /**
   * Set a cookie
   */
  setCookie(name, value, expiry) {
    const expires = expiry ? "; expires=" + expiry.toUTCString() : "";
    document.cookie = `${name}=${value}${expires}; path=/; SameSite=Lax`;
  }

  /**
   * Get a cookie value
   */
  getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(";");
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) === " ") c = c.substring(1, c.length);
      if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
  }

  /**
   * Manually show the popup (for testing or admin purposes)
   */
  forceShowPopup() {
    this.createAndShowPopup();
  }

  /**
   * Reset popup state (clear cookies)
   */
  resetPopupState() {
    document.cookie = `${this.cookieNames.lastShown}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
    document.cookie = `${this.cookieNames.lastVersion}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
  }

  /**
   * Update the current version (call this when deploying new versions)
   */
  updateVersion(newVersion) {
    this.currentVersion = newVersion;
  }
}

// Auto-initialize when script loads
const talkomaticPopup = new TalkomaticPopupManager();
talkomaticPopup.init();
window.TalkomaticPopup = talkomaticPopup;
