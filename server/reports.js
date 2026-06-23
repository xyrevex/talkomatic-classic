// server/reports.js
// In-memory tally of user reports so staff can see how many distinct people
// reported someone, and why. Not persisted (resets on restart by design); the
// individual reports also flow into the audit feed for the permanent record.
// "distinct" counts unique reporters by device, so one person spamming the
// report button cannot inflate the number.

const WINDOW_MS = 24 * 60 * 60 * 1000; // keep a target's reports for 24h
const MAX_TARGETS = 5000;
const MAX_PER_TARGET = 100;

const byTarget = new Map(); // targetKey -> [{ byDeviceId, byName, category, reason, at }]

function prune(now) {
  for (const [k, arr] of byTarget) {
    const fresh = arr.filter((r) => now - r.at <= WINDOW_MS);
    if (fresh.length) byTarget.set(k, fresh);
    else byTarget.delete(k);
  }
  if (byTarget.size > MAX_TARGETS) {
    const keys = [...byTarget.keys()];
    for (let i = 0; i < keys.length - MAX_TARGETS; i++) byTarget.delete(keys[i]);
  }
}

function distinctReporters(list) {
  const ids = new Set();
  let anon = 0;
  for (const r of list) {
    if (r.byDeviceId) ids.add(r.byDeviceId);
    else anon++;
  }
  return ids.size + (anon > 0 ? 1 : 0);
}

// Record a report and return { total, distinct } for the target.
function add({ targetKey, targetName, byDeviceId, byName, category, reason }) {
  if (!targetKey) return { total: 0, distinct: 0 };
  const now = Date.now();
  let arr = byTarget.get(targetKey);
  if (!arr) {
    arr = [];
    byTarget.set(targetKey, arr);
  }
  arr.push({
    targetName: targetName || null,
    byDeviceId: byDeviceId || null,
    byName: byName || null,
    category: category || "other",
    reason: reason || null,
    at: now,
  });
  if (arr.length > MAX_PER_TARGET) arr.splice(0, arr.length - MAX_PER_TARGET);
  prune(now);
  const list = byTarget.get(targetKey) || [];
  return { total: list.length, distinct: distinctReporters(list) };
}

// All recent reports against one target (for a dashboard drill-down).
function forTarget(targetKey) {
  return (byTarget.get(targetKey) || []).slice();
}

// Drop every report against one target (staff discarded it as false/handled).
function clear(targetKey) {
  return byTarget.delete(targetKey);
}

// Compact per-target summary, most-reported first (for a dashboard view).
function summary() {
  const out = [];
  for (const [targetKey, arr] of byTarget) {
    const cats = {};
    for (const r of arr) cats[r.category] = (cats[r.category] || 0) + 1;
    out.push({
      targetKey,
      name: arr.length ? arr[arr.length - 1].targetName : null,
      total: arr.length,
      distinct: distinctReporters(arr),
      categories: cats,
      last: arr.length ? arr[arr.length - 1].at : 0,
    });
  }
  return out.sort((a, b) => b.distinct - a.distinct || b.total - a.total);
}

module.exports = { add, forTarget, summary, clear };
