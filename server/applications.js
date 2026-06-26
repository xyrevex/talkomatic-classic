// server/applications.js
// Moderator-application store. Active members apply to become a (junior) mod;
// a dev or full mod reviews and approves. Approval grants an L1 key - delivered
// to the applicant immediately if they're online, otherwise claimed on their
// next connect (the key is minted at delivery, so no plaintext is ever stored).
//
// Persisted to mod-applications.json the same way as the other JSON stores
// (atomic tmp + rename, debounced), capped and never committed.

const path = require("path");
const fs = require("fs");
const fsp = require("fs").promises;

const APPS_PATH = path.join(__dirname, "..", "mod-applications.json");
const MAX = 1000;

// { id, deviceId, ip, username, answers, submittedAt, status, reviewedBy,
//   reviewedAt, reason, claimed }
let apps = [];
let seq = 0;
let saveTimer = null;

function load() {
  try {
    const arr = JSON.parse(fs.readFileSync(APPS_PATH, "utf8"));
    apps = Array.isArray(arr) ? arr : [];
    seq = apps.reduce((m, a) => Math.max(m, a.id || 0), 0);
  } catch (err) {
    if (err.code !== "ENOENT")
      console.error("Error loading mod-applications.json:", err);
    apps = [];
  }
}

function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      if (apps.length > MAX) apps = apps.slice(-MAX);
      const tmp = APPS_PATH + ".tmp";
      await fsp.writeFile(tmp, JSON.stringify(apps, null, 2), "utf8");
      await fsp.rename(tmp, APPS_PATH);
    } catch (e) {
      console.error("mod-applications save failed:", e);
    }
  }, 3000);
}

function pendingForDevice(deviceId) {
  return apps.find((a) => a.deviceId === deviceId && a.status === "pending");
}

function submit({ deviceId, ip, username, answers }) {
  if (!deviceId) return { ok: false, error: "This browser can't be identified." };
  if (pendingForDevice(deviceId))
    return { ok: false, error: "You already have an application pending." };
  const app = {
    id: ++seq,
    deviceId,
    ip: ip || null,
    username: username || null,
    answers: answers || {},
    submittedAt: Date.now(),
    status: "pending",
    reviewedBy: null,
    reviewedAt: null,
    reason: null,
    claimed: false,
  };
  apps.push(app);
  if (apps.length > MAX) apps = apps.slice(-MAX);
  saveSoon();
  return { ok: true, id: app.id };
}

function get(id) {
  return apps.find((a) => a.id === id) || null;
}

function setStatus(id, status, reviewedBy, reason) {
  const a = get(id);
  if (!a) return null;
  a.status = status;
  a.reviewedBy = reviewedBy || null;
  a.reviewedAt = Date.now();
  a.reason = reason || null;
  saveSoon();
  return a;
}

function unclaimedApproved(deviceId) {
  return apps.find(
    (a) => a.deviceId === deviceId && a.status === "approved" && !a.claimed,
  );
}

// The most recent application from a device, whatever its status. Powers the
// lobby "Check status" link so an applicant can see pending / approved /
// rejected and any note the reviewer left.
function latestForDevice(deviceId) {
  if (!deviceId) return null;
  let best = null;
  for (const a of apps)
    if (a.deviceId === deviceId && (!best || (a.id || 0) > (best.id || 0)))
      best = a;
  return best;
}

function markClaimed(id) {
  const a = get(id);
  if (a) {
    a.claimed = true;
    saveSoon();
  }
}

function pendingCount() {
  return apps.reduce((n, a) => n + (a.status === "pending" ? 1 : 0), 0);
}

// Newest first. The caller decides whether to include the IP (dev-only).
function list() {
  return apps.slice().sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));
}

// Synchronous write for a clean shutdown (survives the debounce window).
function flushSync() {
  try {
    if (apps.length > MAX) apps = apps.slice(-MAX);
    const tmp = APPS_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(apps, null, 2), "utf8");
    fs.renameSync(tmp, APPS_PATH);
  } catch (e) {
    console.error("applications flush failed:", e);
  }
}

load();

module.exports = {
  submit,
  get,
  setStatus,
  unclaimedApproved,
  latestForDevice,
  markClaimed,
  pendingForDevice,
  pendingCount,
  list,
  flushSync,
};
