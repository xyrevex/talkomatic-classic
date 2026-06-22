// server/roles.js
// Staff key system: mod-key store, hash validation, and the action audit log.
//
// Dev key is a single SHA-256 hash in .env (CONFIG.DEV.KEY_HASH), owner-only,
// restart-to-change. Mod keys live in mod-keys.json as { hash, label } records,
// loaded at boot and mutable at runtime (devs grant/revoke without a restart).
// Every privileged action appends one line to modlog.txt.

const path = require("path");
const fs = require("fs");
const fsp = require("fs").promises;
const crypto = require("crypto");
const { CONFIG } = require("./state");

const MOD_KEYS_PATH = path.join(__dirname, "..", "mod-keys.json");
const MODLOG_PATH = path.join(__dirname, "..", "modlog.txt");

// In-memory mirror of mod-keys.json: [{ hash, label }]
let modKeys = [];

function hashKey(key) {
  return crypto
    .createHash("sha256")
    .update(String(key))
    .digest("hex");
}

// Loaded synchronously at module require time so the socket middleware can
// validate keys on the very first connection.
function loadModKeys() {
  try {
    const raw = fs.readFileSync(MOD_KEYS_PATH, "utf8");
    const arr = JSON.parse(raw);
    modKeys = Array.isArray(arr)
      ? arr
          .filter((k) => k && typeof k.hash === "string")
          .map((k) => ({ hash: k.hash, label: String(k.label || "mod") }))
      : [];
  } catch (err) {
    if (err.code !== "ENOENT")
      console.error("Error loading mod-keys.json:", err);
    modKeys = [];
  }
  return modKeys;
}

// Atomic write (tmp + rename) mirrors how rooms.json is persisted.
async function saveModKeys() {
  const tmp = MOD_KEYS_PATH + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(modKeys, null, 2), "utf8");
  await fsp.rename(tmp, MOD_KEYS_PATH);
}

// Dev keys live in .env as DEV_KEY_HASH — a comma-separated list of
// "<sha256hash>" or "<sha256hash>:Label" entries (owner-only, restart to
// change). This supports multiple devs, each with a name for the audit log.
let devKeys = [];
function loadDevKeys() {
  const raw = CONFIG.DEV.KEY_HASH || "";
  devKeys = String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const idx = part.indexOf(":");
      if (idx === -1)
        return { hash: part.trim().toLowerCase(), label: "dev" };
      return {
        hash: part.slice(0, idx).trim().toLowerCase(),
        label: part.slice(idx + 1).trim() || "dev",
      };
    });
  return devKeys;
}

function getDevKey(key) {
  if (!key) return null;
  const h = hashKey(key);
  return devKeys.find((d) => d.hash === h) || null;
}

function isDevKey(key) {
  return !!getDevKey(key);
}

// Hashes + labels only — safe for an info panel.
function listDevKeys() {
  return devKeys.map((d) => ({ hash: d.hash, label: d.label }));
}

function getModKeyByPlain(key) {
  if (!key) return null;
  const h = hashKey(key);
  return modKeys.find((k) => k.hash === h) || null;
}

// Resolves a plaintext key to a role. Dev outranks mod.
function validateKey(key) {
  const dk = getDevKey(key);
  if (dk) return { role: "dev", label: dk.label, hash: dk.hash };
  const mk = getModKeyByPlain(key);
  if (mk) return { role: "mod", label: mk.label, hash: mk.hash };
  return { role: null, label: null, hash: null };
}

// Generates a new mod key. Only the hash is stored; the plaintext is returned
// once for the dev to hand off and is never persisted.
async function grantModKey(label) {
  const key = "mk_" + crypto.randomBytes(24).toString("hex");
  const entry = {
    hash: hashKey(key),
    label: String(label || "mod")
      .trim()
      .slice(0, 40) || "mod",
  };
  modKeys.push(entry);
  await saveModKeys();
  return { key, hash: entry.hash, label: entry.label };
}

async function revokeModKey(hash) {
  const before = modKeys.length;
  modKeys = modKeys.filter((k) => k.hash !== hash);
  if (modKeys.length === before) return false;
  await saveModKeys();
  return true;
}

// Hashes only — safe to send to the dev panel.
function listModKeys() {
  return modKeys.map((k) => ({ hash: k.hash, label: k.label }));
}

// Appends one audit line. Best-effort; failures are logged but never throw.
function modLog({ label, action, target, room } = {}) {
  const line =
    [
      new Date().toISOString(),
      label || "?",
      action || "?",
      target != null ? String(target) : "-",
      room != null ? String(room) : "-",
    ].join(" | ") + "\n";
  fsp
    .appendFile(MODLOG_PATH, line)
    .catch((e) => console.error("modlog append failed:", e));
}

loadModKeys();
loadDevKeys();

module.exports = {
  hashKey,
  loadModKeys,
  saveModKeys,
  loadDevKeys,
  getDevKey,
  isDevKey,
  listDevKeys,
  getModKeyByPlain,
  validateKey,
  grantModKey,
  revokeModKey,
  listModKeys,
  modLog,
};
