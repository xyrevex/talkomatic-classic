// ====================================================================
      // POP SHOT — pixel-art shooting gallery
      // PNGs to drop alongside this file (rope drawn procedurally, no PNG):
      //   idle.png, shoot.png, background.png, bottle.png,
      //   shatter.png, shatter-down.png
      // Audio: pistol-shot.mp3, shatter.mp3 (procedural fallback if missing)
      // ====================================================================
      // ─── Storage layer (artifact + localStorage, kept in sync) ───────────
      const store = {
        async get(key) {
          try {
            if (typeof window !== "undefined" && window.storage) {
              const r = await window.storage.get(key);
              if (r && r.value) return r.value;
            }
          } catch (e) {}
          try {
            return localStorage.getItem(key);
          } catch (e) {
            return null;
          }
        },
        async set(key, val) {
          const s = String(val);
          try {
            if (window.storage) await window.storage.set(key, s);
          } catch (e) {}
          try {
            localStorage.setItem(key, s);
          } catch (e) {}
        },
      };
      const PROGRESS_KEY = "popshot_progress_v3";
      let progress = {
        highestLevel: 1,
        scores: {},
        totalShattered: 0,
        totalPerfects: 0,
        maxStreak: 0,
        multiKills: {},
        achievements: [],
      };
      async function loadProgress() {
        const raw = await store.get(PROGRESS_KEY);
        if (raw) {
          try {
            const p = JSON.parse(raw);
            if (p && typeof p === "object") {
              progress.highestLevel = Math.max(1, p.highestLevel | 0) || 1;
              progress.scores = p.scores || {};
              progress.totalShattered = p.totalShattered | 0;
              progress.totalPerfects = p.totalPerfects | 0;
              progress.maxStreak = p.maxStreak | 0;
              progress.multiKills = p.multiKills || {};
              progress.achievements = Array.isArray(p.achievements)
                ? p.achievements
                : [];
            }
          } catch (e) {}
        }
        refreshMenu();
      }
      async function saveProgress() {
        await store.set(PROGRESS_KEY, JSON.stringify(progress));
      }
      async function resetProgress() {
        if (
          !confirm(
            "Reset ALL progress including achievements? This cannot be undone.",
          )
        )
          return;
        progress = {
          highestLevel: 1,
          scores: {},
          totalShattered: 0,
          totalPerfects: 0,
          maxStreak: 0,
          multiKills: {},
          achievements: [],
        };
        await saveProgress();
        refreshMenu();
      }
      // ─── Achievements ────────────────────────────────────────────────────
      const ACHIEVEMENTS = [
        {
          id: "first_pop",
          name: "First Pop",
          desc: "Shatter your first bottle",
          icon: "🎯",
          check: (p) => p.totalShattered >= 1,
        },
        {
          id: "bottles_10",
          name: "Getting Warm",
          desc: "Shatter 10 bottles",
          icon: "🥉",
          check: (p) => p.totalShattered >= 10,
        },
        {
          id: "bottles_50",
          name: "Bottle Hunter",
          desc: "Shatter 50 bottles",
          icon: "🥈",
          check: (p) => p.totalShattered >= 50,
        },
        {
          id: "bottles_100",
          name: "Centurion",
          desc: "Shatter 100 bottles",
          icon: "🥇",
          check: (p) => p.totalShattered >= 100,
        },
        {
          id: "bottles_500",
          name: "Glass Crusher",
          desc: "Shatter 500 bottles",
          icon: "💎",
          check: (p) => p.totalShattered >= 500,
        },
        {
          id: "bottles_1000",
          name: "Bottle Legend",
          desc: "Shatter 1,000 bottles",
          icon: "👑",
          check: (p) => p.totalShattered >= 1000,
        },
        {
          id: "first_perfect",
          name: "Bullseye",
          desc: "Land your first PERFECT",
          icon: "⭐",
          check: (p) => p.totalPerfects >= 1,
        },
        {
          id: "perfects_25",
          name: "Sharpshooter",
          desc: "25 perfects",
          icon: "🎖️",
          check: (p) => p.totalPerfects >= 25,
        },
        {
          id: "perfects_100",
          name: "Sniper",
          desc: "100 perfects",
          icon: "🏆",
          check: (p) => p.totalPerfects >= 100,
        },
        {
          id: "perfects_500",
          name: "Dead-Eye",
          desc: "500 perfects",
          icon: "🔱",
          check: (p) => p.totalPerfects >= 500,
        },
        {
          id: "streak_5",
          name: "Hot Streak",
          desc: "5x streak",
          icon: "🔥",
          check: (p) => p.maxStreak >= 5,
        },
        {
          id: "streak_10",
          name: "On Fire",
          desc: "10x streak",
          icon: "🌶️",
          check: (p) => p.maxStreak >= 10,
        },
        {
          id: "streak_20",
          name: "Untouchable",
          desc: "20x streak",
          icon: "⚡",
          check: (p) => p.maxStreak >= 20,
        },
        {
          id: "double_kill",
          name: "Two Birds",
          desc: "Shatter 2 in one shot",
          icon: "✌️",
          check: (p) => (p.multiKills[2] | 0) >= 1,
        },
        {
          id: "triple_kill",
          name: "Triple Threat",
          desc: "Shatter 3 in one shot",
          icon: "☘️",
          check: (p) => (p.multiKills[3] | 0) >= 1,
        },
        {
          id: "quad_kill",
          name: "Four-Play",
          desc: "Shatter 4 in one shot",
          icon: "🍀",
          check: (p) => (p.multiKills[4] | 0) >= 1,
        },
        {
          id: "level_5",
          name: "Warming Up",
          desc: "Clear level 5",
          icon: "🎪",
          check: (p) => p.highestLevel > 5,
        },
        {
          id: "level_10",
          name: "Veteran",
          desc: "Clear level 10",
          icon: "🎗️",
          check: (p) => p.highestLevel > 10,
        },
        {
          id: "level_25",
          name: "Expert",
          desc: "Clear level 25",
          icon: "🏅",
          check: (p) => p.highestLevel > 25,
        },
        {
          id: "level_50",
          name: "Master Marksman",
          desc: "Clear level 50",
          icon: "🏆",
          check: (p) => p.highestLevel > 50,
        },
        {
          id: "level_100",
          name: "Living Legend",
          desc: "Clear level 100",
          icon: "👑",
          check: (p) => p.highestLevel > 100,
        },
        {
          id: "all_3star_5",
          name: "Flawless Five",
          desc: "3★ levels 1-5",
          icon: "✨",
          check: (p) => allThreeStars(p, 1, 5),
        },
        {
          id: "all_3star_10",
          name: "Perfectionist",
          desc: "3★ levels 1-10",
          icon: "🌟",
          check: (p) => allThreeStars(p, 1, 10),
        },
      ];
      function allThreeStars(p, from, to) {
        for (let i = from; i <= to; i++) {
          if (!p.scores[i] || (p.scores[i].stars | 0) < 3) return false;
        }
        return true;
      }
      const achQueue = [];
      let achToastBusy = false;
      function checkAchievements() {
        const newly = [];
        for (const a of ACHIEVEMENTS) {
          if (progress.achievements.indexOf(a.id) !== -1) continue;
          if (a.check(progress)) {
            progress.achievements.push(a.id);
            newly.push(a);
          }
        }
        if (newly.length > 0) {
          saveProgress();
          refreshMenu();
          newly.forEach((a) => achQueue.push(a));
          if (!achToastBusy) processAchQueue();
        }
      }
      function processAchQueue() {
        if (achQueue.length === 0) {
          achToastBusy = false;
          return;
        }
        achToastBusy = true;
        const a = achQueue.shift();
        const toast = document.getElementById("achToast");
        document.getElementById("achToastIcon").textContent = a.icon;
        document.getElementById("achToastName").textContent = a.name;
        document.getElementById("achToastDesc").textContent = a.desc;
        toast.classList.add("show");
        setTimeout(() => {
          toast.classList.remove("show");
          setTimeout(processAchQueue, 450);
        }, 3200);
      }
      // ─── Powerup definitions ─────────────────────────────────────────────
      // Each powerup is a hex pixel-token that hangs from a rope like a bottle.
      // - color/dark: hex face + shaded underside
      // - draw(ctx, size): procedural pixel icon centered at origin
      // - apply(): mutates active-effect state when picked up
      // - statusText(): chip label shown in HUD while active (null = not active)
      const POWERUP_TYPES = {
        ammo: {
          id: "ammo",
          label: "UNLIMITED",
          color: "#ffd151",
          dark: "#8a5a18",
          glow: "rgba(255, 209, 81, 0.6)",
          draw: (s) => {
            // Pixel lightning bolt
            ctx.fillStyle = "#000";
            const bolt = [
              [-0.12, -0.95],
              [0.55, -0.05],
              [0.12, -0.05],
              [0.42, 0.95],
              [-0.55, 0.15],
              [-0.12, 0.15],
            ];
            ctx.beginPath();
            bolt.forEach((pt, i) => {
              const x = pt[0] * s,
                y = pt[1] * s;
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            });
            ctx.closePath();
            ctx.lineWidth = 4;
            ctx.lineJoin = "miter";
            ctx.strokeStyle = "#000";
            ctx.stroke();
            ctx.fillStyle = "#fff5b0";
            ctx.fill();
            // Inner highlight
            ctx.fillStyle = "#fffcd6";
            ctx.fillRect(-s * 0.05, -s * 0.5, s * 0.12, s * 0.4);
          },
          apply: () => {
            fx.unlimitedAmmo =
              (fx.unlimitedAmmo > 0 ? fx.unlimitedAmmo : 0) + 5;
          },
        },
        slow: {
          id: "slow",
          label: "SLOW MO",
          color: "#7ad9ff",
          dark: "#1f4e6e",
          glow: "rgba(122, 217, 255, 0.6)",
          draw: (s) => {
            // 6-armed pixel snowflake
            ctx.strokeStyle = "#000";
            ctx.lineWidth = 6;
            ctx.lineCap = "square";
            for (let i = 0; i < 6; i++) {
              const a = (i * Math.PI) / 3;
              const ex = Math.cos(a) * s * 0.85;
              const ey = Math.sin(a) * s * 0.85;
              ctx.beginPath();
              ctx.moveTo(0, 0);
              ctx.lineTo(ex, ey);
              ctx.stroke();
              const bx = Math.cos(a) * s * 0.5;
              const by = Math.sin(a) * s * 0.5;
              const off1 = a + Math.PI / 3;
              const off2 = a - Math.PI / 3;
              ctx.beginPath();
              ctx.moveTo(bx, by);
              ctx.lineTo(
                bx + Math.cos(off1) * s * 0.28,
                by + Math.sin(off1) * s * 0.28,
              );
              ctx.moveTo(bx, by);
              ctx.lineTo(
                bx + Math.cos(off2) * s * 0.28,
                by + Math.sin(off2) * s * 0.28,
              );
              ctx.stroke();
            }
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 3;
            for (let i = 0; i < 6; i++) {
              const a = (i * Math.PI) / 3;
              ctx.beginPath();
              ctx.moveTo(0, 0);
              ctx.lineTo(Math.cos(a) * s * 0.85, Math.sin(a) * s * 0.85);
              ctx.stroke();
              const bx = Math.cos(a) * s * 0.5;
              const by = Math.sin(a) * s * 0.5;
              const off1 = a + Math.PI / 3;
              const off2 = a - Math.PI / 3;
              ctx.beginPath();
              ctx.moveTo(bx, by);
              ctx.lineTo(
                bx + Math.cos(off1) * s * 0.28,
                by + Math.sin(off1) * s * 0.28,
              );
              ctx.moveTo(bx, by);
              ctx.lineTo(
                bx + Math.cos(off2) * s * 0.28,
                by + Math.sin(off2) * s * 0.28,
              );
              ctx.stroke();
            }
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(0, 0, s * 0.16, 0, Math.PI * 2);
            ctx.fill();
          },
          apply: () => {
            fx.slowMo = (fx.slowMo > 0 ? fx.slowMo : 0) + 4;
          },
        },
        boom: {
          id: "boom",
          label: "BOOM",
          color: "#ff7a3a",
          dark: "#8a2810",
          glow: "rgba(255, 122, 58, 0.6)",
          draw: (s) => {
            // Spiky pixel star burst
            const spikes = 8;
            ctx.beginPath();
            for (let i = 0; i < spikes * 2; i++) {
              const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
              const r = i % 2 === 0 ? s * 0.95 : s * 0.42;
              const x = Math.cos(a) * r;
              const y = Math.sin(a) * r;
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.lineWidth = 4;
            ctx.strokeStyle = "#000";
            ctx.stroke();
            ctx.fillStyle = "#fff5b0";
            ctx.fill();
            // Inner hot center
            ctx.beginPath();
            for (let i = 0; i < spikes * 2; i++) {
              const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
              const r = i % 2 === 0 ? s * 0.5 : s * 0.22;
              const x = Math.cos(a) * r;
              const y = Math.sin(a) * r;
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.fillStyle = "#ff6020";
            ctx.fill();
          },
          apply: () => {
            fx.explosiveShots = (fx.explosiveShots | 0) + 3;
          },
        },
        refill: {
          id: "refill",
          label: "REFILL",
          color: "#6ee07a",
          dark: "#1f6a28",
          glow: "rgba(110, 224, 122, 0.6)",
          draw: (s) => {
            // Circular arrow (instant refresh icon)
            ctx.strokeStyle = "#000";
            ctx.lineWidth = 9;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.arc(0, 0, s * 0.58, Math.PI * 0.25, Math.PI * 1.75);
            ctx.stroke();
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.arc(0, 0, s * 0.58, Math.PI * 0.25, Math.PI * 1.75);
            ctx.stroke();
            // Arrow head at the gap
            const ax = Math.cos(Math.PI * 1.75) * s * 0.58;
            const ay = Math.sin(Math.PI * 1.75) * s * 0.58;
            ctx.fillStyle = "#000";
            ctx.beginPath();
            ctx.moveTo(ax + s * 0.18, ay - s * 0.05);
            ctx.lineTo(ax - s * 0.15, ay - s * 0.32);
            ctx.lineTo(ax - s * 0.32, ay + s * 0.05);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.moveTo(ax + s * 0.12, ay - s * 0.06);
            ctx.lineTo(ax - s * 0.12, ay - s * 0.26);
            ctx.lineTo(ax - s * 0.26, ay + s * 0.04);
            ctx.closePath();
            ctx.fill();
            // Tiny bullet pip in the center
            ctx.fillStyle = "#000";
            ctx.fillRect(-s * 0.13, -s * 0.18, s * 0.26, s * 0.36);
            ctx.fillStyle = "#ffd151";
            ctx.fillRect(-s * 0.1, -s * 0.15, s * 0.2, s * 0.3);
            ctx.fillStyle = "#c98a1e";
            ctx.fillRect(-s * 0.1, -s * 0.15, s * 0.2, s * 0.08);
          },
          apply: () => {
            bullets = maxBullets;
          },
        },
        dbl: {
          id: "dbl",
          label: "2X SCORE",
          color: "#d97aff",
          dark: "#5a1f80",
          glow: "rgba(217, 122, 255, 0.6)",
          draw: (s) => {
            // Pixel "2×" text using font for legibility
            ctx.font = `bold ${Math.floor(s * 1.1)}px 'Press Start 2P', monospace`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            // Black outline pass
            ctx.fillStyle = "#000";
            for (let dx = -3; dx <= 3; dx += 3) {
              for (let dy = -3; dy <= 3; dy += 3) {
                if (dx === 0 && dy === 0) continue;
                ctx.fillText("2×", dx, dy + 2);
              }
            }
            ctx.fillStyle = "#ffffff";
            ctx.fillText("2×", 0, 2);
          },
          apply: () => {
            fx.doubleScore = (fx.doubleScore > 0 ? fx.doubleScore : 0) + 8;
          },
        },
      };
      const POWERUP_KEYS = Object.keys(POWERUP_TYPES);
      // ─── Audio ───────────────────────────────────────────────────────────
      const SFX_URLS = {
        shot: "pistol-shot.mp3",
        shatter: "shatter.mp3",
      };
      const audioPool = { shot: [], shatter: [] };
      const audioReady = { shot: false, shatter: false };
      const audioFailed = { shot: false, shatter: false };
      const poolIdx = { shot: 0, shatter: 0 };
      const POOL_SIZE = 4;
      for (const name of Object.keys(SFX_URLS)) {
        for (let i = 0; i < POOL_SIZE; i++) {
          const a = new Audio();
          a.preload = "auto";
          a.volume = name === "shot" ? 0.42 : 0.5;
          a.crossOrigin = "anonymous";
          a.addEventListener(
            "canplaythrough",
            () => {
              audioReady[name] = true;
            },
            { once: true },
          );
          a.addEventListener("error", () => {
            audioFailed[name] = true;
          });
          a.src = SFX_URLS[name];
          audioPool[name].push(a);
        }
      }
      function playCDN(name) {
        if (audioFailed[name] || !audioReady[name]) return false;
        const a = audioPool[name][poolIdx[name]];
        poolIdx[name] = (poolIdx[name] + 1) % POOL_SIZE;
        try {
          a.currentTime = 0;
          const p = a.play();
          if (p && p.catch)
            p.catch(() => {
              audioFailed[name] = true;
            });
          return true;
        } catch (e) {
          audioFailed[name] = true;
          return false;
        }
      }
      let actx = null;
      function ensureAudio() {
        if (!actx) {
          try {
            actx = new (window.AudioContext || window.webkitAudioContext)();
          } catch (e) {
            actx = null;
          }
        }
        if (actx && actx.state === "suspended") actx.resume();
      }
      function playShotProc() {
        if (!actx) return;
        const t = actx.currentTime;
        const buf = actx.createBuffer(
          1,
          actx.sampleRate * 0.18,
          actx.sampleRate,
        );
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++)
          data[i] =
            (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 1.8);
        const noise = actx.createBufferSource();
        noise.buffer = buf;
        const filter = actx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(2800, t);
        filter.frequency.exponentialRampToValueAtTime(150, t + 0.18);
        const gain = actx.createGain();
        gain.gain.setValueAtTime(0.45, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(actx.destination);
        noise.start(t);
        noise.stop(t + 0.18);
        const osc = actx.createOscillator();
        osc.frequency.setValueAtTime(110, t);
        osc.frequency.exponentialRampToValueAtTime(35, t + 0.12);
        const og = actx.createGain();
        og.gain.setValueAtTime(0.55, t);
        og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        osc.connect(og);
        og.connect(actx.destination);
        osc.start(t);
        osc.stop(t + 0.12);
      }
      function playShatterProc() {
        if (!actx) return;
        const t = actx.currentTime;
        for (let i = 0; i < 10; i++) {
          const o = actx.createOscillator();
          o.type = "square";
          const f = 2800 + Math.random() * 4500;
          o.frequency.setValueAtTime(f, t + i * 0.006);
          o.frequency.exponentialRampToValueAtTime(
            f * 0.4,
            t + 0.12 + i * 0.006,
          );
          const g = actx.createGain();
          g.gain.setValueAtTime(0.07, t + i * 0.006);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.14 + i * 0.006);
          o.connect(g);
          g.connect(actx.destination);
          o.start(t + i * 0.006);
          o.stop(t + 0.18 + i * 0.006);
        }
      }
      function playPerfect() {
        ensureAudio();
        if (!actx) return;
        const t = actx.currentTime;
        [880, 1320, 1760].forEach((f, i) => {
          const o = actx.createOscillator();
          o.type = "square";
          o.frequency.value = f;
          const g = actx.createGain();
          g.gain.setValueAtTime(0.13, t + i * 0.06);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.18 + i * 0.06);
          o.connect(g);
          g.connect(actx.destination);
          o.start(t + i * 0.06);
          o.stop(t + 0.22 + i * 0.06);
        });
      }
      function playMultiKill(count) {
        ensureAudio();
        if (!actx) return;
        const t = actx.currentTime;
        const notes = [659, 880, 1175, 1568, 2093];
        for (let i = 0; i < Math.min(count + 1, notes.length); i++) {
          const o = actx.createOscillator();
          o.type = "square";
          o.frequency.value = notes[i];
          const g = actx.createGain();
          g.gain.setValueAtTime(0.16, t + i * 0.04);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.25 + i * 0.04);
          o.connect(g);
          g.connect(actx.destination);
          o.start(t + i * 0.04);
          o.stop(t + 0.3 + i * 0.04);
        }
      }
      function playEmpty() {
        ensureAudio();
        if (!actx) return;
        const t = actx.currentTime;
        const o = actx.createOscillator();
        o.type = "square";
        o.frequency.value = 180;
        const g = actx.createGain();
        g.gain.setValueAtTime(0.09, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
        o.connect(g);
        g.connect(actx.destination);
        o.start(t);
        o.stop(t + 0.07);
      }
      function playWin() {
        ensureAudio();
        if (!actx) return;
        const t = actx.currentTime;
        [523, 659, 784, 1047, 1319].forEach((f, i) => {
          const o = actx.createOscillator();
          o.type = "square";
          o.frequency.value = f;
          const g = actx.createGain();
          g.gain.setValueAtTime(0.12, t + i * 0.08);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.3 + i * 0.08);
          o.connect(g);
          g.connect(actx.destination);
          o.start(t + i * 0.08);
          o.stop(t + 0.32 + i * 0.08);
        });
      }
      function playLose() {
        ensureAudio();
        if (!actx) return;
        const t = actx.currentTime;
        [392, 330, 262, 196].forEach((f, i) => {
          const o = actx.createOscillator();
          o.type = "square";
          o.frequency.value = f;
          const g = actx.createGain();
          g.gain.setValueAtTime(0.15, t + i * 0.18);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.4 + i * 0.18);
          o.connect(g);
          g.connect(actx.destination);
          o.start(t + i * 0.18);
          o.stop(t + 0.45 + i * 0.18);
        });
      }
      // Ascending arpeggio for powerup pickup
      function playPowerup(type) {
        ensureAudio();
        if (!actx) return;
        const t = actx.currentTime;
        // Each type gets a unique chord progression
        const chords = {
          ammo: [880, 1109, 1318, 1760],
          slow: [659, 784, 988, 1175],
          boom: [220, 330, 440, 660],
          refill: [523, 659, 784, 1047],
          dbl: [698, 880, 1175, 1397],
        };
        const notes = chords[type] || chords.refill;
        notes.forEach((f, i) => {
          const o = actx.createOscillator();
          o.type = "square";
          o.frequency.value = f;
          const g = actx.createGain();
          g.gain.setValueAtTime(0.13, t + i * 0.045);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.22 + i * 0.045);
          o.connect(g);
          g.connect(actx.destination);
          o.start(t + i * 0.045);
          o.stop(t + 0.26 + i * 0.045);
        });
      }
      // Bassy thump for the explosive AoE
      function playExplosion() {
        ensureAudio();
        if (!actx) return;
        const t = actx.currentTime;
        const o = actx.createOscillator();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(140, t);
        o.frequency.exponentialRampToValueAtTime(40, t + 0.3);
        const g = actx.createGain();
        g.gain.setValueAtTime(0.32, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
        o.connect(g);
        g.connect(actx.destination);
        o.start(t);
        o.stop(t + 0.34);
        // crackle layer
        const buf = actx.createBuffer(
          1,
          actx.sampleRate * 0.25,
          actx.sampleRate,
        );
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++)
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 1.4);
        const n = actx.createBufferSource();
        n.buffer = buf;
        const ng = actx.createGain();
        ng.gain.setValueAtTime(0.22, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        n.connect(ng);
        ng.connect(actx.destination);
        n.start(t);
        n.stop(t + 0.25);
      }
      function playShot() {
        if (!playCDN("shot")) {
          ensureAudio();
          playShotProc();
        }
      }
      function playShatter() {
        if (!playCDN("shatter")) {
          ensureAudio();
          playShatterProc();
        }
      }
      // ─── Canvas + mouse tracking ─────────────────────────────────────────
      const canvas = document.getElementById("game");
      const ctx = canvas.getContext("2d");
      let W = 0,
        H = 0;
      let mouseX = window.innerWidth / 2;
      let mouseY = window.innerHeight / 2;
      function resize() {
        W = canvas.width = window.innerWidth;
        H = canvas.height = window.innerHeight;
      }
      window.addEventListener("resize", resize);
      resize();
      canvas.addEventListener("mousemove", (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
      });
      canvas.addEventListener(
        "touchmove",
        (e) => {
          if (e.touches && e.touches[0]) {
            mouseX = e.touches[0].clientX;
            mouseY = e.touches[0].clientY;
          }
        },
        { passive: true },
      );
      // ─── Assets ──────────────────────────────────────────────────────────
      const assets = {};
      const ASSET_FILES = [
        ["idle", "idle.png"],
        ["shoot", "shoot.png"],
        ["background", "background.png"],
        ["bottle", "bottle.png"],
        ["shatter", "shatter.png"],
        ["shatterDown", "shatter-down.png"],
      ];
      ASSET_FILES.forEach(([key, file]) => {
        const img = new Image();
        img.onload = () => {
          if (img.naturalWidth > 0) assets[key] = img;
        };
        img.onerror = () => {};
        img.src = file;
      });
      // ─── Game state ──────────────────────────────────────────────────────
      let state = "MENU";
      let level = 1;
      let levelScore = 0;
      let bullets = 0;
      let maxBullets = 0;
      let streak = 0;
      let bottles = [];
      let powerups = [];
      let explosions = [];
      let particles = [];
      let scorePops = [];
      let shake = 0;
      let shootAnim = 0;
      let bulletTracer = null;
      let powerupSpawnTimer = 0;
      // Active powerup-effect timers / counters
      const fx = {
        unlimitedAmmo: 0, // seconds remaining
        slowMo: 0, // seconds remaining
        doubleScore: 0, // seconds remaining
        explosiveShots: 0, // remaining shot count
      };
      let lvlStats = { shots: 0, misses: 0, perfects: 0 };
      const SHATTER_TOTAL = 0.7;
      const SHATTER_PHASE_1 = 0.2;
      const SHATTER_PHASE_2 = 0.5;
      const POWERUP_SHATTER = 0.45;
      const LEVELS_PER_PAGE = 24;
      let levelSelectPage = 0;
      // ─── Level config ────────────────────────────────────────────────────
      function getLevelConfig(lvl) {
        const bottleCount = Math.min(3 + Math.floor((lvl - 1) * 0.7), 18);
        let bts = bottleCount + 2;
        if (lvl >= 3) bts = bottleCount + 1;
        if (lvl >= 5) bts = bottleCount;
        if (lvl >= 8) bts = bottleCount - 1;
        if (lvl >= 14) bts = bottleCount - 2;
        if (lvl >= 22) bts = bottleCount - 3;
        const baseSpeedPct = 0.18 + lvl * 0.019;
        const depthChance = Math.min(0.55, 0.22 + lvl * 0.025);
        return {
          bottleCount,
          bullets: Math.max(2, bts),
          minSpeedPct: baseSpeedPct * 0.75,
          maxSpeedPct: baseSpeedPct * 1.4,
          depthChance,
        };
      }
      // ─── Geometry helpers ────────────────────────────────────────────────
      function bottleBaseSize() {
        const h = Math.min(H * 0.2, 220);
        let aspect = 0.36;
        if (assets.bottle && assets.bottle.naturalWidth > 0) {
          aspect = assets.bottle.naturalWidth / assets.bottle.naturalHeight;
        }
        return { w: h * aspect, h };
      }
      function bottleSizeFor(scale) {
        const b = bottleBaseSize();
        return { w: b.w * scale, h: b.h * scale };
      }
      function ropeLenFor(scale) {
        return Math.min(H * 0.4, 480) * (0.55 + scale * 0.45);
      }
      function powerupSize(scale) {
        // Half-extent (radius) of the hex token
        return Math.min(H * 0.07, 52) * scale;
      }
      function calculateStars(s) {
        if (s.misses === 0) return 3;
        if (s.misses === 1) return 2;
        return 1;
      }
      // ─── Draw: background ────────────────────────────────────────────────
      function drawBackground() {
        if (assets.background) {
          ctx.drawImage(assets.background, 0, 0, W, H);
          return;
        }
        const stops = [
          [0.0, "#1f1340"],
          [0.25, "#4a2255"],
          [0.45, "#8a3a52"],
          [0.62, "#d96a48"],
          [0.78, "#f3b86c"],
          [0.88, "#5a3624"],
          [1.0, "#2c1810"],
        ];
        const g = ctx.createLinearGradient(0, 0, 0, H);
        stops.forEach(([p, c]) => g.addColorStop(p, c));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "#fde6a8";
        ctx.beginPath();
        ctx.arc(W * 0.38, H * 0.48, Math.min(W, H) * 0.055, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#1a0e22";
        ctx.beginPath();
        ctx.moveTo(0, H * 0.62);
        for (let x = 0; x <= W; x += 40) {
          const n = Math.sin(x * 0.008) * 18 + Math.sin(x * 0.024) * 8;
          ctx.lineTo(x, H * 0.62 - n);
        }
        ctx.lineTo(W, H);
        ctx.lineTo(0, H);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#2a1810";
        ctx.fillRect(W * 0.04, H * 0.16, 14, H * 0.5);
        ctx.fillRect(W * 0.94, H * 0.16, 14, H * 0.5);
        ctx.strokeStyle = "#a88458";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(W * 0.04, H * 0.22);
        ctx.bezierCurveTo(
          W * 0.3,
          H * 0.235,
          W * 0.7,
          H * 0.235,
          W * 0.96,
          H * 0.22,
        );
        ctx.stroke();
      }
      // ─── Draw: procedural rope ───────────────────────────────────────────
      function drawHangingRope(length, scale) {
        const w = Math.max(4, Math.round(6 * scale + 2));
        const left = -Math.floor(w / 2);
        const right = left + w;
        const bandH = 3;
        for (let y = 0; y < length; y++) {
          const band = Math.floor(y / bandH);
          const phase = band % 2 === 0 ? 0 : 1;
          ctx.fillStyle = phase ? "#7a4f24" : "#a36e3a";
          ctx.fillRect(left, y, w, 1);
          const highlightX = left + ((band + Math.floor(y / 1.5)) % w);
          ctx.fillStyle = phase ? "#5a3818" : "#c98a4e";
          ctx.fillRect(highlightX, y, 1, 1);
        }
        ctx.fillStyle = "#d4a06a";
        ctx.fillRect(left, 0, 1, length);
        ctx.fillStyle = "#3a2010";
        ctx.fillRect(right - 1, 0, 1, length);
        const knotW = w + 4;
        const knotH = Math.max(5, Math.round(5 * scale + 2));
        ctx.fillStyle = "#8a5a2a";
        ctx.fillRect(
          -Math.floor(knotW / 2),
          -Math.floor(knotH * 0.6),
          knotW,
          knotH,
        );
        ctx.fillStyle = "#b88858";
        ctx.fillRect(
          -Math.floor(knotW / 2),
          -Math.floor(knotH * 0.6),
          1,
          knotH,
        );
        ctx.fillStyle = "#3a2010";
        ctx.fillRect(
          Math.floor(knotW / 2) - 1,
          -Math.floor(knotH * 0.6),
          1,
          knotH,
        );
        ctx.fillStyle = "#8a5a2a";
        ctx.fillRect(
          -Math.floor(knotW / 2),
          length - Math.floor(knotH * 0.4),
          knotW,
          knotH,
        );
        ctx.fillStyle = "#b88858";
        ctx.fillRect(
          -Math.floor(knotW / 2),
          length - Math.floor(knotH * 0.4),
          1,
          knotH,
        );
        ctx.fillStyle = "#3a2010";
        ctx.fillRect(
          Math.floor(knotW / 2) - 1,
          length - Math.floor(knotH * 0.4),
          1,
          knotH,
        );
      }
      // ─── Draw: bottle ────────────────────────────────────────────────────
      function drawBottle(b) {
        const { w: bw, h: bh } = bottleSizeFor(b.scale);
        const rl = ropeLenFor(b.scale);
        ctx.save();
        ctx.translate(b.x, b.pivotY);
        drawHangingRope(rl, b.scale);
        ctx.translate(0, rl);
        if (assets.bottle) {
          ctx.drawImage(assets.bottle, -bw / 2, 0, bw, bh);
          if (b.scale < 0.9) {
            ctx.globalCompositeOperation = "source-atop";
            ctx.fillStyle = `rgba(20, 12, 24, ${(1 - b.scale) * 0.45})`;
            ctx.fillRect(-bw / 2, 0, bw, bh);
            ctx.globalCompositeOperation = "source-over";
          }
        } else {
          ctx.fillStyle = "#6ea884";
          ctx.fillRect(-bw * 0.16, 0, bw * 0.32, bh * 0.14);
          ctx.beginPath();
          ctx.moveTo(-bw * 0.16, bh * 0.14);
          ctx.lineTo(-bw * 0.5, bh * 0.28);
          ctx.lineTo(-bw * 0.5, bh * 0.95);
          ctx.lineTo(-bw * 0.4, bh);
          ctx.lineTo(bw * 0.4, bh);
          ctx.lineTo(bw * 0.5, bh * 0.95);
          ctx.lineTo(bw * 0.5, bh * 0.28);
          ctx.lineTo(bw * 0.16, bh * 0.14);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = "#2a2218";
          ctx.fillRect(-bw * 0.18, -bh * 0.04, bw * 0.36, bh * 0.06);
          ctx.fillStyle = "#2451b8";
          ctx.fillRect(-bw * 0.48, bh * 0.42, bw * 0.96, bh * 0.26);
          ctx.fillStyle = "#3a6dd4";
          ctx.fillRect(-bw * 0.48, bh * 0.42, bw * 0.96, 3);
          ctx.fillStyle = "#f4e4bc";
          ctx.font = `bold ${Math.max(6, Math.floor(bh * 0.09))}px 'Press Start 2P', monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("POP SHOT", 0, bh * 0.55);
        }
        ctx.restore();
      }
      // ─── Draw: bottle shatter (two-phase) ────────────────────────────────
      function drawShatter(b) {
        const elapsed = SHATTER_TOTAL - b.shatterTime;
        const { w: bw, h: bh } = bottleSizeFor(b.scale);
        const rl = ropeLenFor(b.scale);
        const cx = b.x;
        const cy = b.pivotY + rl + bh / 2;
        if (elapsed < SHATTER_PHASE_1) {
          const t = elapsed / SHATTER_PHASE_1;
          const sc = 0.85 + t * 0.55;
          const alpha = t < 0.18 ? t / 0.18 : 1 - (t - 0.18) * 0.35;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.scale(sc, sc);
          ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
          if (assets.shatter) {
            const sw = bw * 2.6;
            ctx.drawImage(assets.shatter, -sw / 2, -sw / 2, sw, sw);
          } else {
            ctx.strokeStyle = "#fff5b0";
            ctx.lineWidth = 4;
            for (let i = 0; i < 10; i++) {
              const a = (i / 10) * Math.PI * 2;
              ctx.beginPath();
              ctx.moveTo(Math.cos(a) * bw * 0.3, Math.sin(a) * bw * 0.3);
              ctx.lineTo(Math.cos(a) * bw * 1.1, Math.sin(a) * bw * 1.1);
              ctx.stroke();
            }
            ctx.fillStyle = "#fff5b0";
            ctx.beginPath();
            ctx.arc(0, 0, bw * 0.28, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        } else {
          const t = (elapsed - SHATTER_PHASE_1) / SHATTER_PHASE_2;
          const eased = t * t;
          const yOff = eased * (bh * 0.5);
          const sc = 1 - t * 0.1;
          const alpha = t < 0.15 ? 1 : 1 - (t - 0.15) / 0.85;
          ctx.save();
          ctx.translate(cx, cy + yOff);
          ctx.scale(sc, sc);
          ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
          if (assets.shatterDown) {
            const sw = bw * 2.4;
            ctx.drawImage(assets.shatterDown, -sw / 2, -sw / 2, sw, sw);
          } else {
            ctx.fillStyle = "#a8e6c0";
            for (let i = 0; i < 8; i++) {
              const a = (i / 8) * Math.PI * 2;
              const x = Math.cos(a) * bw * 0.4;
              const y = Math.sin(a) * bw * 0.4 * 0.4 + bh * 0.15;
              ctx.fillRect(x - 3, y - 3, 6, 6);
            }
          }
          ctx.restore();
        }
      }
      // ─── Draw: powerup hex token ─────────────────────────────────────────
      function hexPath(cx, cy, r) {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
          const x = cx + Math.cos(a) * r;
          const y = cy + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
      }
      function drawPowerup(p) {
        const type = POWERUP_TYPES[p.type];
        if (!type) return;
        const sz = powerupSize(p.scale);
        const rl = ropeLenFor(p.scale);
        ctx.save();
        ctx.translate(p.x, p.pivotY);
        drawHangingRope(rl, p.scale);
        ctx.translate(0, rl + sz);
        // Bobbing/pulse animation (subtle)
        const pulse = 1 + Math.sin(p.time * 4.5) * 0.04;
        const bob = Math.sin(p.time * 2.3) * 2;
        ctx.translate(0, bob);
        ctx.scale(pulse, pulse);
        // Outer glow
        const glowR = sz * 1.55;
        const grad = ctx.createRadialGradient(0, 0, sz * 0.7, 0, 0, glowR);
        grad.addColorStop(0, type.glow);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(-glowR, -glowR, glowR * 2, glowR * 2);
        // Black outline hex (chunky pixel-art border)
        ctx.fillStyle = "#000";
        hexPath(0, 0, sz + 3);
        ctx.fill();
        // Face color
        ctx.fillStyle = type.color;
        hexPath(0, 0, sz);
        ctx.fill();
        // Shaded bottom half — fakes lighting
        ctx.save();
        hexPath(0, 0, sz);
        ctx.clip();
        ctx.fillStyle = type.dark;
        ctx.globalAlpha = 0.55;
        ctx.fillRect(-sz, sz * 0.05, sz * 2, sz);
        ctx.restore();
        // Top highlight band
        ctx.save();
        hexPath(0, 0, sz);
        ctx.clip();
        ctx.fillStyle = "rgba(255,255,255,0.32)";
        ctx.fillRect(-sz, -sz, sz * 2, sz * 0.4);
        ctx.restore();
        // Inner border line
        ctx.strokeStyle = type.dark;
        ctx.lineWidth = Math.max(2, sz * 0.08);
        hexPath(0, 0, sz);
        ctx.stroke();
        // Sparkle dots (pixel art accent)
        if ((p.time * 6) % 2 < 1) {
          ctx.fillStyle = "rgba(255,255,255,0.9)";
          ctx.fillRect(sz * 0.55, -sz * 0.55, 4, 4);
        }
        if ((p.time * 5 + 1) % 2 < 1) {
          ctx.fillStyle = "rgba(255,255,255,0.7)";
          ctx.fillRect(-sz * 0.5, sz * 0.4, 3, 3);
        }
        // Icon (centered)
        type.draw(sz * 0.62);
        ctx.restore();
      }
      // ─── Draw: powerup pickup poof ───────────────────────────────────────
      function drawPowerupShatter(p) {
        const type = POWERUP_TYPES[p.type];
        if (!type) return;
        const t = 1 - p.shatterTime / POWERUP_SHATTER;
        const sz = powerupSize(p.scale);
        const rl = ropeLenFor(p.scale);
        const cy = p.pivotY + rl + sz;
        ctx.save();
        ctx.translate(p.x, cy);
        // Expanding ring
        ctx.globalAlpha = (1 - t) * 0.95;
        ctx.strokeStyle = type.color;
        ctx.lineWidth = Math.max(2, 7 * (1 - t * 0.5));
        ctx.beginPath();
        ctx.arc(0, 0, sz * (1 + t * 2.2), 0, Math.PI * 2);
        ctx.stroke();
        // Second inner ring
        ctx.globalAlpha = (1 - t) * 0.7;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3 * (1 - t);
        ctx.beginPath();
        ctx.arc(0, 0, sz * (1 + t * 1.4), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      // ─── Draw: explosion ring ────────────────────────────────────────────
      function drawExplosions() {
        for (const e of explosions) {
          const t = 1 - e.life / e.total;
          const r = t * e.maxR;
          ctx.save();
          ctx.globalAlpha = (1 - t) * 0.9;
          ctx.strokeStyle = "#ff7a3a";
          ctx.lineWidth = Math.max(2, 10 * (1 - t * 0.5));
          ctx.beginPath();
          ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = "#fff5b0";
          ctx.lineWidth = Math.max(1, 5 * (1 - t));
          ctx.beginPath();
          ctx.arc(e.x, e.y, r * 0.72, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
      // ─── Particles, score pops, reticle, gun ─────────────────────────────
      function drawParticles() {
        for (const p of particles) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.globalAlpha = Math.min(1, p.life / 0.4);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
          ctx.restore();
        }
      }
      function drawScorePops() {
        for (const sp of scorePops) {
          const lift = (1 - sp.life / 1.1) * 70;
          ctx.save();
          ctx.translate(sp.x, sp.y - lift);
          ctx.globalAlpha = Math.min(1, sp.life * 1.5);
          ctx.font = `${sp.big ? 22 : sp.perfect ? 22 : 16}px 'Press Start 2P', monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = "#000";
          ctx.fillText(sp.text, 3, 3);
          ctx.fillStyle = sp.color || (sp.perfect ? "#ffd151" : "#f4e4bc");
          ctx.fillText(sp.text, 0, 0);
          ctx.restore();
        }
      }
      function drawReticle() {
        if (state !== "PLAYING") return;
        if (bulletTracer && bulletTracer.life > 0) {
          const a = bulletTracer.life / 0.09;
          ctx.save();
          ctx.globalAlpha = a;
          ctx.strokeStyle = fx.explosiveShots > 0 ? "#ff9a5a" : "#fff5b0";
          ctx.lineWidth = 4;
          ctx.lineCap = "round";
          ctx.shadowColor = fx.explosiveShots > 0 ? "#ff7a3a" : "#ffd151";
          ctx.shadowBlur = 14;
          ctx.beginPath();
          ctx.moveTo(bulletTracer.fromX, bulletTracer.fromY);
          ctx.lineTo(bulletTracer.toX, bulletTracer.toY);
          ctx.stroke();
          ctx.restore();
        }
        const minY = H * 0.3;
        const maxY = H * 0.58;
        const rx = W / 2;
        const ry = Math.max(minY, Math.min(maxY, mouseY));
        // Fixed crosshair — same size and weight across every level so muscle
        // memory carries over. White with a black outline for legibility on
        // both bright sky and dark silhouettes. Active powerups don't tint it;
        // that's what the HUD chips are for.
        const alpha = 0.92;
        const whiteW = 1.6;
        const blackW = 3.2;
        const r = 14;
        const g = 5;
        const dotI = 2;
        const dotO = 4;
        const xhairColor = `rgba(255, 255, 255, ${alpha})`;
        ctx.save();
        ctx.strokeStyle = `rgba(0, 0, 0, ${0.55 * alpha + 0.15})`;
        ctx.lineWidth = blackW;
        ctx.beginPath();
        ctx.arc(rx, ry, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(rx, ry - r);
        ctx.lineTo(rx, ry - g);
        ctx.moveTo(rx, ry + g);
        ctx.lineTo(rx, ry + r);
        ctx.moveTo(rx - r, ry);
        ctx.lineTo(rx - g, ry);
        ctx.moveTo(rx + g, ry);
        ctx.lineTo(rx + r, ry);
        ctx.stroke();
        ctx.strokeStyle = xhairColor;
        ctx.lineWidth = whiteW;
        ctx.beginPath();
        ctx.arc(rx, ry, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(rx, ry - r);
        ctx.lineTo(rx, ry - g);
        ctx.moveTo(rx, ry + g);
        ctx.lineTo(rx, ry + r);
        ctx.moveTo(rx - r, ry);
        ctx.lineTo(rx - g, ry);
        ctx.moveTo(rx + g, ry);
        ctx.lineTo(rx + r, ry);
        ctx.stroke();
        ctx.fillStyle = `rgba(0, 0, 0, ${0.6 * alpha + 0.2})`;
        ctx.fillRect(
          Math.floor(rx - dotO / 2),
          Math.floor(ry - dotO / 2),
          dotO,
          dotO,
        );
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, alpha + 0.1)})`;
        ctx.fillRect(
          Math.floor(rx - dotI / 2),
          Math.floor(ry - dotI / 2),
          dotI,
          dotI,
        );
        ctx.restore();
      }
      function drawGun() {
        const useShoot = shootAnim > 0 && assets.shoot;
        const img = useShoot ? assets.shoot : assets.idle;
        if (img) {
          const targetH = Math.min(H * 0.4, 460);
          const aspect = img.naturalWidth / img.naturalHeight;
          const gw = targetH * aspect;
          const gh = targetH;
          const x = (W - gw) / 2;
          const recoil = useShoot ? -10 : 0;
          const y = H - gh + recoil;
          ctx.drawImage(img, x, y, gw, gh);
        } else {
          ctx.fillStyle = "#3a2818";
          ctx.fillRect(W / 2 - 36, H * 0.78, 72, H * 0.22);
          ctx.fillStyle = "#1a1410";
          ctx.fillRect(W / 2 - 10, H * 0.65, 20, H * 0.16);
          ctx.fillStyle = "#5a4028";
          ctx.fillRect(W / 2 - 32, H * 0.83, 64, 6);
          if (shootAnim > 0) {
            const fx2 = W / 2,
              fy2 = H * 0.65;
            ctx.fillStyle = "#fff5b0";
            ctx.beginPath();
            ctx.arc(fx2, fy2, 34, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#ffb648";
            ctx.beginPath();
            ctx.arc(fx2, fy2, 22, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#c93a3a";
            ctx.beginPath();
            ctx.arc(fx2, fy2, 12, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      // ─── Slow-mo tint vignette ───────────────────────────────────────────
      function drawSlowMoOverlay() {
        if (fx.slowMo <= 0) return;
        // Soft blue vignette to telegraph the effect without obscuring play
        const intensity = Math.min(1, fx.slowMo / 0.6); // fade out at the end
        const grad = ctx.createRadialGradient(
          W / 2,
          H / 2,
          Math.min(W, H) * 0.2,
          W / 2,
          H / 2,
          Math.max(W, H) * 0.7,
        );
        grad.addColorStop(0, "rgba(122, 217, 255, 0)");
        grad.addColorStop(1, `rgba(50, 140, 200, ${0.32 * intensity})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
      }
      // ─── Update / Render ─────────────────────────────────────────────────
      function update(dt) {
        // Slow-mo affects the bottle/powerup world tick, not the UI/effects
        const worldMult = fx.slowMo > 0 ? 0.35 : 1;
        const wrapMargin = bottleBaseSize().w * 2;
        for (const b of bottles) {
          if (!b.broken) {
            b.time += dt;
            b.x += b.velocity * dt * worldMult;
            if (b.x < -wrapMargin) b.x = W + wrapMargin;
            if (b.x > W + wrapMargin) b.x = -wrapMargin;
          } else if (b.shatterTime > 0) {
            b.shatterTime -= dt;
          }
        }
        // Powerups
        const puMargin = Math.min(H * 0.07, 52) * 2 + 40;
        for (const p of powerups) {
          if (!p.broken) {
            p.time += dt;
            p.x += p.velocity * dt * worldMult;
            if (p.x < -puMargin) p.x = W + puMargin;
            if (p.x > W + puMargin) p.x = -puMargin;
            // Auto-despawn after a long life so they don't pile up forever
            p.life -= dt;
            if (p.life <= 0) {
              p.broken = true;
              p.shatterTime = POWERUP_SHATTER;
            }
          } else if (p.shatterTime > 0) {
            p.shatterTime -= dt;
          }
        }
        // Spawn timer (only while playing)
        if (state === "PLAYING") {
          powerupSpawnTimer -= dt;
          if (powerupSpawnTimer <= 0) {
            const alive = powerups.filter((p) => !p.broken).length;
            if (alive < 2) spawnPowerup();
            powerupSpawnTimer = 5 + Math.random() * 4;
          }
        }
        // Active effect timers tick at real time, not slowed
        if (fx.unlimitedAmmo > 0) {
          const prev = fx.unlimitedAmmo;
          fx.unlimitedAmmo = Math.max(0, fx.unlimitedAmmo - dt);
          // If Unlimited Ammo *just* expired and the underlying cylinder is
          // empty, end the level right now — the player can't recover by
          // shooting a Refill since they have no bullets to fire with.
          if (
            prev > 0 &&
            fx.unlimitedAmmo === 0 &&
            bullets <= 0 &&
            state === "PLAYING"
          ) {
            checkLevelEnd();
          }
        }
        if (fx.slowMo > 0) fx.slowMo = Math.max(0, fx.slowMo - dt);
        if (fx.doubleScore > 0)
          fx.doubleScore = Math.max(0, fx.doubleScore - dt);
        // Particles & pops
        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i];
          p.life -= dt;
          if (p.life <= 0) {
            particles.splice(i, 1);
            continue;
          }
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vy += 1100 * dt;
          p.vx *= 0.985;
          p.rot += p.vrot * dt;
        }
        for (let i = scorePops.length - 1; i >= 0; i--) {
          scorePops[i].life -= dt;
          if (scorePops[i].life <= 0) scorePops.splice(i, 1);
        }
        for (let i = explosions.length - 1; i >= 0; i--) {
          explosions[i].life -= dt;
          if (explosions[i].life <= 0) explosions.splice(i, 1);
        }
        // Clean up shattered powerups
        for (let i = powerups.length - 1; i >= 0; i--) {
          if (powerups[i].broken && powerups[i].shatterTime <= 0) {
            powerups.splice(i, 1);
          }
        }
        if (shake > 0) shake = Math.max(0, shake - dt * 55);
        if (shootAnim > 0) shootAnim -= dt;
        if (bulletTracer) {
          bulletTracer.life -= dt;
          if (bulletTracer.life <= 0) bulletTracer = null;
        }
        updateActiveEffectsUI();
      }
      function render() {
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, W, H);
        ctx.save();
        if (shake > 0)
          ctx.translate(
            (Math.random() - 0.5) * shake,
            (Math.random() - 0.5) * shake,
          );
        drawBackground();
        drawSlowMoOverlay();
        // Mix bottles + powerups into one list, sort by scale (smaller/farther first)
        const drawList = [];
        for (const b of bottles)
          drawList.push({ kind: "bottle", scale: b.scale, ref: b });
        for (const p of powerups)
          drawList.push({ kind: "powerup", scale: p.scale, ref: p });
        drawList.sort((a, b) => a.scale - b.scale);
        for (const item of drawList) {
          if (item.kind === "bottle") {
            const b = item.ref;
            if (!b.broken) drawBottle(b);
            else if (b.shatterTime > 0) drawShatter(b);
          } else {
            const p = item.ref;
            if (!p.broken) drawPowerup(p);
            else if (p.shatterTime > 0) drawPowerupShatter(p);
          }
        }
        drawExplosions();
        drawParticles();
        drawScorePops();
        drawReticle();
        drawGun();
        ctx.restore();
      }
      // ─── Powerup spawning ────────────────────────────────────────────────
      function spawnPowerup() {
        const typeKey =
          POWERUP_KEYS[Math.floor(Math.random() * POWERUP_KEYS.length)];
        const dir = Math.random() < 0.5 ? 1 : -1;
        const isDepth = Math.random() < 0.35;
        const scale = isDepth
          ? 0.7 + Math.random() * 0.12
          : 0.92 + Math.random() * 0.08;
        const cfg = getLevelConfig(level);
        const baseSpeed =
          cfg.minSpeedPct + Math.random() * (cfg.maxSpeedPct - cfg.minSpeedPct);
        // Powerups drift slightly slower than bottles so they're catchable
        const speedPct = baseSpeed * (0.6 + scale * 0.3) * 0.85;
        const velocity = dir * W * speedPct;
        const startX = dir > 0 ? -60 : W + 60;
        powerups.push({
          type: typeKey,
          x: startX,
          pivotY: -10,
          velocity,
          scale,
          broken: false,
          shatterTime: 0,
          time: Math.random() * Math.PI,
          life: 22, // auto-despawn after ~22s of drift if not shot
        });
      }
      // ─── Game actions ────────────────────────────────────────────────────
      function startLevel(lvl) {
        ensureAudio();
        level = lvl;
        levelScore = 0;
        streak = 0;
        lvlStats = { shots: 0, misses: 0, perfects: 0 };
        const cfg = getLevelConfig(level);
        bullets = cfg.bullets;
        maxBullets = cfg.bullets;
        bottles = [];
        powerups = [];
        explosions = [];
        particles = [];
        scorePops = [];
        shake = 0;
        // Reset all active effects when starting/replaying a level
        fx.unlimitedAmmo = 0;
        fx.slowMo = 0;
        fx.doubleScore = 0;
        fx.explosiveShots = 0;
        // First powerup spawns ~4s in
        powerupSpawnTimer = 4;
        const ropeY = -10;
        for (let i = 0; i < cfg.bottleCount; i++) {
          const dir = Math.random() < 0.5 ? 1 : -1;
          const isDepth = Math.random() < cfg.depthChance;
          const scale = isDepth
            ? 0.65 + Math.random() * 0.18
            : 0.92 + Math.random() * 0.08;
          const baseSpeed =
            cfg.minSpeedPct +
            Math.random() * (cfg.maxSpeedPct - cfg.minSpeedPct);
          const speedPct = baseSpeed * (0.7 + scale * 0.35);
          const velocity = dir * W * speedPct;
          const startX =
            (i / cfg.bottleCount) * W + Math.random() * (W / cfg.bottleCount);
          bottles.push({
            x: startX,
            pivotY: ropeY,
            velocity,
            scale,
            isDepth,
            broken: false,
            shatterTime: 0,
            time: 0,
          });
        }
        state = "PLAYING";
        hideAllScreens();
        document.getElementById("hud").classList.remove("hidden");
        document.getElementById("bullets").classList.remove("hidden");
        document.getElementById("bulletLabel").classList.remove("hidden");
        document.getElementById("activeEffects").classList.remove("hidden");
        updateHUD();
        updateActiveEffectsUI();
        showBanner(`LEVEL ${level}`);
      }
      function fire() {
        if (state !== "PLAYING") return;
        // Unlimited ammo bypasses the cylinder
        if (fx.unlimitedAmmo <= 0) {
          if (bullets <= 0) {
            // Out of ammo AND no unlimited backing us up — play the empty
            // click and immediately resolve the level. Without this, the
            // player can sit clicking an empty gun forever and the fail
            // screen never fires (since checkLevelEnd is only called after
            // an actual shot).
            playEmpty();
            checkLevelEnd();
            return;
          }
          bullets--;
        }
        lvlStats.shots++;
        shootAnim = 0.14;
        shake = 14;
        playShot();
        const minY = H * 0.3;
        const maxY = H * 0.58;
        const rx = W / 2;
        const ry = Math.max(minY, Math.min(maxY, mouseY));
        bulletTracer = {
          fromX: rx,
          fromY: H * 0.7,
          toX: rx,
          toY: ry,
          life: 0.09,
        };
        // ── Powerup hit check first (so picking one up applies before scoring) ──
        const puHits = [];
        for (const p of powerups) {
          if (p.broken) continue;
          const sz = powerupSize(p.scale);
          const cy = p.pivotY + ropeLenFor(p.scale) + sz;
          const dx = Math.abs(rx - p.x);
          const dy = Math.abs(ry - cy);
          if (dx < sz * 1.15 && dy < sz * 1.15) puHits.push(p);
        }
        // ── Bottle hit check ──
        const hits = [];
        for (const b of bottles) {
          if (b.broken) continue;
          const { w: bw, h: bh } = bottleSizeFor(b.scale);
          const rl = ropeLenFor(b.scale);
          const bottleTop = b.pivotY + rl;
          const bottleBottom = bottleTop + bh;
          const dx = Math.abs(rx - b.x);
          if (
            dx < bw / 2 + 8 &&
            ry >= bottleTop - 4 &&
            ry <= bottleBottom + 4
          ) {
            hits.push({ bottle: b, dx, bw });
          }
        }
        // ── Explosive AoE expansion ──
        // Charge is consumed on every shot while active, regardless of hit.
        // AoE only triggers when at least one bottle is directly hit, and adds
        // every other un-broken bottle within `radius` of the first hit's center.
        let explosionFired = false;
        if (fx.explosiveShots > 0) {
          fx.explosiveShots--;
          if (hits.length > 0) {
            explosionFired = true;
            const origin = hits[0].bottle;
            const { h: bh0 } = bottleSizeFor(origin.scale);
            const rl0 = ropeLenFor(origin.scale);
            const ex = origin.x;
            const ey = origin.pivotY + rl0 + bh0 / 2;
            const radius = Math.min(W, H) * 0.16;
            const aoe = [];
            const already = new Set(hits.map((h) => h.bottle));
            for (const b of bottles) {
              if (b.broken || already.has(b)) continue;
              const { w: bw2, h: bh2 } = bottleSizeFor(b.scale);
              const rl2 = ropeLenFor(b.scale);
              const cy2 = b.pivotY + rl2 + bh2 / 2;
              const d = Math.hypot(b.x - ex, cy2 - ey);
              if (d < radius) {
                aoe.push({ bottle: b, dx: 0, bw: bw2, fromExpl: true });
                already.add(b);
              }
            }
            hits.push(...aoe);
            explosions.push({
              x: ex,
              y: ey,
              maxR: radius,
              life: 0.45,
              total: 0.45,
            });
            playExplosion();
            shake = Math.max(shake, 26);
          }
        }
        // ── Apply bottle hits ──
        let multiKillBonus = 0;
        if (hits.length > 0) {
          streak++;
          if (streak > progress.maxStreak) progress.maxStreak = streak;
          let anyPerfect = false;
          for (const h of hits) {
            // AoE chain hits never qualify as "perfect" — only the directly-aimed shot can
            const perfectThreshold = h.fromExpl ? -1 : h.bw * 0.2;
            const isPerfect = !h.fromExpl && h.dx < perfectThreshold;
            if (isPerfect) {
              anyPerfect = true;
              lvlStats.perfects++;
              progress.totalPerfects++;
            }
            multiKillBonus += breakBottle(h.bottle, isPerfect, !!h.fromExpl);
            progress.totalShattered++;
          }
          playShatter();
          if (hits.length >= 2) {
            progress.multiKills[hits.length] =
              (progress.multiKills[hits.length] | 0) + 1;
            showMultiKill(hits.length, multiKillBonus);
            playMultiKill(hits.length);
            shake = Math.max(shake, 20 + hits.length * 6);
          }
          if (anyPerfect) {
            setTimeout(playPerfect, 90);
            triggerScreenFlash();
          }
          saveProgress();
          checkAchievements();
        } else if (puHits.length === 0) {
          // Pure miss — only resets streak / counts as a miss when nothing
          // was hit. Misses during Unlimited Ammo do NOT count toward star
          // rating: the powerup is designed for spraying and it's unfair to
          // tax accuracy on free shots. Normal-cylinder misses still count.
          streak = 0;
          if (fx.unlimitedAmmo <= 0) lvlStats.misses++;
        }
        // ── Activate any picked-up powerups ──
        for (const p of puHits) activatePowerup(p);
        updateHUD();
        setTimeout(checkLevelEnd, 320);
      }
      function breakBottle(b, isPerfect, fromExpl) {
        b.broken = true;
        b.shatterTime = SHATTER_TOTAL;
        const sizeMult = b.scale < 0.75 ? 2 : b.scale < 0.9 ? 1.5 : 1;
        const base = (isPerfect ? 300 : 100) * sizeMult;
        const mult = Math.max(1, streak);
        const dblMult = fx.doubleScore > 0 ? 2 : 1;
        const pts = Math.floor(base * mult * dblMult);
        levelScore += pts;
        const { w: bw, h: bh } = bottleSizeFor(b.scale);
        const rl = ropeLenFor(b.scale);
        const cx = b.x;
        const cy = b.pivotY + rl + bh / 2;
        const prefix = isPerfect ? "★ " : fromExpl ? "💥 " : "+";
        const multText = mult > 1 ? ` x${mult}` : "";
        const dblText = dblMult > 1 ? " 2X" : "";
        scorePops.push({
          x: cx,
          y: cy,
          text: prefix + pts + multText + dblText,
          life: 1.1,
          perfect: isPerfect,
          color: dblMult > 1 ? "#d97aff" : isPerfect ? "#ffd151" : "#f4e4bc",
        });
        const count = isPerfect ? 26 : 18;
        for (let i = 0; i < count; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 220 + Math.random() * 400;
          const tone = Math.random();
          particles.push({
            x: cx,
            y: cy,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp - 140,
            rot: Math.random() * Math.PI * 2,
            vrot: (Math.random() - 0.5) * 14,
            size: Math.max(3, (4 + Math.random() * 6) * b.scale),
            color:
              tone < 0.18
                ? "#2451b8"
                : tone < 0.45
                  ? "#a8e6c0"
                  : tone < 0.85
                    ? "#6ea884"
                    : "#f4e4bc",
            life: 0.5 + Math.random() * 0.5,
          });
        }
        if (isPerfect) shake = Math.max(shake, 24);
        return pts;
      }
      function activatePowerup(p) {
        const type = POWERUP_TYPES[p.type];
        if (!type) return;
        p.broken = true;
        p.shatterTime = POWERUP_SHATTER;
        // Apply the effect
        type.apply();
        // Visual feedback
        const sz = powerupSize(p.scale);
        const cy = p.pivotY + ropeLenFor(p.scale) + sz;
        scorePops.push({
          x: p.x,
          y: cy - sz * 0.5,
          text: type.label + "!",
          life: 1.6,
          perfect: false,
          big: true,
          color: type.color,
        });
        // Burst of colored sparks
        for (let i = 0; i < 22; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 180 + Math.random() * 360;
          particles.push({
            x: p.x,
            y: cy,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp - 100,
            rot: Math.random() * Math.PI * 2,
            vrot: (Math.random() - 0.5) * 14,
            size: Math.max(3, 4 + Math.random() * 5),
            color: Math.random() < 0.6 ? type.color : "#ffffff",
            life: 0.6 + Math.random() * 0.5,
          });
        }
        shake = Math.max(shake, 18);
        playPowerup(p.type);
        updateHUD();
        updateActiveEffectsUI();
      }
      function checkLevelEnd() {
        if (state !== "PLAYING") return;
        const remaining = bottles.filter((b) => !b.broken).length;
        if (remaining === 0) {
          const bulletBonus = bullets * 200;
          const levelBonus = 500 + level * 100;
          levelScore += bulletBonus + levelBonus;
          const stars = calculateStars(lvlStats);
          state = "COMPLETE";
          playWin();
          const prev = progress.scores[level];
          const wasBest = !prev || levelScore > (prev.score || 0);
          progress.scores[level] = {
            score: Math.max(levelScore, prev ? prev.score || 0 : 0),
            stars: Math.max(stars, prev ? prev.stars || 0 : 0),
          };
          if (level >= progress.highestLevel) progress.highestLevel = level + 1;
          saveProgress();
          refreshMenu();
          checkAchievements();
          setTimeout(
            () => showCompleteScreen(stars, wasBest, bulletBonus, levelBonus),
            550,
          );
        } else if (bullets <= 0 && fx.unlimitedAmmo <= 0) {
          // Don't fail if unlimited-ammo is keeping us alive
          state = "FAILED";
          playLose();
          setTimeout(() => showFailScreen(remaining), 700);
        }
        updateHUD();
      }
      // ─── Screen management ───────────────────────────────────────────────
      function hideAllScreens() {
        [
          "menuScreen",
          "levelSelectScreen",
          "achievementsScreen",
          "completeScreen",
          "failScreen",
        ].forEach((id) => document.getElementById(id).classList.add("hidden"));
      }
      function hideHUD() {
        document.getElementById("hud").classList.add("hidden");
        document.getElementById("bullets").classList.add("hidden");
        document.getElementById("bulletLabel").classList.add("hidden");
        document.getElementById("activeEffects").classList.add("hidden");
      }
      function goToMenu() {
        state = "MENU";
        bottles = [];
        powerups = [];
        explosions = [];
        particles = [];
        scorePops = [];
        shake = 0;
        fx.unlimitedAmmo = 0;
        fx.slowMo = 0;
        fx.doubleScore = 0;
        fx.explosiveShots = 0;
        hideAllScreens();
        hideHUD();
        document.getElementById("menuScreen").classList.remove("hidden");
        refreshMenu();
      }
      function goToLevelSelect() {
        state = "LEVEL_SELECT";
        hideAllScreens();
        hideHUD();
        levelSelectPage = Math.floor(
          (progress.highestLevel - 1) / LEVELS_PER_PAGE,
        );
        renderLevelGrid();
        document.getElementById("levelSelectScreen").classList.remove("hidden");
      }
      function goToAchievements() {
        state = "ACHIEVEMENTS";
        hideAllScreens();
        hideHUD();
        renderAchGrid();
        document
          .getElementById("achievementsScreen")
          .classList.remove("hidden");
      }
      function showCompleteScreen(stars, wasBest, bulletBonus, levelBonus) {
        hideAllScreens();
        hideHUD();
        document.getElementById("completedLevelNum").textContent = level;
        document.getElementById("completedScore").textContent =
          levelScore.toLocaleString();
        document.getElementById("completedDetails").innerHTML =
          `BULLETS LEFT: <span style="color:#ffd151">${bullets}</span> × 200 = ${bulletBonus}<br>` +
          `LEVEL BONUS: ${levelBonus}<br>` +
          `MISSES: ${lvlStats.misses} · PERFECTS: ${lvlStats.perfects}`;
        document
          .getElementById("newBestBadge")
          .classList.toggle("hidden", !wasBest);
        for (let i = 1; i <= 3; i++)
          document.getElementById("star" + i).classList.remove("lit");
        document.getElementById("completeScreen").classList.remove("hidden");
        for (let i = 1; i <= stars; i++) {
          setTimeout(
            () => document.getElementById("star" + i).classList.add("lit"),
            200 + (i - 1) * 240,
          );
        }
      }
      function showFailScreen(remaining) {
        hideAllScreens();
        hideHUD();
        document.getElementById("failedLevelNum").textContent = level;
        document.getElementById("failedScore").textContent =
          levelScore.toLocaleString();
        document.getElementById("failedDetails").innerHTML =
          `<span style="color:#c93a3a">${remaining}</span> bottle${remaining === 1 ? "" : "s"} survived.`;
        document.getElementById("failScreen").classList.remove("hidden");
      }
      const MK_LABELS = {
        2: "DOUBLE!",
        3: "TRIPLE!",
        4: "QUAD!",
        5: "MULTI KILL!",
        6: "INSANE!",
      };
      function showMultiKill(count, bonus) {
        const el = document.getElementById("multiKill");
        document.getElementById("mkLabel").textContent =
          MK_LABELS[Math.min(6, count)] || "INSANE!";
        document.getElementById("mkBonus").textContent =
          "+" + bonus.toLocaleString();
        el.classList.remove("hidden", "show");
        void el.offsetWidth;
        el.classList.add("show");
      }
      function triggerScreenFlash() {
        const f = document.getElementById("screenFlash");
        f.classList.remove("flash");
        void f.offsetWidth;
        f.classList.add("flash");
      }
      // ─── Level grid ──────────────────────────────────────────────────────
      function renderLevelGrid() {
        const grid = document.getElementById("levelGrid");
        grid.innerHTML = "";
        const startLvl = levelSelectPage * LEVELS_PER_PAGE + 1;
        const endLvl = startLvl + LEVELS_PER_PAGE - 1;
        for (let lvl = startLvl; lvl <= endLvl; lvl++) {
          const card = document.createElement("div");
          card.className = "level-card";
          const unlocked = lvl <= progress.highestLevel;
          const data = progress.scores[lvl];
          const stars = data ? data.stars : 0;
          if (!unlocked) {
            card.classList.add("locked");
            card.innerHTML = `<div class="lvl-num">${lvl}</div><div class="lvl-stars"><span class="dim">☆☆☆</span></div><div class="lvl-score">LOCKED</div>`;
          } else {
            if (lvl === progress.highestLevel) card.classList.add("current");
            const starsHtml =
              "★".repeat(stars) +
              '<span class="dim">' +
              "☆".repeat(3 - stars) +
              "</span>";
            const scoreText =
              data && data.score > 0 ? data.score.toLocaleString() : "—";
            card.innerHTML = `<div class="lvl-num">${lvl}</div><div class="lvl-stars">${starsHtml}</div><div class="lvl-score">${scoreText}</div>`;
            card.addEventListener("click", () => startLevel(lvl));
          }
          grid.appendChild(card);
        }
        const maxPage = Math.max(
          0,
          Math.floor((progress.highestLevel - 1) / LEVELS_PER_PAGE),
        );
        document.getElementById("prevPageBtn").disabled = levelSelectPage === 0;
        document.getElementById("nextPageBtn").disabled =
          levelSelectPage >= maxPage;
        document.getElementById("pageInfo").textContent =
          `PAGE ${levelSelectPage + 1} / ${maxPage + 1}`;
      }
      // ─── Achievements grid ───────────────────────────────────────────────
      function renderAchGrid() {
        const grid = document.getElementById("achGrid");
        grid.innerHTML = "";
        const unlockedSet = new Set(progress.achievements);
        for (const a of ACHIEVEMENTS) {
          const card = document.createElement("div");
          const unlocked = unlockedSet.has(a.id);
          card.className = "ach-card " + (unlocked ? "unlocked" : "locked");
          card.innerHTML = `
      <div class="ach-card-icon">${unlocked ? a.icon : "🔒"}</div>
      <div class="ach-card-text">
        <div class="ach-card-name">${a.name}</div>
        <div class="ach-card-desc">${a.desc}</div>
      </div>
    `;
          grid.appendChild(card);
        }
        document.getElementById("achSummary").textContent =
          `${progress.achievements.length} / ${ACHIEVEMENTS.length} UNLOCKED`;
      }
      // ─── Menu / HUD refresh ──────────────────────────────────────────────
      function refreshMenu() {
        document.getElementById("playLevelNum").textContent =
          progress.highestLevel;
        document.getElementById("bestLevelStat").textContent =
          progress.highestLevel;
        document.getElementById("totalBottlesStat").textContent =
          progress.totalShattered.toLocaleString();
        let totalScore = 0,
          totalStars = 0;
        for (const key in progress.scores) {
          const d = progress.scores[key];
          if (d) {
            totalScore += d.score || 0;
            totalStars += d.stars || 0;
          }
        }
        document.getElementById("totalScoreStat").textContent =
          totalScore.toLocaleString();
        document.getElementById("starsStat").textContent = totalStars;
      }
      function updateHUD() {
        document.getElementById("scoreEl").textContent =
          levelScore.toLocaleString();
        document.getElementById("levelEl").textContent = level;
        document.getElementById("bottlesEl").textContent =
          progress.totalShattered.toLocaleString();
        const streakEl = document.getElementById("streakEl");
        const s = Math.max(1, streak);
        streakEl.textContent = `x${s}`;
        streakEl.style.color =
          s >= 5 ? "#ffd151" : s >= 3 ? "#f4e4bc" : "#d4b896";
        const bw = document.getElementById("bullets");
        bw.innerHTML = "";
        const infinite = fx.unlimitedAmmo > 0;
        for (let i = 0; i < maxBullets; i++) {
          const d = document.createElement("div");
          let cls = "bullet-pip";
          if (infinite) cls += " infinite";
          else if (i >= bullets) cls += " spent";
          d.className = cls;
          bw.appendChild(d);
        }
      }
      // ─── Active-effect chips (HUD) ───────────────────────────────────────
      // Tiny inline-SVG icon per powerup type — keeps the carnival pixel feel
      // and avoids font-dependent emoji rendering quirks in the HUD.
      function chipIconSVG(typeId) {
        if (typeId === "ammo")
          return '<svg viewBox="0 0 16 16"><polygon fill="#fff5b0" stroke="#000" stroke-width="1.5" points="7,1 11,7 8.5,7 9.5,15 4,8 6.5,8 5.5,1"/></svg>';
        if (typeId === "slow")
          return '<svg viewBox="0 0 16 16"><g stroke="#fff" stroke-width="1.6" stroke-linecap="square" fill="none"><line x1="8" y1="1" x2="8" y2="15"/><line x1="1" y1="8" x2="15" y2="8"/><line x1="3" y1="3" x2="13" y2="13"/><line x1="13" y1="3" x2="3" y2="13"/></g><circle cx="8" cy="8" r="1.4" fill="#fff"/></svg>';
        if (typeId === "boom")
          return '<svg viewBox="0 0 16 16"><polygon fill="#fff5b0" stroke="#000" stroke-width="1.2" points="8,1 9.5,5 13.5,3.5 12,7.5 15,8 12,8.5 13.5,12.5 9.5,11 8,15 6.5,11 2.5,12.5 4,8.5 1,8 4,7.5 2.5,3.5 6.5,5"/></svg>';
        if (typeId === "refill")
          return '<svg viewBox="0 0 16 16"><path d="M 13.5 8 A 5.5 5.5 0 1 1 8 2.5" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/><polygon points="13,1 14.5,4.5 10.5,3.5" fill="#fff"/></svg>';
        if (typeId === "dbl")
          return '<svg viewBox="0 0 16 16"><text x="8" y="11" text-anchor="middle" font-family="Press Start 2P, monospace" font-size="9" fill="#fff" stroke="#000" stroke-width="0.5">2×</text></svg>';
        return "";
      }
      function updateActiveEffectsUI() {
        const wrap = document.getElementById("activeEffects");
        if (state !== "PLAYING") {
          wrap.innerHTML = "";
          return;
        }
        const chips = [];
        if (fx.unlimitedAmmo > 0)
          chips.push({
            type: "ammo",
            val: fx.unlimitedAmmo.toFixed(1) + "s",
            ending: fx.unlimitedAmmo < 1,
          });
        if (fx.slowMo > 0)
          chips.push({
            type: "slow",
            val: fx.slowMo.toFixed(1) + "s",
            ending: fx.slowMo < 1,
          });
        if (fx.doubleScore > 0)
          chips.push({
            type: "dbl",
            val: fx.doubleScore.toFixed(1) + "s",
            ending: fx.doubleScore < 1,
          });
        if (fx.explosiveShots > 0)
          chips.push({
            type: "boom",
            val: "×" + fx.explosiveShots,
            ending: fx.explosiveShots === 1,
          });
        // Diff-friendly render: only rebuild if the chip set changed
        const key = chips
          .map((c) => c.type + ":" + c.val + ":" + c.ending)
          .join("|");
        if (wrap.dataset.key === key) return;
        wrap.dataset.key = key;
        wrap.innerHTML = chips
          .map((c) => {
            const pt = POWERUP_TYPES[c.type];
            return `<div class="effect-chip${c.ending ? " ending" : ""}" style="border-color:${pt.color};color:${pt.color}">
            <span class="chip-icon">${chipIconSVG(c.type)}</span>
            <span style="color:#f4e4bc">${pt.label}</span>
            <span class="chip-val">${c.val}</span>
          </div>`;
          })
          .join("");
      }
      function showBanner(text) {
        const el = document.getElementById("roundBanner");
        el.textContent = text;
        el.classList.remove("flash");
        void el.offsetWidth;
        el.classList.add("flash");
      }
      // ─── Input ───────────────────────────────────────────────────────────
      canvas.addEventListener("mousedown", () => {
        if (state === "PLAYING") fire();
      });
      canvas.addEventListener(
        "touchstart",
        (e) => {
          if (state === "PLAYING") {
            e.preventDefault();
            if (e.touches && e.touches[0]) {
              mouseX = e.touches[0].clientX;
              mouseY = e.touches[0].clientY;
            }
            fire();
          }
        },
        { passive: false },
      );
      document.addEventListener("keydown", (e) => {
        if (e.code === "Space") {
          e.preventDefault();
          if (state === "PLAYING") fire();
        }
      });
      document.addEventListener("mousedown", ensureAudio, { once: true });
      document.addEventListener("keydown", ensureAudio, { once: true });
      document.addEventListener("touchstart", ensureAudio, { once: true });
      document
        .getElementById("playBtn")
        .addEventListener("click", () => startLevel(progress.highestLevel));
      document
        .getElementById("levelSelectBtn")
        .addEventListener("click", goToLevelSelect);
      document
        .getElementById("achievementsBtn")
        .addEventListener("click", goToAchievements);
      document
        .getElementById("resetBtn")
        .addEventListener("click", resetProgress);
      document
        .getElementById("backFromSelectBtn")
        .addEventListener("click", goToMenu);
      document
        .getElementById("backFromAchBtn")
        .addEventListener("click", goToMenu);
      document.getElementById("prevPageBtn").addEventListener("click", () => {
        if (levelSelectPage > 0) {
          levelSelectPage--;
          renderLevelGrid();
        }
      });
      document.getElementById("nextPageBtn").addEventListener("click", () => {
        const maxPage = Math.max(
          0,
          Math.floor((progress.highestLevel - 1) / LEVELS_PER_PAGE),
        );
        if (levelSelectPage < maxPage) {
          levelSelectPage++;
          renderLevelGrid();
        }
      });
      document
        .getElementById("nextLevelBtn")
        .addEventListener("click", () => startLevel(level + 1));
      document
        .getElementById("replayLevelBtn")
        .addEventListener("click", () => startLevel(level));
      document
        .getElementById("completeToMenuBtn")
        .addEventListener("click", goToMenu);
      document
        .getElementById("tryAgainBtn")
        .addEventListener("click", () => startLevel(level));
      document
        .getElementById("failToMenuBtn")
        .addEventListener("click", goToMenu);
      // ─── Main loop ───────────────────────────────────────────────────────
      let lastTime = performance.now();
      function loop(now) {
        const dt = Math.min(0.04, (now - lastTime) / 1000);
        lastTime = now;
        update(dt);
        render();
        requestAnimationFrame(loop);
      }
      requestAnimationFrame(loop);
      // ─── Init ────────────────────────────────────────────────────────────
      loadProgress();