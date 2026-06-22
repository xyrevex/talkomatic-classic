// public/js/mod.js
// Staff moderation log. Connects with the dev/mod key from localStorage,
// streams the audit feed (server validates the key by hash), and renders every
// staff action + identity change with color-coding, a legend, per-entry comment
// threads, and per-user focus ("trees"). Everything is XSS-safe (textContent).

(function () {
  const socket = io({
    auth: {
      devKey: localStorage.getItem("talkomatic_devKey") || undefined,
      modKey: localStorage.getItem("talkomatic_modKey") || undefined,
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
  const legendEl = $("legend");
  const focusBar = $("focusBar");

  let entries = []; // oldest first (non-comment + comment)
  const commentsByRef = new Map(); // parentId -> [comment]
  let me = null;
  let authorized = false;
  let tab = "all";
  let query = "";
  let focusUid = null;

  const CAT_COLOR = {
    destructive: "#ff4d4d",
    moderation: "#ffb454",
    broadcast: "#5aa9ff",
    config: "#c08bff",
    signin: "#57d9a3",
    namechange: "#ffb454",
    other: "#6f6f6f",
  };
  const LEGEND = [
    ["destructive", "Destructive: kick, ban, IP block, close, nuke, freeze, wipe"],
    ["moderation", "Moderation: warn, rename, lock, slow, clear board"],
    ["broadcast", "Broadcast: megaphone, ticker, spotlight, party"],
    ["config", "Config and roles: flags, room size, maintenance, grant or revoke"],
    ["signin", "Identity: user signed in"],
    ["namechange", "Identity: name changed or reset"],
    ["other", "Other: spectate, staff login"],
  ];

  function categorize(e) {
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

  const fmtTime = (ts) => {
    try {
      return new Date(ts).toLocaleString();
    } catch (_) {
      return String(ts);
    }
  };
  function parseTarget(target) {
    const m = /^user:(.*)\(([^)]*)\)$/.exec(target || "");
    return m ? { name: m[1], uid: m[2] } : null;
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

  // ── small DOM helpers (XSS-safe) ──
  function span(cls, text) {
    const s = document.createElement("span");
    if (cls) s.className = cls;
    if (text != null) s.textContent = text;
    return s;
  }
  function uref(name, uid) {
    const s = span("uref", name);
    if (uid) {
      s.dataset.uid = uid;
      s.title = "Trace this user";
      s.addEventListener("click", () => setFocus(uid));
    }
    return s;
  }

  function metaBit(parent, k, v, vClass, uid) {
    if (v == null || v === "") return;
    parent.appendChild(span("k", k + " "));
    parent.appendChild(uid ? uref(String(v), uid) : span(vClass || null, String(v)));
    parent.appendChild(document.createTextNode("   "));
  }

  function buildCard(e) {
    const cat = categorize(e);
    const card = document.createElement("div");
    card.className = "entry cat-" + cat;
    card.dataset.id = e.id;

    const row1 = document.createElement("div");
    row1.className = "row1";
    if (e.type === "action") {
      row1.appendChild(span("chip " + (e.role === "dev" ? "dev" : "mod"), (e.role || "?").toUpperCase()));
      row1.appendChild(span("who " + (e.role === "dev" ? "dev" : "mod"), e.label || "?"));
      row1.appendChild(span("act", e.action || "?"));
    } else {
      // identity
      row1.appendChild(uref(e.username || "?", e.userId));
      const evt = e.event === "rename" ? "changed name"
        : e.event === "forced-rename" ? "force-renamed by staff" : "signed in";
      row1.appendChild(span("act", evt));
    }
    row1.appendChild(span("when", fmtTime(e.ts)));
    card.appendChild(row1);

    const meta = document.createElement("div");
    meta.className = "meta";
    if (e.type === "action") {
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

    if (e.details) {
      const d = document.createElement("div");
      d.className = "detail";
      d.textContent = e.details;
      card.appendChild(d);
    }

    // comment thread
    const thread = document.createElement("div");
    thread.className = "comments";
    thread.style.display = "none";
    card.appendChild(thread);
    (commentsByRef.get(e.id) || []).forEach((c) => appendComment(card, c));

    // comment box
    const box = document.createElement("div");
    box.className = "cmtbox";
    const input = document.createElement("input");
    input.placeholder = "Add a note or ask why…";
    input.maxLength = 500;
    const send = document.createElement("button");
    send.textContent = "Send";
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

  function passes(e) {
    if (tab !== "all" && e.type !== tab) return false;
    if (focusUid && !matchesFocus(e, focusUid)) return false;
    if (query && !searchable(e).includes(query)) return false;
    return true;
  }

  function render() {
    listEl.textContent = "";
    const parents = entries.filter((e) => e.type !== "comment" && passes(e));
    if (parents.length === 0) {
      const empty = document.createElement("div");
      empty.className = "ml-empty";
      empty.textContent = "No matching entries.";
      listEl.appendChild(empty);
      return;
    }
    for (let i = parents.length - 1; i >= 0; i--) listEl.appendChild(buildCard(parents[i]));
  }

  function setFocus(uid) {
    focusUid = uid;
    if (!uid) {
      focusBar.classList.add("hidden");
      focusBar.textContent = "";
      render();
      return;
    }
    const s = userSummary(uid);
    focusBar.classList.remove("hidden");
    focusBar.textContent = "";
    focusBar.appendChild(span(null, "Tracing user "));
    focusBar.appendChild(span("mono", uid));
    const sum = span("sum");
    sum.appendChild(document.createTextNode("  ·  names: "));
    sum.appendChild(boldList(s.names));
    sum.appendChild(document.createTextNode("   IPs: "));
    sum.appendChild(boldList(s.ips));
    sum.appendChild(document.createTextNode("   staff actions against them: "));
    const b = document.createElement("b");
    b.textContent = String(s.actionsAgainst);
    sum.appendChild(b);
    focusBar.appendChild(sum);
    const clear = document.createElement("button");
    clear.className = "ml-tbtn";
    clear.textContent = "Clear ✕";
    clear.addEventListener("click", () => setFocus(null));
    focusBar.appendChild(clear);
    render();
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
    m.textContent = "    Mods: ";
    m.style.color = "var(--orange)";
    rosterEl.appendChild(m);
    rosterEl.appendChild(document.createTextNode((roster.mods || []).join(", ") || "none"));
  }

  function renderLegend() {
    legendEl.textContent = "";
    LEGEND.forEach(([cat, text]) => {
      const row = document.createElement("div");
      row.className = "leg";
      const sw = document.createElement("span");
      sw.className = "swatch";
      sw.style.background = CAT_COLOR[cat];
      row.appendChild(sw);
      row.appendChild(span(null, text));
      legendEl.appendChild(row);
    });
    // role colors
    [["DEV", "var(--red)", "Developers (full power)"], ["MOD", "var(--orange)", "Moderators"]].forEach(
      ([tagTxt, color, text]) => {
        const row = document.createElement("div");
        row.className = "leg";
        const chip = span("chip " + (tagTxt === "DEV" ? "dev" : "mod"), tagTxt);
        row.appendChild(chip);
        const b = document.createElement("b");
        b.textContent = text;
        row.appendChild(b);
        legendEl.appendChild(row);
      },
    );
  }

  function showHelp() {
    if (!window.StaffUI) return;
    const w = StaffUI.el("div");
    const p = (t) => w.appendChild(StaffUI.el("p", { text: t }));
    p("This is the moderation log. It is a live, permanent record that keeps staff accountable to each other.");
    p("Each card is one event. The colored left edge and the action text tell you the category. Open the Legend (top right) for the key. DEV names are red, MOD names are orange.");
    p("Two kinds of events: ‘Actions’ are things staff did (kick, warn, etc., with the staff member, target, room and their IP). ‘Identity’ events are users signing in or changing names, with the user's IP, so any name can be traced back.");
    p("Trace a user: click any underlined name or the ⌖ trace link. You'll see every name they've used and every action taken against them. Click ‘Clear’ to exit.");
    p("Note: raw IP addresses are visible to developers only. Mods can still ban or IP-block a user, since the server handles the IP for them, but they never see the address itself.");
    p("Discuss: type under any entry to leave a permanent note or ask ‘why?’. All staff see comments. Use the filters and search to narrow things down.");
    StaffUI.modal({
      title: "How to read the Mod Log",
      icon: "📘",
      wide: true,
      body: w,
      actions: [{ label: "Got it", kind: "primary", onClick: () => {} }],
    });
  }

  // ── socket ──
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
    renderRoster(data && data.roster);
    renderLegend();
    render();
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
    if (passes(e)) {
      const empty = listEl.querySelector(".ml-empty");
      if (empty) empty.remove();
      listEl.insertBefore(buildCard(e), listEl.firstChild);
    }
  });

  const showDenied = () => {
    if (authorized) return;
    loadingEl.classList.add("hidden");
    appEl.classList.add("hidden");
    deniedEl.classList.remove("hidden");
  };
  socket.on("error", showDenied);
  socket.on("connect_error", showDenied);

  // ── key entry (no console) ──
  let pendingStaffKey = null;
  async function openStaffKeyEntry() {
    if (!window.StaffUI) return;
    const key = await StaffUI.prompt({
      title: "Staff access",
      icon: "🔑",
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
    if (window.StaffUI) StaffUI.toast("Key accepted. Reloading…", { type: "success" });
    setTimeout(() => window.location.reload(), 1000);
  });

  setTimeout(showDenied, 4500);

  // ── controls ──
  $("enterKeyBtn") && $("enterKeyBtn").addEventListener("click", openStaffKeyEntry);
  $("helpBtn").addEventListener("click", showHelp);
  $("legendBtn").addEventListener("click", () => legendEl.classList.toggle("hidden"));
  searchEl.addEventListener("input", () => {
    query = searchEl.value.trim().toLowerCase();
    render();
  });
  document.querySelectorAll(".ml-fbtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".ml-fbtn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      tab = btn.dataset.f;
      render();
    });
  });
  window.addEventListener("beforeunload", () => {
    try {
      socket.emit("staff stop audit");
    } catch (_) {}
  });
})();
