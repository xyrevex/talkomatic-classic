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
  .tk-backdrop{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.82);
    display:flex;align-items:center;justify-content:center;
    padding:16px;animation:tkFade .15s ease-out;box-sizing:border-box;}
  @keyframes tkFade{from{opacity:0}to{opacity:1}}
  @keyframes tkRise{from{transform:translateY(12px);opacity:0}to{transform:translateY(0);opacity:1}}
  .tk-card{background:linear-gradient(135deg,#1f1f1f 0%,#161616 100%);border:2px solid #ff9800;
    border-radius:12px;width:100%;max-width:430px;max-height:88vh;display:flex;flex-direction:column;
    box-shadow:0 18px 55px rgba(0,0,0,.6);animation:tkRise .18s ease-out;overflow:hidden;
    box-sizing:border-box;font-family:inherit;color:#eee;}
  .tk-card.tk-wide{max-width:560px;}
  .tk-head{display:flex;align-items:center;gap:13px;padding:16px 18px 14px;border-bottom:1px solid #2c2c2c;background:rgba(255,152,0,.045);}
  .tk-head .tk-ico{font-size:18px;line-height:1;flex:none;width:42px;height:42px;display:flex;
    align-items:center;justify-content:center;border-radius:12px;background:rgba(255,152,0,.14);
    color:#ffa726;border:1px solid rgba(255,152,0,.3);}
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
  .tk-input:focus,.tk-textarea:focus,.tk-select:focus{border-color:#ff9800;box-shadow:0 0 0 3px rgba(255,152,0,.15);}
  .tk-help{font-size:11.5px;color:#888;margin:6px 0 0;word-break:break-word;}
  .tk-err{font-size:12px;color:#f1696e;margin:6px 0 0;display:none;}
  /* menu */
  .tk-group{margin:4px 0 14px;}
  .tk-group:last-child{margin-bottom:0;}
  .tk-gtitle{font-size:10.5px;font-weight:800;letter-spacing:.9px;text-transform:uppercase;
    color:#ff9800;margin:0 0 9px;padding-left:11px;position:relative;}
  .tk-gtitle::before{content:"";position:absolute;left:0;top:1px;bottom:1px;width:3px;border-radius:2px;background:#ff9800;}
  .tk-item{display:flex;align-items:center;gap:13px;width:100%;text-align:left;background:#0c0c0c;
    border:1px solid #2e2e2e;border-radius:12px;padding:10px 12px;margin:0 0 7px;cursor:pointer;
    transition:all .14s;font-family:inherit;color:#eee;}
  .tk-item:last-child{margin-bottom:0;}
  .tk-item:hover{background:#171717;border-color:rgba(255,152,0,.5);transform:translateX(2px);box-shadow:0 4px 16px rgba(0,0,0,.35);}
  .tk-item:disabled{opacity:.45;cursor:not-allowed;}
  .tk-item .tk-iico{font-size:15px;width:38px;height:38px;display:flex;align-items:center;justify-content:center;
    border-radius:11px;flex:none;background:rgba(255,152,0,.12);color:#ffa726;border:1px solid rgba(255,152,0,.24);
    transition:transform .14s,filter .14s;}
  .tk-item:hover .tk-iico{transform:scale(1.06);filter:brightness(1.12);}
  .tk-item .tk-itxt{flex:1;min-width:0;}
  .tk-item .tk-ilabel{font-size:13.5px;font-weight:700;color:#f4f4f4;word-break:break-word;}
  .tk-item .tk-idesc{font-size:11.5px;color:#9a9a9a;margin-top:2px;line-height:1.4;word-break:break-word;}
  button.tk-item::after{content:"›";color:#5a5a5a;font-size:19px;line-height:1;flex:none;font-weight:700;margin-left:2px;transition:color .14s,transform .14s;}
  button.tk-item:hover::after{color:#ff9800;transform:translateX(3px);}
  .tk-item.tk-d .tk-ilabel{color:#ff9094;}
  .tk-item.tk-d:hover{border-color:rgba(229,72,77,.55);background:#1a0f0f;box-shadow:0 4px 16px rgba(229,72,77,.14);}
  button.tk-item.tk-d:hover::after{color:#ff6b6f;}
  .tk-iico.t-default{background:rgba(255,152,0,.12);color:#ffa726;border-color:rgba(255,152,0,.24);}
  .tk-iico.t-danger{background:rgba(229,72,77,.14);color:#ff6b6f;border-color:rgba(229,72,77,.28);}
  .tk-iico.t-info{background:rgba(56,132,255,.15);color:#6aa8ff;border-color:rgba(56,132,255,.3);}
  .tk-iico.t-success{background:rgba(34,197,94,.14);color:#43d97c;border-color:rgba(34,197,94,.28);}
  .tk-iico.t-warn{background:rgba(255,193,7,.15);color:#ffc83d;border-color:rgba(255,193,7,.3);}
  .tk-iico.t-broadcast{background:rgba(168,85,247,.16);color:#c08bff;border-color:rgba(168,85,247,.32);}
  .tk-iico.t-dev{background:rgba(255,207,63,.15);color:#ffd24a;border-color:rgba(255,207,63,.32);}
  .tk-iico.t-mod{background:rgba(0,188,212,.15);color:#3fd6e6;border-color:rgba(0,188,212,.3);}
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
  /* sliding staff panel: right drawer / bottom sheet / centered window */
  .tk-panel{background:linear-gradient(135deg,#1f1f1f 0%,#161616 100%);color:#eee;display:flex;
    flex-direction:column;box-sizing:border-box;font-family:inherit;}
  .tk-panel *{box-sizing:border-box;}
  .tk-pl-drawer{position:fixed;top:0;right:0;height:100vh;height:100dvh;width:380px;max-width:96vw;
    border-left:2px solid #ff9800;z-index:99999;transform:translateX(100%);transition:transform .22s ease;
    box-shadow:-16px 0 42px rgba(0,0,0,.5);}
  .tk-pl-drawer.tk-pl-in{transform:translateX(0);}
  .tk-pl-sheet{width:100%;max-height:88vh;max-height:88dvh;border-top:2px solid #ff9800;
    border-radius:14px 14px 0 0;transform:translateY(100%);transition:transform .24s ease;
    box-shadow:0 -14px 42px rgba(0,0,0,.5);}
  .tk-pl-sheet.tk-pl-in{transform:translateY(0);}
  .tk-pl-center{position:relative;width:100%;max-width:440px;max-height:86vh;border:2px solid #ff9800;
    border-radius:12px;overflow:hidden;transform:translateY(10px);opacity:0;
    transition:transform .18s ease,opacity .18s ease;box-shadow:0 18px 55px rgba(0,0,0,.6);}
  .tk-pl-center.tk-pl-in{transform:translateY(0);opacity:1;}
  .tk-pl-back{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.66);display:flex;opacity:0;
    transition:opacity .16s ease;box-sizing:border-box;}
  .tk-pl-back.tk-pl-in{opacity:1;}
  .tk-pl-back-center{align-items:center;justify-content:center;padding:16px;}
  .tk-pl-back-sheet{align-items:flex-end;justify-content:center;}
  .tk-phead{position:relative;display:flex;align-items:center;gap:11px;padding:14px;
    border-bottom:1px solid #2a2a2a;}
  .tk-pl-sheet .tk-phead{padding-top:18px;}
  .tk-pl-sheet .tk-phead::before{content:"";position:absolute;top:7px;left:50%;transform:translateX(-50%);
    width:40px;height:4px;border-radius:2px;background:#444;}
  .tk-pico{width:40px;height:40px;flex:none;display:flex;align-items:center;justify-content:center;
    border-radius:10px;font-size:18px;background:rgba(255,152,0,.14);color:#ffa726;border:1px solid rgba(255,152,0,.3);}
  .tk-phtext{flex:1;min-width:0;}
  .tk-ptitle{font-size:15px;font-weight:700;color:#ff9800;word-break:break-word;}
  .tk-psub{font-size:11.5px;color:#9e9e9e;margin-top:1px;word-break:break-word;}
  .tk-pbtn{background:none;border:none;color:#8a8a8a;cursor:pointer;font-size:15px;line-height:1;width:32px;
    height:32px;border-radius:8px;flex:none;display:flex;align-items:center;justify-content:center;transition:all .12s;}
  .tk-pbtn:hover{color:#ff9800;background:rgba(255,152,0,.1);}
  .tk-px{font-size:21px;}
  .tk-pbody{flex:1;overflow-y:auto;overflow-x:hidden;padding:13px 14px;}
  .tk-pl-sheet .tk-pbody{padding-bottom:26px;}
  .tk-presize{position:absolute;left:0;top:0;bottom:0;width:9px;margin-left:-5px;cursor:ew-resize;z-index:2;
    transition:background .12s;}
  .tk-presize:hover{background:linear-gradient(90deg,rgba(255,152,0,.3),transparent);}
  @media (max-width:640px){
    .tk-presize{display:none;}
  }
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
        else if (k === "html")
          e.innerHTML = props[k]; // only for pre-escaped/trusted
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

  // Render an icon cell. FontAwesome markup (our own trusted <i ...> strings)
  // is rendered as HTML; anything else is plain text. Lets callers pass FA
  // icons instead of emoji.
  function iconNode(val, cls) {
    const s = String(val == null ? "" : val);
    return /^\s*<i\b/.test(s)
      ? el("div", { class: cls, html: s })
      : el("div", { class: cls, text: s });
  }

  // Subtle, semantic icon tints keyed off the FontAwesome icon name, so every
  // menu across the lobby / rooms / mod board is colour-coded the same way with
  // no per-item config. An explicit item.tone or a danger flag overrides this;
  // unmatched icons fall back to the themed orange (default).
  const TONE_BY_ICON = {
    ban: "danger",
    bomb: "danger",
    trash: "danger",
    "user-slash": "danger",
    gavel: "danger",
    bullhorn: "warn",
    lock: "warn",
    "fire-extinguisher": "warn",
    "triangle-exclamation": "warn",
    "user-secret": "warn",
    "screwdriver-wrench": "warn",
    gauge: "info",
    "chart-simple": "info",
    flag: "info",
    globe: "info",
    list: "info",
    clipboard: "info",
    snowflake: "info",
    unlock: "info",
    "magnifying-glass": "info",
    "circle-info": "info",
    "user-plus": "success",
    "user-shield": "success",
    "lock-open": "success",
    "circle-check": "success",
    "tower-broadcast": "broadcast",
    newspaper: "broadcast",
    "champagne-glasses": "broadcast",
    star: "broadcast",
    ghost: "dev",
    crown: "dev",
  };
  // FA style / utility tokens that are not the meaningful icon name.
  const TONE_SKIP = new Set([
    "solid",
    "regular",
    "brands",
    "light",
    "thin",
    "duotone",
    "sharp",
    "fw",
    "lg",
    "sm",
    "xs",
    "spin",
    "pulse",
    "beat",
    "fade",
  ]);
  function iconTone(icon) {
    const re = /fa-([a-z0-9-]+)/gi;
    let m;
    while ((m = re.exec(String(icon == null ? "" : icon)))) {
      if (!TONE_SKIP.has(m[1])) return TONE_BY_ICON[m[1]] || "default";
    }
    return "default";
  }

  let openCount = 0;

  // Core modal. `actions` = [{label, kind:'primary'|'danger'|'ghost', onClick, value}].
  // onClick returning false keeps the modal open. Returns { close }.
  function modal(opts) {
    const o = opts || {};
    const backdrop = el("div", { class: "tk-backdrop" });
    const card = el("div", { class: "tk-card" + (o.wide ? " tk-wide" : "") });

    const head = el("div", { class: "tk-head" });
    if (o.icon) head.appendChild(iconNode(o.icon, "tk-ico"));
    const htext = el("div", { class: "tk-htext" });
    htext.appendChild(el("div", { class: "tk-title", text: o.title || "" }));
    if (o.subtitle)
      htext.appendChild(el("div", { class: "tk-sub", text: o.subtitle }));
    head.appendChild(htext);
    const xBtn = el("button", { class: "tk-x", text: "×", title: "Close" });
    head.appendChild(xBtn);
    card.appendChild(head);

    const body = el("div", { class: "tk-body" });
    if (typeof o.body === "string") body.appendChild(el("p", { text: o.body }));
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
        icon: icon || '<i class="fas fa-circle-info"></i>',
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
        icon:
          o.icon ||
          (o.danger
            ? '<i class="fas fa-triangle-exclamation"></i>'
            : '<i class="fas fa-circle-question"></i>'),
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
        if (f.label)
          wrap.appendChild(el("label", { class: "tk-label", text: f.label }));
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
        if (f.help)
          wrap.appendChild(el("div", { class: "tk-help", text: f.help }));
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
        res(
          fields.length === 1 && fields[0].name === "value"
            ? values.value
            : values,
        );
        return true;
      };

      form.addEventListener("submit", (e) => {
        e.preventDefault();
        if (submit()) ctrl.close();
      });

      const ctrl = modal({
        title: o.title || "Input",
        icon: o.icon || '<i class="fas fa-pen"></i>',
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

  // Render the grouped action items shared by menu() (centered) and panel()
  // (drawer / sheet). closeOnClick closes the host when a non-keepOpen item is
  // tapped; getClose returns the host's close fn (resolved lazily at click time).
  function renderGroups(groups, getClose, closeOnClick) {
    const wrap = el("div");
    (groups || []).forEach((g) => {
      const gEl = el("div", { class: "tk-group" });
      if (g.title)
        gEl.appendChild(el("div", { class: "tk-gtitle", text: g.title }));
      (g.items || []).forEach((it) => {
        const btn = el("button", {
          class: "tk-item" + (it.danger ? " tk-d" : ""),
          type: "button",
        });
        if (it.disabled) btn.disabled = true;
        const tone = it.tone || (it.danger ? "danger" : iconTone(it.icon));
        btn.appendChild(iconNode(it.icon || "•", "tk-iico t-" + tone));
        const tx = el("div", { class: "tk-itxt" });
        tx.appendChild(el("div", { class: "tk-ilabel", text: it.label }));
        if (it.desc)
          tx.appendChild(el("div", { class: "tk-idesc", text: it.desc }));
        btn.appendChild(tx);
        btn.addEventListener("click", () => {
          if (closeOnClick && !it.keepOpen) {
            const c = getClose && getClose();
            if (c) c();
          }
          if (it.onClick) it.onClick();
        });
        gEl.appendChild(btn);
      });
      wrap.appendChild(gEl);
    });
    return wrap;
  }

  // Grouped action menu (centered modal). groups: [{title, items:[{icon,label,desc,danger,disabled,onClick,keepOpen,tone}]}]
  function menu(opts) {
    const o = opts || {};
    let ctrl;
    const wrap = renderGroups(o.groups, () => ctrl && ctrl.close, true);
    const actions = [];
    if (o.onHelp)
      actions.push({
        label: "Help",
        kind: "ghost",
        onClick: () => {
          o.onHelp();
          return false;
        },
      });
    actions.push({ label: "Close", kind: "ghost", onClick: () => {} });
    ctrl = modal({
      title: o.title || "Menu",
      icon: o.icon || '<i class="fas fa-screwdriver-wrench"></i>',
      subtitle: o.subtitle,
      wide: o.wide,
      body: wrap,
      actions,
    });
    return ctrl;
  }

  // ── Sliding staff panel: a right-docked drawer on desktop, a bottom sheet on
  // mobile, or a centered window (the desktop choice is saved per browser and
  // toggled from the panel header). Same grouped items as menu(); used for the
  // big room / dev panels. opts.onLayoutChange fires on open / close / resize so
  // the caller can reflow surrounding content (the room grid pushes aside).
  const PANEL_MODE_KEY = "talkomatic_staffMenuMode";
  const PANEL_WIDTH_KEY = "talkomatic_staffDrawerW";
  let activePanel = null;
  function isNarrow() {
    return window.matchMedia("(max-width:640px)").matches;
  }
  function panelMode() {
    try {
      const m = localStorage.getItem(PANEL_MODE_KEY);
      if (m === "modal" || m === "drawer") return m;
    } catch (_) {}
    return "drawer";
  }
  function setPanelMode(m) {
    try {
      localStorage.setItem(PANEL_MODE_KEY, m);
    } catch (_) {}
  }
  function drawerWidth() {
    let w = 380;
    try {
      w = parseInt(localStorage.getItem(PANEL_WIDTH_KEY), 10) || 380;
    } catch (_) {}
    return Math.max(300, Math.min(560, w));
  }
  function saveDrawerWidth(w) {
    try {
      localStorage.setItem(PANEL_WIDTH_KEY, String(Math.round(w)));
    } catch (_) {}
  }

  function panel(opts) {
    // Re-opening while one is up toggles it shut, so the Staff button toggles.
    if (activePanel) {
      activePanel.close();
      return null;
    }
    const o = opts || {};
    const mode = isNarrow()
      ? "sheet"
      : panelMode() === "modal"
        ? "center"
        : "drawer";
    let closed = false;
    let root = null;
    const panelEl = el("div", { class: "tk-panel tk-pl-" + mode });

    function fireLayout() {
      if (o.onLayoutChange) {
        try {
          o.onLayoutChange();
        } catch (_) {}
      }
    }
    function close() {
      if (closed) return;
      closed = true;
      activePanel = null;
      document.removeEventListener("keydown", onKey);
      panelEl.classList.remove("tk-pl-in");
      if (root) root.classList.remove("tk-pl-in");
      if (mode === "drawer") {
        document.documentElement.classList.remove("tk-drawer-open");
        fireLayout();
        setTimeout(fireLayout, 240);
      }
      setTimeout(() => {
        const node = root || panelEl;
        if (node && node.parentNode) node.parentNode.removeChild(node);
      }, 230);
      if (o.onClose) o.onClose();
    }
    function onKey(e) {
      if (e.key === "Escape") {
        if (openCount > 0) return; // a modal / prompt is stacked above the panel
        e.stopPropagation();
        close();
      }
    }

    const head = el("div", { class: "tk-phead" });
    if (o.icon) head.appendChild(iconNode(o.icon, "tk-pico"));
    const htext = el("div", { class: "tk-phtext" });
    htext.appendChild(
      el("div", { class: "tk-ptitle", text: o.title || "Staff tools" }),
    );
    if (o.subtitle)
      htext.appendChild(el("div", { class: "tk-psub", text: o.subtitle }));
    head.appendChild(htext);
    if (!isNarrow()) {
      const tg = el("button", {
        class: "tk-pbtn",
        type: "button",
        title:
          mode === "drawer"
            ? "Switch to a centered window"
            : "Dock to the right",
      });
      tg.innerHTML =
        mode === "drawer"
          ? '<i class="fas fa-window-maximize"></i>'
          : '<i class="fas fa-table-columns"></i>';
      tg.addEventListener("click", () => {
        setPanelMode(mode === "drawer" ? "modal" : "drawer");
        close();
        setTimeout(() => panel(o), 250);
      });
      head.appendChild(tg);
    }
    if (o.onHelp) {
      const hb = el("button", {
        class: "tk-pbtn",
        type: "button",
        title: "Help",
      });
      hb.innerHTML = '<i class="fas fa-circle-question"></i>';
      hb.addEventListener("click", () => o.onHelp());
      head.appendChild(hb);
    }
    const xb = el("button", {
      class: "tk-pbtn tk-px",
      type: "button",
      text: "×",
      title: "Close",
    });
    xb.addEventListener("click", close);
    head.appendChild(xb);
    panelEl.appendChild(head);

    const body = el("div", { class: "tk-pbody" });
    body.appendChild(renderGroups(o.groups, () => close, false));
    panelEl.appendChild(body);

    if (mode === "drawer") {
      const rh = el("div", { class: "tk-presize", title: "Drag to resize" });
      let dragging = false,
        startX = 0,
        startW = 0;
      rh.addEventListener("pointerdown", (e) => {
        dragging = true;
        startX = e.clientX;
        startW = panelEl.offsetWidth;
        try {
          rh.setPointerCapture(e.pointerId);
        } catch (_) {}
        e.preventDefault();
      });
      rh.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        let w = startW + (startX - e.clientX);
        w = Math.max(300, Math.min(560, w));
        panelEl.style.width = w + "px";
        document.documentElement.style.setProperty("--tk-drawer-w", w + "px");
        fireLayout();
      });
      const end = (e) => {
        if (!dragging) return;
        dragging = false;
        try {
          rh.releasePointerCapture(e.pointerId);
        } catch (_) {}
        saveDrawerWidth(panelEl.offsetWidth);
        fireLayout();
        setTimeout(fireLayout, 60);
      };
      rh.addEventListener("pointerup", end);
      rh.addEventListener("pointercancel", end);
      panelEl.appendChild(rh);
    }

    activePanel = { close };

    if (mode === "drawer") {
      const w = drawerWidth();
      panelEl.style.width = w + "px";
      document.documentElement.style.setProperty("--tk-drawer-w", w + "px");
      document.body.appendChild(panelEl);
      document.documentElement.classList.add("tk-drawer-open");
      requestAnimationFrame(() => panelEl.classList.add("tk-pl-in"));
      fireLayout();
      setTimeout(fireLayout, 240);
    } else {
      root = el("div", { class: "tk-pl-back tk-pl-back-" + mode });
      root.appendChild(panelEl);
      root.addEventListener("click", (e) => {
        if (e.target === root && o.dismissable !== false) close();
      });
      document.body.appendChild(root);
      requestAnimationFrame(() => {
        root.classList.add("tk-pl-in");
        panelEl.classList.add("tk-pl-in");
      });
    }
    document.addEventListener("keydown", onKey);
    return { close };
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
    if (o.title)
      txt.appendChild(el("div", { class: "tk-ttitle", text: o.title }));
    txt.appendChild(
      el("div", { text: String(message == null ? "" : message) }),
    );
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
      title: "Per-user actions (tap a user's row in a room)",
      items: [
        [
          "Kick + room ban",
          "mod",
          "Removes the user and bans them from that room so they can't rejoin.",
        ],
        [
          "IP block",
          "mod",
          "Blocks the user's IP and disconnects them. Mods pick 1h / 24h / 7d; devs can also pick permanent.",
        ],
        [
          "Wipe typed text",
          "mod",
          "Clears what the user has typed from everyone's screen.",
        ],
        [
          "Warn",
          "mod",
          "Sends a private warning to one user, a heads up before you kick.",
        ],
        ["Force rename", "mod", "Resets an offensive username to Anonymous."],
        [
          "Freeze / unfreeze",
          "dev",
          "Locks the user's input server-side so they can't type, without kicking them.",
        ],
      ],
    },
    {
      title: "Room controls (Staff button in the room top bar)",
      items: [
        [
          "Clear Talkoboard",
          "mod",
          "Wipes the shared drawing board for the room.",
        ],
        [
          "Lock room",
          "mod",
          "Blocks new joins; people already inside stay. Good for calming a raid.",
        ],
        [
          "Slow mode",
          "mod",
          "Throttles how fast the room updates for everyone.",
        ],
        [
          "Close room",
          "mod",
          "Kicks everyone and deletes the room (for slur names / spam farms).",
        ],
        [
          "Megaphone (this room)",
          "dev",
          "Shows an announcement banner to everyone in the room.",
        ],
        ["Party mode", "dev", "Confetti + party horn for the whole room."],
        [
          "Spotlight",
          "dev",
          "Pins the room to the top of the lobby with an Official badge.",
        ],
        [
          "Server HUD",
          "dev",
          "Live overlay of sockets / rooms / heap / solo-TTL.",
        ],
      ],
    },
    {
      title: "Lobby / global (Dev Panel button in the lobby)",
      items: [
        [
          "Grant mod key",
          "dev",
          "Creates a new mod key shown once; give it to the person to paste into their browser.",
        ],
        [
          "Manage / revoke mod keys",
          "dev",
          "Lists current mod keys; revoke instantly downgrades that mod live.",
        ],
        [
          "Lobby ticker",
          "dev",
          "Editable banner at the top of the lobby, changeable live.",
        ],
        [
          "Megaphone (everywhere)",
          "dev",
          "Broadcasts an announcement to every room and the lobby.",
        ],
        [
          "Feature flags",
          "dev",
          "Toggle the word filter, room creation, and room limit at runtime.",
        ],
        [
          "Maintenance mode",
          "dev",
          "Blocks new rooms and joins with a friendly message for safe deploys.",
        ],
        [
          "Spectate",
          "dev",
          "Watch any room read-only without taking a slot or appearing.",
        ],
        [
          "Clear blacklist / unblock IP",
          "dev",
          "Lifts bot-blacklist entries or a specific IP block.",
        ],
        ["Nuke", "dev", "Emergency clear of ALL rooms. Requires confirmation."],
      ],
    },
    {
      title: "Accountability",
      items: [
        [
          "Mod Dashboard",
          "mod",
          "Open mod dashboard to see every staff action and every username/IP/name-change, live. Keeps everyone honest.",
        ],
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
          iconNode(
            who === "dev"
              ? '<i class="fas fa-crown"></i>'
              : '<i class="fas fa-shield-halved"></i>',
            "tk-iico " + (who === "dev" ? "t-dev" : "t-mod"),
          ),
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
      icon: '<i class="fas fa-book-open"></i>',
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
    panel,
    toast,
    copy,
    help,
  };
})();
