/**
 * Talkomatic Update Popup Manager
 * Handles showing update popups based on version changes and time intervals
 */
class TalkomaticPopupManager {
  constructor() {
    // Current version - update this when you release new versions
    this.currentVersion = "5.1.0";
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
                        <h2 class="talkomatic-popup-title"><i class="fas fa-cake-candles"></i> Talkomatic is 2 Years Old</h2>
                        <p class="talkomatic-popup-version">The v4 Anniversary Update, ${currentDate}</p>
                        <span class="talkomatic-version-pill">Version 4.1</span>
                    </div>

                    <div class="talkomatic-popup-body">

                        <div class="talkomatic-update-section">
                            <div class="talkomatic-highlight-box">
                                <h4>Two years of Talkomatic</h4>
                                <p>Talkomatic was born in 1973 on the PLATO system as the very first online chat. In 2024 it came back to life as open source. Today it turns two. To mark the moment we shipped our biggest update yet, focused on safety, a redesigned drawing board, and a lot of polish. Thank you for being here and typing letter by letter with us.</p>
                            </div>
                        </div>

                        <div class="talkomatic-update-section">
                            <h3><i class="fas fa-star"></i> The Highlights</h3>
                            <div class="talkomatic-feature-grid">
                                <div class="talkomatic-feature-item">
                                    <div class="talkomatic-feature-icon"><i class="fas fa-cake-candles"></i></div>
                                    <h4>Birthday Celebration</h4>
                                    <p>Light a candle from the lobby and watch the community's count climb together. Drop back in anytime from the cake in the menu.</p>
                                </div>
                                <div class="talkomatic-feature-item">
                                    <div class="talkomatic-feature-icon"><i class="fas fa-shield-halved"></i></div>
                                    <h4>A Real Moderation Team</h4>
                                    <p>Trusted moderators and developers now have proper tools to keep rooms safe, calm raids, and handle reports quickly.</p>
                                </div>
                                <div class="talkomatic-feature-item">
                                    <div class="talkomatic-feature-icon"><i class="fas fa-paintbrush"></i></div>
                                    <h4>A New Talkoboard</h4>
                                    <p>The shared drawing board got a full makeover, with gradient brushes, a color panel, undo and redo, and saving your art as an image.</p>
                                </div>
                            </div>
                        </div>

                        <div class="talkomatic-update-section">
                            <h3><i class="fas fa-cake-candles"></i> Birthday and Celebration</h3>
                            <ul class="talkomatic-feature-list tk-iconed">
                                <li><i class="fas fa-bullhorn tk-lic"></i> A festive birthday banner now sits at the top of the lobby <span class="talkomatic-badge new">NEW</span></li>
                                <li><i class="fas fa-cake-candles tk-lic"></i> An animated birthday card opens once with a short history of Talkomatic, confetti, and a party horn <span class="talkomatic-badge new">NEW</span></li>
                                <li><i class="fas fa-fire-flame-curved tk-lic"></i> A live community candle counter, shared across everyone on the site and saved on the server so it keeps growing <span class="talkomatic-badge new">NEW</span></li>
                                <li><i class="fas fa-rotate-right tk-lic"></i> Revisit the celebration anytime from the 2nd Birthday link in the lobby menu <span class="talkomatic-badge new">NEW</span></li>
                            </ul>
                        </div>

                        <div class="talkomatic-update-section">
                            <h3><i class="fas fa-paintbrush"></i> The Talkoboard, Reimagined</h3>
                            <ul class="talkomatic-feature-list tk-iconed">
                                <li><i class="fas fa-palette tk-lic"></i> A full color panel with a preset palette, a custom picker, an eyedropper, your recent colors, and the colors other people in the room are using <span class="talkomatic-badge new">NEW</span></li>
                                <li><i class="fas fa-wand-magic-sparkles tk-lic"></i> Gradient brushes named Rainbow, Sunset, Ocean, Neon, Fire, and Candy that flow smoothly and look the same for everyone in the room <span class="talkomatic-badge new">NEW</span></li>
                                <li><i class="fas fa-hand tk-lic"></i> A hand tool to drag the board around, which makes panning easy on a phone <span class="talkomatic-badge new">NEW</span></li>
                                <li><i class="fas fa-rotate-left tk-lic"></i> Undo and redo your own strokes, kept in sync for everyone <span class="talkomatic-badge new">NEW</span></li>
                                <li><i class="fas fa-floppy-disk tk-lic"></i> Save the whole board as an image with one tap <span class="talkomatic-badge new">NEW</span></li>
                                <li><i class="fas fa-wrench tk-lic"></i> A redesigned toolbar, a cleaner board chat with a colored avatar per person, and much better behavior on mobile <span class="talkomatic-badge improved">IMPROVED</span></li>
                            </ul>
                        </div>

                        <div class="talkomatic-update-section">
                            <h3><i class="fas fa-shield-halved"></i> Moderation and Safety</h3>
                            <ul class="talkomatic-feature-list tk-iconed">
                                <li><i class="fas fa-user-shield tk-lic"></i> A trusted team of moderators and developers now keeps rooms safe, with real tools to calm raids and handle reports fast <span class="talkomatic-badge new">NEW</span></li>
                                <li><i class="fas fa-gauge-high tk-lic"></i> The team works from a clean dashboard and a shared private log that keeps everyone accountable for every action <span class="talkomatic-badge new">NEW</span></li>
                                <li><i class="fas fa-circle-info tk-lic"></i> If your access is ever blocked you now see a clear full screen notice with a live countdown and a Discord link to appeal, instead of a silent retry <span class="talkomatic-badge improved">IMPROVED</span></li>
                                <li><i class="fas fa-user-secret tk-lic"></i> Your IP address stays private. Only developers can ever see it, never moderators or other users <span class="talkomatic-badge privacy">PRIVACY</span></li>
                                <li><i class="fas fa-lock tk-lic"></i> Staff names like Mod, Dev, and Admin are protected, so nobody can pretend to be the team <span class="talkomatic-badge new">NEW</span></li>
                                <li><i class="fas fa-circle-check tk-lic"></i> Quiet safeguards watch for shared or stolen staff access and warn the team right away <span class="talkomatic-badge new">NEW</span></li>
                            </ul>
                        </div>

                        <div class="talkomatic-update-section">
                            <h3><i class="fas fa-users"></i> Rooms and Layout</h3>
                            <ul class="talkomatic-feature-list tk-iconed">
                                <li><i class="fas fa-up-right-and-down-left-from-center tk-lic"></i> Room size can now be adjusted for special events and busy nights <span class="talkomatic-badge new">NEW</span></li>
                                <li><i class="fas fa-table-cells tk-lic"></i> Bigger rooms use a balanced grid that fills the space instead of squishing everyone into thin slivers <span class="talkomatic-badge improved">IMPROVED</span></li>
                                <li><i class="fas fa-plug-circle-check tk-lic"></i> Reconnecting drops you back into your room instead of leaving a ghost behind for everyone else <span class="talkomatic-badge fixed">FIXED</span></li>
                                <li><i class="fas fa-window-restore tk-lic"></i> One active tab per browser, so two tabs can no longer cross your name or your typed messages <span class="talkomatic-badge new">NEW</span></li>
                                <li><i class="fas fa-text-width tk-lic"></i> Long usernames stay on one line and trim neatly instead of wrapping to two <span class="talkomatic-badge fixed">FIXED</span></li>
                            </ul>
                        </div>

                        <div class="talkomatic-update-section">
                            <h3><i class="fas fa-wand-magic-sparkles"></i> Everyday Polish</h3>
                            <ul class="talkomatic-feature-list tk-iconed">
                                <li><i class="fas fa-link tk-lic"></i> Links in chat now include the whole address, so paths and handles like youtube.com/@name, query strings, and fragments all work <span class="talkomatic-badge fixed">FIXED</span></li>
                                <li><i class="fas fa-keyboard tk-lic"></i> Joining or leaving a room no longer steals your cursor or interrupts your typing, even with the Talkoboard open <span class="talkomatic-badge fixed">FIXED</span></li>
                                <li><i class="fas fa-bars-staggered tk-lic"></i> Cleaner menus, dialogs, and notifications across the lobby and rooms <span class="talkomatic-badge improved">IMPROVED</span></li>
                                <li><i class="fas fa-mobile-screen tk-lic"></i> A batch of mobile fixes, including no more white bars at the top and bottom or behind the keyboard <span class="talkomatic-badge fixed">FIXED</span></li>
                                <li><i class="fas fa-bullhorn tk-lic"></i> A new Update Notes link in the lobby menu reopens this announcement anytime <span class="talkomatic-badge new">NEW</span></li>
                            </ul>
                        </div>

                        <div class="talkomatic-update-section">
                            <div class="talkomatic-highlight-box">
                                <h4>Your classic look, back by default</h4>
                                <p>The original Talkomatic theme is the default again. World Cup mode is now optional, with a toggle in the bottom left whenever you want it, and your choice is remembered.</p>
                            </div>
                        </div>

                        <div class="talkomatic-update-section">
                            <h3><i class="fas fa-bug-slash"></i> Bug Fixes</h3>
                            <ul class="talkomatic-feature-list tk-iconed">
                                <li><i class="fas fa-circle-check tk-lic"></i> Fixed the false "this username or location is already in a room" error that could block you from joining even after clearing cookies <span class="talkomatic-badge fixed">FIXED</span></li>
                                <li><i class="fas fa-circle-check tk-lic"></i> Wiping a user's typed text now clears it from their own box too, not just from everyone else's screen <span class="talkomatic-badge fixed">FIXED</span></li>
                                <li><i class="fas fa-circle-check tk-lic"></i> Many layout and overflow fixes across desktop and mobile <span class="talkomatic-badge fixed">FIXED</span></li>
                            </ul>
                        </div>

                        <div class="talkomatic-update-section">
                            <div class="talkomatic-highlight-box">
                                <h4>Built with you</h4>
                                <p>Talkomatic is open source and shaped by community feedback. Report a bug, suggest an idea, or just hang out with us on Discord. Here is to many more years of typing together.</p>
                            </div>
                        </div>

                    </div>

                    <div class="talkomatic-popup-footer">
                        <button data-action="close">Let's Celebrate</button>
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
