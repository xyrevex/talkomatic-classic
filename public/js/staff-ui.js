// public/js/staff-ui.js
// Shared staff UI kit used by the lobby, room, and the mod board. Provides
// clean, XSS-safe modals / confirms / forms / menus / toasts so the staff
// tools have one consistent look and never use native prompt()/confirm()/alert().
// Exposes window.StaffUI. All user-supplied text is escaped before display.

(function () {
  if (window.StaffUI) return;

  // ── styles (injected once; CSP allows inline styles) ──────────────────────
  const CSS = `
  .tk-backdrop *{box-sizing:border-box;}
  .tk-backdrop{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.74);
    backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;
    padding:16px;animation:tkFade .15s ease-out;box-sizing:border-box;}
  @keyframes tkFade{from{opacity:0}to{opacity:1}}
  @keyframes tkRise{from{transform:translateY(12px);opacity:0}to{transform:translateY(0);opacity:1}}
  .tk-card{background:linear-gradient(135deg,#1f1f1f 0%,#161616 100%);border:2px solid #ff9800;
    border-radius:12px;width:100%;max-width:430px;max-height:88vh;display:flex;flex-direction:column;
    box-shadow:0 18px 55px rgba(0,0,0,.6);animation:tkRise .18s ease-out;overflow:hidden;
    box-sizing:border-box;font-family:inherit;color:#eee;}
  .tk-card.tk-wide{max-width:560px;}
  .tk-head{display:flex;align-items:flex-start;gap:12px;padding:16px 18px 13px;border-bottom:1px solid #383838;}
  .tk-head .tk-ico{font-size:22px;line-height:1.1;flex:none;}
  .tk-head .tk-htext{flex:1;min-width:0;}
  .tk-title{font-size:16px;font-weight:700;color:#ff9800;margin:0;word-break:break-word;}
  .tk-sub{font-size:12.5px;color:#aaa;margin:3px 0 0;line-height:1.45;word-break:break-word;}
  .tk-x{background:none;border:none;color:#888;font-size:22px;cursor:pointer;line-height:1;
    padding:0 4px;border-radius:6px;flex:none;}
  .tk-x:hover{color:#ff9800;}
  .tk-body{padding:15px 18px;overflow-y:auto;overflow-x:hidden;font-size:13.5px;line-height:1.55;color:#ddd;}
  .tk-body p{margin:0 0 10px;word-break:break-word;}
  .tk-foot{display:flex;justify-content:flex-end;gap:8px;padding:13px 18px;border-top:1px solid #383838;flex-wrap:wrap;}
  .tk-btn{appearance:none;border:1px solid #555;background:#000;color:#eee;border-radius:8px;
    padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .12s;max-width:100%;}
  .tk-btn:hover{border-color:#ff9800;background:#161616;}
  .tk-btn.tk-primary{background:#ff9800;border-color:#ff9800;color:#000;}
  .tk-btn.tk-primary:hover{background:#ffb74d;border-color:#ffb74d;}
  .tk-btn.tk-danger{background:#e5484d;border-color:#e5484d;color:#fff;}
  .tk-btn.tk-danger:hover{background:#f15b60;border-color:#f15b60;}
  .tk-btn.tk-ghost{background:transparent;}
  .tk-field{margin:0 0 14px;}
  .tk-field:last-child{margin-bottom:0;}
  .tk-label{display:block;font-size:12px;font-weight:600;color:#ff9800;margin:0 0 6px;}
  .tk-input,.tk-textarea,.tk-select{width:100%;background:#000;color:#fff;
    border:1px solid #555;border-radius:8px;padding:10px 12px;font-size:13.5px;font-family:inherit;
    outline:none;transition:border-color .12s;}
  .tk-textarea{min-height:84px;resize:vertical;line-height:1.5;}
  .tk-input:focus,.tk-textarea:focus,.tk-select:focus{border-color:#ff9800;}
  .tk-help{font-size:11.5px;color:#888;margin:6px 0 0;word-break:break-word;}
  .tk-err{font-size:12px;color:#f1696e;margin:6px 0 0;display:none;}
  /* menu */
  .tk-group{margin:4px 0 14px;}
  .tk-group:last-child{margin-bottom:0;}
  .tk-gtitle{font-size:10.5px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;
    color:#ff9800;opacity:.85;margin:0 0 8px;padding:0 2px;}
  .tk-item{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:#000;
    border:1px solid #444;border-radius:9px;padding:11px 13px;margin:0 0 8px;cursor:pointer;
    transition:all .12s;font-family:inherit;color:#eee;}
  .tk-item:last-child{margin-bottom:0;}
  .tk-item:hover{background:#161616;border-color:#ff9800;}
  .tk-item:disabled{opacity:.45;cursor:not-allowed;}
  .tk-item .tk-iico{font-size:18px;width:22px;text-align:center;flex:none;}
  .tk-item .tk-itxt{flex:1;min-width:0;}
  .tk-item .tk-ilabel{font-size:13.5px;font-weight:600;color:#fff;word-break:break-word;}
  .tk-item .tk-idesc{font-size:11.5px;color:#999;margin-top:2px;line-height:1.4;word-break:break-word;}
  .tk-item.tk-d .tk-ilabel{color:#ff8a8e;}
  .tk-item.tk-d:hover{border-color:#e5484d;background:#1d1010;}
  .tk-chip{display:inline-block;font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;
    letter-spacing:.4px;vertical-align:middle;}
  .tk-chip.dev{background:#ffcf3f;color:#3a2c00;}
  .tk-chip.mod{background:#00bcd4;color:#003;}
  /* toasts */
  .tk-toasts,.tk-toast,.tk-toast *{box-sizing:border-box;}
  .tk-toasts{position:fixed;top:14px;right:14px;left:auto;z-index:100002;display:flex;flex-direction:column;
    gap:10px;max-width:340px;}
  .tk-toasts.tk-full{left:14px;right:14px;max-width:none;align-items:center;}
  .tk-toast{background:#0d0d0d;border:1px solid #444;border-left:5px solid #ff9800;border-radius:0;
    padding:13px 16px;box-shadow:0 8px 26px rgba(0,0,0,.6);animation:tkRise .16s ease-out;
    color:#eee;font-size:13.5px;line-height:1.5;display:flex;gap:12px;align-items:flex-start;width:100%;}
  .tk-toasts.tk-full .tk-toast{max-width:680px;}
  .tk-toast.info{border-left-color:#3b82f6;}
  .tk-toast.success{border-left-color:#22c55e;}
  .tk-toast.warning{border-left-color:#ff9800;}
  .tk-toast.error{border-left-color:#e5484d;}
  .tk-toast .tk-ttext{flex:1;min-width:0;word-break:break-word;}
  .tk-toast .tk-ttitle{font-weight:700;margin-bottom:2px;color:#ff9800;}
  .tk-toast .tk-tx{background:none;border:none;color:#888;cursor:pointer;font-size:16px;line-height:1;padding:0 2px;flex:none;}
  .tk-toast .tk-tx:hover{color:#fff;}
  @media (max-width:520px){
    .tk-backdrop{padding:10px;align-items:flex-end;}
    .tk-card{max-width:100%;max-height:92vh;border-radius:14px 14px 10px 10px;}
    .tk-foot{justify-content:stretch;}
    .tk-foot .tk-btn{flex:1;}
    .tk-toasts{top:8px;right:8px;left:8px;max-width:none;}
  }
  `;
  const style = document.createElement("style");
  style.id = "tk-staff-ui-styles";
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);

  function escape(s) {
    return String(s == null ? "" : s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }

  // tiny element helper
  function el(tag, props, children) {
    const e = document.createElement(tag);
    if (props)
      for (const k in props) {
        if (k === "class") e.className = props[k];
        else if (k === "text") e.textContent = props[k];
        else if (k === "html") e.innerHTML = props[k]; // only for pre-escaped/trusted
        else if (k.startsWith("on") && typeof props[k] === "function")
          e.addEventListener(k.slice(2).toLowerCase(), props[k]);
        else if (props[k] != null) e.setAttribute(k, props[k]);
      }
    if (children)
      (Array.isArray(children) ? children : [children]).forEach((c) => {
        if (c == null) return;
        e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      });
    return e;
  }

  let openCount = 0;

  // Core modal. `actions` = [{label, kind:'primary'|'danger'|'ghost', onClick, value}].
  // onClick returning false keeps the modal open. Returns { close }.
  function modal(opts) {
    const o = opts || {};
    const backdrop = el("div", { class: "tk-backdrop" });
    const card = el("div", { class: "tk-card" + (o.wide ? " tk-wide" : "") });

    const head = el("div", { class: "tk-head" });
    if (o.icon) head.appendChild(el("div", { class: "tk-ico", text: o.icon }));
    const htext = el("div", { class: "tk-htext" });
    htext.appendChild(el("div", { class: "tk-title", text: o.title || "" }));
    if (o.subtitle)
      htext.appendChild(el("div", { class: "tk-sub", text: o.subtitle }));
    head.appendChild(htext);
    const xBtn = el("button", { class: "tk-x", text: "×", title: "Close" });
    head.appendChild(xBtn);
    card.appendChild(head);

    const body = el("div", { class: "tk-body" });
    if (typeof o.body === "string")
      body.appendChild(el("p", { text: o.body }));
    else if (o.body) body.appendChild(o.body);
    card.appendChild(body);

    let foot = null;
    if (o.actions && o.actions.length) {
      foot = el("div", { class: "tk-foot" });
      o.actions.forEach((a) => {
        const b = el("button", {
          class:
            "tk-btn" +
            (a.kind === "primary"
              ? " tk-primary"
              : a.kind === "danger"
                ? " tk-danger"
                : a.kind === "ghost"
                  ? " tk-ghost"
                  : ""),
          text: a.label,
        });
        b.addEventListener("click", () => {
          if (a.onClick && a.onClick() === false) return;
          close();
        });
        foot.appendChild(b);
      });
      card.appendChild(foot);
    }

    function close() {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
      openCount = Math.max(0, openCount - 1);
      if (o.onClose) o.onClose();
    }
    function onKey(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    }
    xBtn.addEventListener("click", close);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop && o.dismissable !== false) close();
    });
    document.addEventListener("keydown", onKey);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
    openCount++;
    return { close, card, body };
  }

  function alert(title, message, icon) {
    return new Promise((res) => {
      modal({
        title,
        icon: icon || "ℹ️",
        body: message,
        dismissable: true,
        onClose: res,
        actions: [{ label: "OK", kind: "primary", onClick: () => {} }],
      });
    });
  }

  function confirm(opts) {
    const o = typeof opts === "string" ? { message: opts } : opts || {};
    return new Promise((res) => {
      let answered = false;
      modal({
        title: o.title || "Are you sure?",
        icon: o.icon || (o.danger ? "⚠️" : "❓"),
        subtitle: o.subtitle,
        body: o.message,
        onClose: () => {
          if (!answered) res(false);
        },
        actions: [
          {
            label: o.cancelText || "Cancel",
            kind: "ghost",
            onClick: () => {
              answered = true;
              res(false);
            },
          },
          {
            label: o.confirmText || "Confirm",
            kind: o.danger ? "danger" : "primary",
            onClick: () => {
              answered = true;
              res(true);
            },
          },
        ],
      });
    });
  }

  // Form prompt. fields: [{name,label,type,placeholder,value,options,required,maxLength,help}]
  function prompt(opts) {
    const o = opts || {};
    const fields = o.fields || [
      { name: "value", label: o.label || "Value", placeholder: o.placeholder },
    ];
    return new Promise((res) => {
      const form = el("form", { class: "tk-form" });
      if (o.message) form.appendChild(el("p", { text: o.message }));
      const inputs = {};
      fields.forEach((f) => {
        const wrap = el("div", { class: "tk-field" });
        if (f.label) wrap.appendChild(el("label", { class: "tk-label", text: f.label }));
        let input;
        if (f.type === "textarea") {
          input = el("textarea", {
            class: "tk-textarea",
            placeholder: f.placeholder || "",
            maxlength: f.maxLength,
          });
          if (f.value) input.value = f.value;
        } else if (f.type === "select") {
          input = el("select", { class: "tk-select" });
          (f.options || []).forEach((opt) => {
            const ov = typeof opt === "string" ? opt : opt.value;
            const ol = typeof opt === "string" ? opt : opt.label;
            const o2 = el("option", { value: ov, text: ol });
            if (f.value === ov) o2.selected = true;
            input.appendChild(o2);
          });
        } else {
          input = el("input", {
            class: "tk-input",
            type: f.type || "text",
            placeholder: f.placeholder || "",
            maxlength: f.maxLength,
          });
          if (f.value != null) input.value = f.value;
        }
        inputs[f.name] = input;
        wrap.appendChild(input);
        if (f.help) wrap.appendChild(el("div", { class: "tk-help", text: f.help }));
        form.appendChild(wrap);
      });
      const errEl = el("div", { class: "tk-err" });
      form.appendChild(errEl);

      let answered = false;
      const submit = () => {
        const values = {};
        for (const f of fields) {
          const v = inputs[f.name].value;
          if (f.required && !String(v).trim()) {
            errEl.textContent = `${f.label || f.name} is required.`;
            errEl.style.display = "block";
            inputs[f.name].focus();
            return false;
          }
          values[f.name] = v;
        }
        answered = true;
        res(fields.length === 1 && fields[0].name === "value" ? values.value : values);
        return true;
      };

      form.addEventListener("submit", (e) => {
        e.preventDefault();
        if (submit()) ctrl.close();
      });

      const ctrl = modal({
        title: o.title || "Input",
        icon: o.icon || "✏️",
        subtitle: o.subtitle,
        wide: o.wide,
        body: form,
        onClose: () => {
          if (!answered) res(null);
        },
        actions: [
          { label: o.cancelText || "Cancel", kind: "ghost", onClick: () => {} },
          {
            label: o.confirmText || "Submit",
            kind: o.danger ? "danger" : "primary",
            onClick: () => submit(),
          },
        ],
      });
      setTimeout(() => {
        const first = inputs[fields[0].name];
        if (first) first.focus();
      }, 50);
    });
  }

  // Grouped action menu. groups: [{title, items:[{icon,label,desc,danger,disabled,onClick,keepOpen}]}]
  function menu(opts) {
    const o = opts || {};
    const wrap = el("div");
    (o.groups || []).forEach((g) => {
      const gEl = el("div", { class: "tk-group" });
      if (g.title) gEl.appendChild(el("div", { class: "tk-gtitle", text: g.title }));
      (g.items || []).forEach((it) => {
        const btn = el("button", {
          class: "tk-item" + (it.danger ? " tk-d" : ""),
          type: "button",
        });
        if (it.disabled) btn.disabled = true;
        btn.appendChild(el("div", { class: "tk-iico", text: it.icon || "•" }));
        const tx = el("div", { class: "tk-itxt" });
        tx.appendChild(el("div", { class: "tk-ilabel", text: it.label }));
        if (it.desc) tx.appendChild(el("div", { class: "tk-idesc", text: it.desc }));
        btn.appendChild(tx);
        btn.addEventListener("click", () => {
          if (!it.keepOpen) ctrl.close();
          if (it.onClick) it.onClick();
        });
        gEl.appendChild(btn);
      });
      wrap.appendChild(gEl);
    });
    const actions = [];
    if (o.onHelp)
      actions.push({ label: "Help", kind: "ghost", onClick: () => { o.onHelp(); return false; } });
    actions.push({ label: "Close", kind: "ghost", onClick: () => {} });
    const ctrl = modal({
      title: o.title || "Menu",
      icon: o.icon || "⚙️",
      subtitle: o.subtitle,
      wide: o.wide,
      body: wrap,
      actions,
    });
    return ctrl;
  }

  let toastHost = null;
  function ensureHost(full) {
    if (!toastHost) {
      toastHost = el("div", { class: "tk-toasts" });
      document.body.appendChild(toastHost);
    }
    toastHost.className = "tk-toasts" + (full ? " tk-full" : "");
    return toastHost;
  }
  function toast(message, opts) {
    const o = opts || {};
    const host = ensureHost(o.fullWidth);
    const t = el("div", { class: "tk-toast " + (o.type || "info") });
    const txt = el("div", { class: "tk-ttext" });
    if (o.title) txt.appendChild(el("div", { class: "tk-ttitle", text: o.title }));
    txt.appendChild(el("div", { text: String(message == null ? "" : message) }));
    t.appendChild(txt);
    const x = el("button", { class: "tk-tx", text: "×" });
    x.addEventListener("click", () => t.remove());
    t.appendChild(x);
    host.appendChild(t);
    const ms = o.timeout != null ? o.timeout : 9000;
    if (ms > 0) setTimeout(() => t.remove(), ms);
    return t;
  }

  function copy(text) {
    try {
      if (navigator.clipboard) return navigator.clipboard.writeText(text);
    } catch (_) {}
    return Promise.resolve();
  }

  // ── Help: what every tool does and how to use it ─────────────────────────
  const HELP = [
    {
      title: "Per-user actions (open the ⚙ on a user's row in a room)",
      items: [
        ["Kick + room ban", "mod", "Removes the user and bans them from that room so they can't rejoin."],
        ["IP block", "mod", "Blocks the user's IP and disconnects them. Mods pick 1h / 24h / 7d; devs can also pick permanent."],
        ["Wipe typed text", "mod", "Clears what the user has typed from everyone's screen."],
        ["Warn", "mod", "Sends a private warning to one user, a heads up before you kick."],
        ["Force rename", "mod", "Resets an offensive username to Anonymous."],
        ["Freeze / unfreeze", "dev", "Locks the user's input server-side so they can't type, without kicking them."],
      ],
    },
    {
      title: "Room controls (Staff button in the room top bar)",
      items: [
        ["Clear Talkoboard", "mod", "Wipes the shared drawing board for the room."],
        ["Lock room", "mod", "Blocks new joins; people already inside stay. Good for calming a raid."],
        ["Slow mode", "mod", "Throttles how fast the room updates for everyone."],
        ["Close room", "mod", "Kicks everyone and deletes the room (for slur names / spam farms)."],
        ["Megaphone (this room)", "dev", "Shows an announcement banner to everyone in the room."],
        ["Party mode", "dev", "Confetti + party horn for the whole room."],
        ["Spotlight", "dev", "Pins the room to the top of the lobby with an Official badge."],
        ["Server HUD", "dev", "Live overlay of sockets / rooms / heap / solo-TTL."],
      ],
    },
    {
      title: "Lobby / global (⚙ Dev button in the lobby)",
      items: [
        ["Grant mod key", "dev", "Creates a new mod key shown once; give it to the person to paste into their browser."],
        ["Manage / revoke mod keys", "dev", "Lists current mod keys; revoke instantly downgrades that mod live."],
        ["Lobby ticker", "dev", "Editable banner at the top of the lobby, changeable live."],
        ["Megaphone (everywhere)", "dev", "Broadcasts an announcement to every room and the lobby."],
        ["Feature flags", "dev", "Toggle the word filter, room creation, and room limit at runtime."],
        ["Maintenance mode", "dev", "Blocks new rooms and joins with a friendly message for safe deploys."],
        ["Spectate", "dev", "Watch any room read-only without taking a slot or appearing."],
        ["Clear blacklist / unblock IP", "dev", "Lifts bot-blacklist entries or a specific IP block."],
        ["Nuke", "dev", "Emergency clear of ALL rooms. Requires confirmation."],
      ],
    },
    {
      title: "Accountability",
      items: [
        ["Mod Log board", "mod", "Open mod.html to see every staff action and every username/IP/name-change, live. Keeps everyone honest."],
      ],
    },
  ];

  function help(role) {
    const isDev = role === "dev";
    const wrap = el("div");
    wrap.appendChild(
      el("p", {
        text: isDev
          ? "You are a Dev, so you can use everything below."
          : "You are a Mod. Items marked Dev only are restricted to devs.",
      }),
    );
    HELP.forEach((sec) => {
      const g = el("div", { class: "tk-group" });
      g.appendChild(el("div", { class: "tk-gtitle", text: sec.title }));
      sec.items.forEach(([name, who, desc]) => {
        const row = el("div", { class: "tk-item", style: "cursor:default" });
        row.appendChild(
          el("div", {
            class: "tk-iico",
            text: who === "dev" ? "👑" : "🛡️",
          }),
        );
        const tx = el("div", { class: "tk-itxt" });
        const labelRow = el("div", { class: "tk-ilabel" });
        labelRow.appendChild(document.createTextNode(name + "  "));
        labelRow.appendChild(
          el("span", {
            class: "tk-chip " + (who === "dev" ? "dev" : "mod"),
            text: who === "dev" ? "Dev only" : "Mod + Dev",
          }),
        );
        tx.appendChild(labelRow);
        tx.appendChild(el("div", { class: "tk-idesc", text: desc }));
        row.appendChild(tx);
        g.appendChild(row);
      });
      wrap.appendChild(g);
    });
    return modal({
      title: "Staff help",
      icon: "📘",
      subtitle: "What each tool does and how to use it",
      wide: true,
      body: wrap,
      actions: [{ label: "Got it", kind: "primary", onClick: () => {} }],
    });
  }

  window.StaffUI = {
    escape,
    el,
    modal,
    alert,
    confirm,
    prompt,
    menu,
    toast,
    copy,
    help,
  };
})();
