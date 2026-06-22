// public/js/mod.js
// Talkomatic moderation dashboard. Connects with the dev/mod key from
// localStorage (the server validates by hash), then drives a tabbed UI:
//   Activity  live, permanent audit feed of staff actions + identity events
//   Ban list  active IP blocks with a live countdown and one-tap unban (dev)
//   Moderators active mod keys with instant revoke + grant (dev)
// Everything rendered with textContent, so it is XSS-safe. The feed batches
// live entries and caps how many cards live in the DOM, so a sudden spike in
// sign-ins cannot thrash the page.

(function () {
  const socket = io({
    auth: {
      devKey: localStorage.getItem("talkomatic_devKey") || undefined,
      modKey: localStorage.getItem("talkomatic_modKey") || undefined,
      // The dashboard is a separate read-only board, exempt from the
      // one-active-tab rule so it can stay open beside a room.
      app: "modlog",
    },
  });

  const $ = (id) => document.getElementById(id);
  const loadingEl = $("loading");
  const deniedEl = $("denied");
  const appEl = $("app");
  const listEl = $("list");
  const searchEl = $("search");
  const meEl = $("meInfo");
  const rosterEl = $("roster");
  const focusBar = $("focusBar");
  const feedNote = $("feedNote");

  // ── State ──
  let entries = []; // oldest first (actions + identity + comments)
  const commentsByRef = new Map(); // parentId -> [comment]
  let me = null;
  let authorized = false;
  let tab = "activity";
  let feedFilter = "all";
  let query = "";
  let focusUid = null;

  const DOM_CAP = 250; // max activity cards kept in the DOM at once
  let pendingNew = []; // live entries waiting for the next batched flush
  let flushTimer = null;

  // ── Categories ──
  const CAT = {
    security: { color: "#ff5468", icon: "fa-user-secret", label: "Security: a staff key used from a new IP, or from several IPs at once" },
    destructive: { color: "#ff5468", icon: "fa-triangle-exclamation", label: "Destructive: kick, ban, IP block, close, nuke, freeze, wipe" },
    moderation: { color: "#ffb454", icon: "fa-gavel", label: "Moderation: warn, rename, lock, slow, clear board" },
    broadcast: { color: "#5aa9ff", icon: "fa-bullhorn", label: "Broadcast: megaphone, ticker, spotlight, party" },
    config: { color: "#c08bff", icon: "fa-sliders", label: "Config and roles: flags, room size, maintenance, grant or revoke" },
    signin: { color: "#57d9a3", icon: "fa-right-to-bracket", label: "Identity: a user signed in" },
    namechange: { color: "#ffb454", icon: "fa-user-pen", label: "Identity: a name changed or was reset" },
    other: { color: "#6b7080", icon: "fa-circle-info", label: "Other: spectate, staff login" },
  };

  function categorize(e) {
    if (e.type === "security") return "security";
    if (e.type === "identity")
      return e.event === "signin" ? "signin" : "namechange";
    const a = (e.action || "").toLowerCase();
    if (/kick|ban|ip block|close room|nuke|freeze|wipe/.test(a)) return "destructive";
    if (/warn|rename|lock|slow mode|clear board/.test(a)) return "moderation";
    if (/megaphone|ticker|spotlight|party/.test(a)) return "broadcast";
    if (/flag|maintenance|grant mod|revoke mod|blacklist|unblock|room size|make mod/.test(a))
      return "config";
    return "other";
  }

  // ── Small helpers ──
  const fmtTime = (ts) => {
    try {
      return new Date(ts).toLocaleString();
    } catch (_) {
      return String(ts);
    }
  };
  function span(cls, text) {
    const s = document.createElement("span");
    if (cls) s.className = cls;
    if (text != null) s.textContent = text;
    return s;
  }
  function icon(faClass, cls) {
    const i = document.createElement("i");
    i.className = "fas " + faClass + (cls ? " " + cls : "");
    return i;
  }
  function initialOf(name) {
    return (String(name || "?").trim().charAt(0) || "?").toUpperCase();
  }
  function parseTarget(target) {
    const m = /^user:(.*)\(([^)]*)\)$/.exec(target || "");
    return m ? { name: m[1], uid: m[2] } : null;
  }
  function uref(name, uid) {
    const s = span("uref", name);
    if (uid) {
      s.dataset.uid = uid;
      s.title = "Trace this user";
      s.addEventListener("click", () => {
        setFocus(uid);
        switchTab("activity");
      });
    }
    return s;
  }
  function metaBit(parent, k, v, vClass, uid) {
    if (v == null || v === "") return;
    parent.appendChild(span("k", k + " "));
    parent.appendChild(uid ? uref(String(v), uid) : span(vClass || null, String(v)));
    parent.appendChild(document.createTextNode("   "));
  }
  function searchable(e) {
    const base = [
      e.role, e.label, e.action, e.event, e.target, e.room, e.ip, e.details,
      e.username, e.prevUsername, e.userId, e.by,
    ].filter(Boolean).join(" ").toLowerCase();
    const cmts = (commentsByRef.get(e.id) || []).map((c) => c.text).join(" ").toLowerCase();
    return base + " " + cmts;
  }
  function matchesFocus(e, uid) {
    if (e.type === "identity") return e.userId === uid;
    if (e.type === "action") {
      const t = parseTarget(e.target);
      return t && t.uid === uid;
    }
    return false;
  }
  function passes(e) {
    if (feedFilter !== "all" && e.type !== feedFilter) return false;
    if (focusUid && !matchesFocus(e, focusUid)) return false;
    if (query && !searchable(e).includes(query)) return false;
    return true;
  }

  // ── Activity cards ──
  function buildCard(e) {
    const cat = categorize(e);
    const card = document.createElement("div");
    card.className = "entry cat-" + cat;
    card.dataset.id = e.id;

    const row1 = document.createElement("div");
    row1.className = "row1";
    row1.appendChild(icon(CAT[cat].icon, "cat-ic"));
    if (e.type === "security") {
      row1.appendChild(span("chip dev", "ALERT"));
      row1.appendChild(span("who " + (e.role === "dev" ? "dev" : "mod"), e.label || "?"));
      row1.appendChild(
        span(
          "act",
          e.kind === "concurrent"
            ? "key in use from multiple IPs"
            : "key used from a new IP",
        ),
      );
    } else if (e.type === "action") {
      row1.appendChild(span("chip " + (e.role === "dev" ? "dev" : "mod"), (e.role || "?").toUpperCase()));
      row1.appendChild(span("who " + (e.role === "dev" ? "dev" : "mod"), e.label || "?"));
      row1.appendChild(span("act", e.action || "?"));
    } else {
      row1.appendChild(uref(e.username || "?", e.userId));
      const evt = e.event === "rename" ? "changed name"
        : e.event === "forced-rename" ? "force-renamed by staff" : "signed in";
      row1.appendChild(span("act", evt));
    }
    row1.appendChild(span("when", fmtTime(e.ts)));
    card.appendChild(row1);

    const meta = document.createElement("div");
    meta.className = "meta";
    if (e.type === "security") {
      metaBit(meta, "key:", e.label);
      metaBit(meta, "role:", e.role);
      metaBit(meta, "IP:", e.ip, "ip");
    } else if (e.type === "action") {
      const t = parseTarget(e.target);
      if (t) {
        meta.appendChild(span("k", "target: "));
        meta.appendChild(uref(t.name, t.uid));
        meta.appendChild(document.createTextNode("   "));
      } else {
        metaBit(meta, "target:", e.target);
      }
      metaBit(meta, "room:", e.room);
      metaBit(meta, "by IP:", e.ip, "ip");
    } else {
      metaBit(meta, "was:", e.prevUsername);
      metaBit(meta, "location:", e.location);
      metaBit(meta, "IP:", e.ip, "ip");
      metaBit(meta, "user:", e.userId, null, e.userId);
      metaBit(meta, "by:", e.by);
    }
    if (meta.childNodes.length) card.appendChild(meta);

    const detailText = e.details || e.detail;
    if (detailText) {
      const d = document.createElement("div");
      d.className = "detail";
      d.textContent = detailText;
      card.appendChild(d);
    }

    const thread = document.createElement("div");
    thread.className = "comments";
    thread.style.display = "none";
    card.appendChild(thread);
    (commentsByRef.get(e.id) || []).forEach((c) => appendComment(card, c));

    const box = document.createElement("div");
    box.className = "cmtbox";
    const input = document.createElement("input");
    input.placeholder = "Add a note or ask a question";
    input.maxLength = 500;
    const send = document.createElement("button");
    send.className = "btn sm";
    send.appendChild(icon("fa-paper-plane"));
    const submit = () => {
      const text = input.value.trim();
      if (!text) return;
      socket.emit("audit comment", { entryId: e.id, text });
      input.value = "";
    };
    send.addEventListener("click", submit);
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") submit();
    });
    box.appendChild(input);
    box.appendChild(send);
    card.appendChild(box);

    return card;
  }

  function appendComment(card, c) {
    const thread = card.querySelector(".comments");
    if (!thread) return;
    thread.style.display = "block";
    const row = document.createElement("div");
    row.className = "cmt";
    row.appendChild(span("cwho " + (c.role === "dev" ? "dev" : "mod"), (c.label || "?") + ":"));
    row.appendChild(span("ctext", c.text));
    row.appendChild(span("cwhen", fmtTime(c.ts)));
    thread.appendChild(row);
  }

  // Full rebuild of the feed, capped to the most recent DOM_CAP matches.
  function renderActivity() {
    pendingNew = [];
    listEl.textContent = "";
    const matches = entries.filter((e) => e.type !== "comment" && passes(e));
    if (matches.length === 0) {
      feedNote.classList.add("hidden");
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.appendChild(icon("fa-inbox"));
      empty.appendChild(document.createTextNode("No matching entries."));
      listEl.appendChild(empty);
      return;
    }
    const shown = matches.slice(-DOM_CAP);
    for (let i = shown.length - 1; i >= 0; i--) listEl.appendChild(buildCard(shown[i]));
    updateFeedNote(matches.length);
  }

  function updateFeedNote(total) {
    if (total > DOM_CAP) {
      feedNote.classList.remove("hidden");
      feedNote.textContent =
        "Showing the latest " + DOM_CAP + " of " + total + " matching entries. Use search to narrow down.";
    } else {
      feedNote.classList.add("hidden");
    }
  }

  // Batched insert of new live entries (keeps existing cards, their comments and
  // scroll intact) plus a DOM trim, so a flood of sign-ins can't thrash the page.
  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushPending();
    }, 450);
  }
  function flushPending() {
    if (tab !== "activity") {
      pendingNew = [];
      return;
    }
    const toShow = pendingNew.filter(passes);
    pendingNew = [];
    if (toShow.length === 0) return;
    const empty = listEl.querySelector(".empty");
    if (empty) empty.remove();
    // Newest at the top
    for (let i = 0; i < toShow.length; i++) {
      listEl.insertBefore(buildCard(toShow[i]), listEl.firstChild);
    }
    // Trim oldest cards beyond the cap
    let cards = listEl.querySelectorAll(".entry");
    for (let i = cards.length - 1; i >= DOM_CAP; i--) cards[i].remove();
    const totalMatches = entries.filter((e) => e.type !== "comment" && passes(e)).length;
    updateFeedNote(totalMatches);
  }

  // ── Focus (trace a user) ──
  function setFocus(uid) {
    focusUid = uid || null;
    if (!focusUid) {
      focusBar.classList.add("hidden");
      focusBar.textContent = "";
      renderActivity();
      return;
    }
    const s = userSummary(focusUid);
    focusBar.classList.remove("hidden");
    focusBar.textContent = "";
    focusBar.appendChild(icon("fa-crosshairs"));
    focusBar.appendChild(span(null, " Tracing "));
    focusBar.appendChild(span("mono", focusUid));
    const sum = span("sum");
    sum.appendChild(document.createTextNode("   names: "));
    sum.appendChild(boldList(s.names));
    sum.appendChild(document.createTextNode("   IPs: "));
    sum.appendChild(boldList(s.ips));
    sum.appendChild(document.createTextNode("   actions against them: "));
    const b = document.createElement("b");
    b.textContent = String(s.actionsAgainst);
    sum.appendChild(b);
    focusBar.appendChild(sum);
    const clear = document.createElement("button");
    clear.className = "btn sm";
    clear.appendChild(icon("fa-xmark"));
    clear.appendChild(document.createTextNode(" Clear"));
    clear.addEventListener("click", () => setFocus(null));
    focusBar.appendChild(clear);
    renderActivity();
  }
  function boldList(arr) {
    const b = document.createElement("b");
    b.textContent = arr.length ? arr.join(", ") : "none";
    return b;
  }
  function userSummary(uid) {
    const names = new Set(), ips = new Set();
    let actionsAgainst = 0;
    for (const e of entries) {
      if (e.type === "identity" && e.userId === uid) {
        if (e.username) names.add(e.username);
        if (e.prevUsername) names.add(e.prevUsername);
        if (e.ip) ips.add(e.ip);
      } else if (e.type === "action") {
        const t = parseTarget(e.target);
        if (t && t.uid === uid) actionsAgainst++;
      }
    }
    return { names: [...names], ips: [...ips], actionsAgainst };
  }

  function renderRoster(roster) {
    rosterEl.textContent = "";
    if (!roster) return;
    const d = document.createElement("b");
    d.textContent = "Devs: ";
    d.style.color = "var(--red)";
    rosterEl.appendChild(d);
    rosterEl.appendChild(document.createTextNode((roster.devs || []).join(", ") || "none"));
    const m = document.createElement("b");
    m.textContent = "      Mods: ";
    m.style.color = "var(--orange)";
    rosterEl.appendChild(m);
    rosterEl.appendChild(document.createTextNode((roster.mods || []).join(", ") || "none"));
  }

  function renderLegend() {
    const legendEl = $("legend");
    legendEl.textContent = "";
    Object.keys(CAT).forEach((cat) => {
      const row = document.createElement("div");
      row.className = "leg";
      const ic = icon(CAT[cat].icon, "leg-ic");
      ic.style.color = CAT[cat].color;
      row.appendChild(ic);
      const b = document.createElement("b");
      b.textContent = CAT[cat].label;
      row.appendChild(b);
      legendEl.appendChild(row);
    });
  }

  // ── Ban list tab (dev only) ──
  let bans = [];
  let bansTimer = null;
  function fmtRemaining(b) {
    if (b.permanent) return null;
    const ms = (b.expiry || 0) - Date.now();
    if (ms <= 0) return "expiring";
    let s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    const pad = (n) => String(n).padStart(2, "0");
    if (d > 0) return d + "d " + pad(h) + ":" + pad(m) + ":" + pad(s) + " left";
    return pad(h) + ":" + pad(m) + ":" + pad(s) + " left";
  }
  function renderBans() {
    const wrap = $("bansList");
    const isDev = me && me.role === "dev";
    wrap.textContent = "";
    $("bansBadge").textContent = String(bans.length);
    $("bansSub").textContent = bans.length
      ? bans.length + " active block" + (bans.length === 1 ? "" : "s")
      : "No active blocks";
    if (bans.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.appendChild(icon("fa-circle-check"));
      empty.appendChild(document.createTextNode("Nobody is currently blocked."));
      wrap.appendChild(empty);
      return;
    }
    bans.forEach((b) => {
      const row = document.createElement("div");
      row.className = "rowcard";
      row.dataset.ip = b.ip;

      const av = document.createElement("div");
      av.className = "avatar";
      av.style.background = b.permanent ? "var(--red)" : "var(--amber)";
      av.textContent = initialOf(b.label || b.ip);
      row.appendChild(av);

      const main = document.createElement("div");
      main.className = "rc-main";
      const title = span("rc-title", "");
      title.textContent = b.label || "Unknown user";
      main.appendChild(title);
      const sub = document.createElement("div");
      sub.className = "rc-sub";
      if (isDev) {
        sub.appendChild(span("ip", b.ip));
        sub.appendChild(document.createTextNode("   "));
      }
      if (b.by) sub.appendChild(document.createTextNode("blocked by " + b.by));
      main.appendChild(sub);
      row.appendChild(main);

      const actions = document.createElement("div");
      actions.className = "rc-actions";
      const pill = document.createElement("span");
      pill.className = "pill " + (b.permanent ? "perm" : "live");
      pill.dataset.ttl = "1";
      pill.textContent = b.permanent ? "Permanent" : (fmtRemaining(b) || "expiring");
      actions.appendChild(pill);
      const unban = document.createElement("button");
      unban.className = "btn sm danger";
      unban.appendChild(icon("fa-unlock"));
      unban.appendChild(document.createTextNode(" Unban"));
      unban.addEventListener("click", async () => {
        if (!window.StaffUI) {
          socket.emit("dev unblock ip", { ip: b.ip });
          return;
        }
        const ok = await StaffUI.confirm({
          title: "Unban",
          message: "Unblock " + (b.label ? b.label + " (" + b.ip + ")" : b.ip) + "?",
          confirmText: "Unban",
        });
        if (ok) socket.emit("dev unblock ip", { ip: b.ip });
      });
      actions.appendChild(unban);
      row.appendChild(actions);

      wrap.appendChild(row);
    });
    startBanTimer();
  }
  function startBanTimer() {
    if (bansTimer) return;
    bansTimer = setInterval(() => {
      if (tab !== "bans") return;
      let anyLive = false;
      document.querySelectorAll('#bansList .pill[data-ttl]').forEach((pill) => {
        const ip = pill.closest(".rowcard")?.dataset.ip;
        const b = bans.find((x) => x.ip === ip);
        if (!b || b.permanent) return;
        anyLive = true;
        pill.textContent = fmtRemaining(b) || "expiring";
      });
      if (!anyLive) {
        clearInterval(bansTimer);
        bansTimer = null;
      }
    }, 1000);
  }

  // ── Moderators tab (dev only) ──
  let modKeys = [];
  function renderMods() {
    const wrap = $("modsList");
    wrap.textContent = "";
    $("modsBadge").textContent = String(modKeys.length);
    $("modsSub").textContent = modKeys.length
      ? modKeys.length + " active mod key" + (modKeys.length === 1 ? "" : "s")
      : "No mod keys yet";
    if (modKeys.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.appendChild(icon("fa-user-shield"));
      empty.appendChild(document.createTextNode("No moderators yet. Grant one above."));
      wrap.appendChild(empty);
      return;
    }
    modKeys.forEach((k) => {
      const row = document.createElement("div");
      row.className = "rowcard";

      const av = document.createElement("div");
      av.className = "avatar";
      av.style.background = "var(--orange)";
      av.textContent = initialOf(k.label);
      row.appendChild(av);

      const main = document.createElement("div");
      main.className = "rc-main";
      const title = span("rc-title", "");
      title.appendChild(document.createTextNode(k.label || "mod"));
      title.appendChild(span("chip mod", "MOD"));
      main.appendChild(title);
      const sub = span("rc-sub mono", "key " + (k.hash ? k.hash.slice(0, 12) : "?"));
      main.appendChild(sub);
      row.appendChild(main);

      const actions = document.createElement("div");
      actions.className = "rc-actions";
      const revoke = document.createElement("button");
      revoke.className = "btn sm danger";
      revoke.appendChild(icon("fa-user-xmark"));
      revoke.appendChild(document.createTextNode(" Revoke"));
      revoke.addEventListener("click", async () => {
        if (!window.StaffUI) {
          socket.emit("dev revoke mod", { hash: k.hash });
          return;
        }
        const ok = await StaffUI.confirm({
          title: "Revoke mod",
          message: 'Revoke "' + (k.label || "mod") + '" immediately? Their access is removed at once.',
          danger: true,
          confirmText: "Revoke",
        });
        if (ok) socket.emit("dev revoke mod", { hash: k.hash });
      });
      actions.appendChild(revoke);
      row.appendChild(actions);

      wrap.appendChild(row);
    });
  }
  async function grantMod() {
    if (!window.StaffUI) return;
    const label = await StaffUI.prompt({
      title: "Grant a mod key",
      icon: '<i class="fas fa-user-shield"></i>',
      message: "Pick a label so this key can be told apart in the log and list.",
      fields: [{ name: "value", label: "Label (a name or handle)", type: "text", placeholder: "e.g. Zacki", required: true, maxLength: 40 }],
      confirmText: "Generate key",
    });
    if (label) socket.emit("dev grant mod", { label });
  }

  // ── Sessions tab (dev only): who is connected on which staff key ──
  let sessionData = { sessions: [], history: [] };
  function keyRow(label, role, ipsText, pillClass, pillText, sub2) {
    const row = document.createElement("div");
    row.className = "rowcard";
    const av = document.createElement("div");
    av.className = "avatar";
    av.style.background = role === "dev" ? "var(--red)" : "var(--orange)";
    av.textContent = initialOf(label);
    row.appendChild(av);
    const main = document.createElement("div");
    main.className = "rc-main";
    const title = span("rc-title", "");
    title.appendChild(document.createTextNode(label || "?"));
    title.appendChild(span("chip " + (role === "dev" ? "dev" : "mod"), (role || "?").toUpperCase()));
    main.appendChild(title);
    const sub = span("rc-sub", "");
    if (sub2) sub.appendChild(document.createTextNode(sub2 + " "));
    sub.appendChild(span("ip", ipsText || "none"));
    main.appendChild(sub);
    row.appendChild(main);
    const actions = document.createElement("div");
    actions.className = "rc-actions";
    const pill = document.createElement("span");
    pill.className = "pill " + pillClass;
    pill.textContent = pillText;
    actions.appendChild(pill);
    row.appendChild(actions);
    return row;
  }
  function emptyCard(wrap, ic, text) {
    const e = document.createElement("div");
    e.className = "empty";
    e.appendChild(icon(ic));
    e.appendChild(document.createTextNode(text));
    wrap.appendChild(e);
  }
  function renderSessions() {
    const active = $("sessionsActive");
    const hist = $("sessionsHistory");
    const sessions = sessionData.sessions || [];
    const history = sessionData.history || [];
    const flagged = sessions.filter((s) => s.multiIp).length;
    $("sessionsBadge").textContent = String(sessions.length);
    $("sessionsSub").textContent = sessions.length
      ? sessions.length + " key" + (sessions.length === 1 ? "" : "s") + " connected" + (flagged ? ", " + flagged + " from multiple IPs" : "")
      : "No staff connected right now";

    active.textContent = "";
    if (sessions.length === 0) {
      emptyCard(active, "fa-plug-circle-xmark", "No staff are connected right now.");
    } else {
      sessions.forEach((s) => {
        const tabs = (s.sessionCount || 1) + " tab" + ((s.sessionCount || 1) === 1 ? "" : "s") + " from";
        active.appendChild(
          keyRow(s.label, s.role, (s.ips || []).join(", "),
            s.multiIp ? "perm" : "live", s.multiIp ? "Multiple IPs" : "OK", tabs),
        );
      });
    }

    hist.textContent = "";
    if (history.length === 0) {
      emptyCard(hist, "fa-clock-rotate-left", "No key history yet.");
    } else {
      history.forEach((h) => {
        const ips = h.ips || [];
        hist.appendChild(
          keyRow(h.label, h.role, ips.map((x) => x.ip).join(", "),
            ips.length > 1 ? "perm" : "live",
            ips.length + " IP" + (ips.length === 1 ? "" : "s"),
            "seen from"),
        );
      });
    }
  }

  // ── Tabs + sidebar ──
  function switchTab(name) {
    tab = name;
    document.querySelectorAll(".nav-item").forEach((n) =>
      n.classList.toggle("active", n.dataset.tab === name),
    );
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    const panel = $("tab-" + name);
    if (panel) panel.classList.add("active");
    if (name === "activity") flushPending();
    if (name === "bans") {
      socket.emit("dev list blocks");
      startBanTimer();
    }
    if (name === "mods") socket.emit("dev list mod keys");
    if (name === "sessions") socket.emit("dev get sessions");
    if (window.innerWidth <= 860) document.body.classList.add("nav-closed");
  }
  function applyRoleGating() {
    const isDev = me && me.role === "dev";
    document.querySelectorAll(".nav-item[data-dev]").forEach((n) => {
      n.style.display = isDev ? "" : "none";
    });
    if (!isDev && (tab === "bans" || tab === "mods" || tab === "sessions"))
      switchTab("activity");
  }

  // ── Socket wiring ──
  socket.on("connect", () => socket.emit("staff get audit", { limit: 1500 }));

  socket.on("audit snapshot", (data) => {
    authorized = true;
    loadingEl.classList.add("hidden");
    deniedEl.classList.add("hidden");
    appEl.classList.remove("hidden");
    entries = Array.isArray(data && data.entries) ? data.entries : [];
    commentsByRef.clear();
    for (const e of entries)
      if (e.type === "comment" && e.refId) {
        if (!commentsByRef.has(e.refId)) commentsByRef.set(e.refId, []);
        commentsByRef.get(e.refId).push(e);
      }
    me = data && data.me;
    if (me) {
      meEl.textContent = "";
      meEl.appendChild(span("chip " + (me.role === "dev" ? "dev" : "mod"), (me.role || "staff").toUpperCase()));
      meEl.appendChild(document.createTextNode(" " + (me.label || "")));
    }
    applyRoleGating();
    renderRoster(data && data.roster);
    renderLegend();
    renderActivity();
  });

  socket.on("audit entry", (e) => {
    if (!e) return;
    entries.push(e);
    if (entries.length > 5000) entries = entries.slice(-3000);
    if (e.type === "comment" && e.refId) {
      if (!commentsByRef.has(e.refId)) commentsByRef.set(e.refId, []);
      commentsByRef.get(e.refId).push(e);
      const card = listEl.querySelector('.entry[data-id="' + e.refId + '"]');
      if (card) appendComment(card, e);
      return;
    }
    // Buffer and flush on a timer so a flood of events can't thrash the DOM.
    pendingNew.push(e);
    scheduleFlush();
  });

  socket.on("dev blocks", (list) => {
    bans = (Array.isArray(list) ? list : []).slice().sort((a, b) => {
      if (a.permanent !== b.permanent) return a.permanent ? -1 : 1;
      return (a.expiry || 0) - (b.expiry || 0);
    });
    renderBans();
  });

  socket.on("dev mod keys", (list) => {
    modKeys = Array.isArray(list) ? list : [];
    renderMods();
  });

  socket.on("dev sessions", (data) => {
    sessionData = data || { sessions: [], history: [] };
    renderSessions();
  });

  socket.on("dev mod granted", (d) => {
    if (!d || !d.key || !window.StaffUI) return;
    const w = document.createElement("div");
    const p1 = document.createElement("p");
    p1.textContent = 'New mod key for "' + (d.label || "mod") + '". Copy it now: it is shown once and never stored.';
    const code = document.createElement("div");
    code.className = "mono";
    code.style.cssText = "background:#000;border:1px solid #333;padding:10px;margin:10px 0;word-break:break-all;border-radius:6px;color:#ff9800;";
    code.textContent = d.key;
    w.appendChild(p1);
    w.appendChild(code);
    StaffUI.modal({
      title: "Mod key created",
      icon: '<i class="fas fa-key"></i>',
      body: w,
      actions: [
        { label: "Copy key", kind: "primary", onClick: () => { try { navigator.clipboard.writeText(d.key); } catch (_) {} } },
        { label: "Done", onClick: () => {} },
      ],
    });
  });

  socket.on("staff action result", (d) => {
    if (d && window.StaffUI) StaffUI.toast((d.ok ? "Done: " : "Failed: ") + (d.action || ""), { type: d.ok ? "success" : "error" });
  });

  const showDenied = () => {
    if (authorized) return;
    loadingEl.classList.add("hidden");
    appEl.classList.add("hidden");
    deniedEl.classList.remove("hidden");
  };
  socket.on("error", showDenied);
  socket.on("connect_error", showDenied);
  setTimeout(showDenied, 4500);

  // ── Key entry (no console) ──
  let pendingStaffKey = null;
  async function openStaffKeyEntry() {
    if (!window.StaffUI) return;
    const key = await StaffUI.prompt({
      title: "Staff access",
      icon: '<i class="fas fa-key"></i>',
      subtitle: "Enter your dev or mod key",
      message: "Verified on the server, then saved to this browser.",
      fields: [{ name: "value", label: "Staff key", type: "password", placeholder: "paste your key", required: true }],
      confirmText: "Unlock",
    });
    if (key) {
      pendingStaffKey = key;
      socket.emit("staff validate key", { key });
    }
  }
  socket.on("staff key result", (d) => {
    if (!d || !d.role) {
      if (window.StaffUI)
        StaffUI.toast(d && d.throttled ? "Too many attempts. Wait a few minutes." : "That key was not recognized.", { type: "error" });
      pendingStaffKey = null;
      return;
    }
    if (d.role === "dev") localStorage.setItem("talkomatic_devKey", pendingStaffKey);
    else localStorage.setItem("talkomatic_modKey", pendingStaffKey);
    pendingStaffKey = null;
    if (window.StaffUI) StaffUI.toast("Key accepted. Reloading.", { type: "success" });
    setTimeout(() => window.location.reload(), 1000);
  });

  // ── Controls ──
  $("enterKeyBtn") && $("enterKeyBtn").addEventListener("click", openStaffKeyEntry);
  $("navToggle").addEventListener("click", () => document.body.classList.toggle("nav-closed"));
  $("navBackdrop").addEventListener("click", () => document.body.classList.add("nav-closed"));
  document.querySelectorAll(".nav-item").forEach((n) =>
    n.addEventListener("click", () => switchTab(n.dataset.tab)),
  );
  $("bansRefresh").addEventListener("click", () => socket.emit("dev list blocks"));
  $("modsRefresh").addEventListener("click", () => socket.emit("dev list mod keys"));
  $("sessionsRefresh") &&
    $("sessionsRefresh").addEventListener("click", () =>
      socket.emit("dev get sessions"),
    );
  $("grantMod").addEventListener("click", grantMod);

  let searchDebounce = null;
  searchEl.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      query = searchEl.value.trim().toLowerCase();
      renderActivity();
    }, 200);
  });
  document.querySelectorAll("#filterSeg button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#filterSeg button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      feedFilter = btn.dataset.f;
      renderActivity();
    });
  });

  // Open the sidebar by default on wider screens.
  if (window.innerWidth > 860) document.body.classList.remove("nav-closed");

  window.addEventListener("beforeunload", () => {
    try {
      socket.emit("staff stop audit");
    } catch (_) {}
  });
})();
