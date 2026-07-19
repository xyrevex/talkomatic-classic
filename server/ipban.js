// server/ipban.js
// IP-range ban matching. The blocklist (state.blockedIPs) is keyed by a string:
// either an exact address ("1.2.3.4", "2001:db8::1") or a CIDR range
// ("2001:db8:1:2::/64"). Range keys exist so an IPv6 client that rotates its
// address within its /64 cannot trivially evade a ban. IPv4 is always banned as
// a single address (a /24 would be far too much collateral behind CGNAT), so we
// only ever auto-compute IPv6 ranges.
//
// Everything here is defensive: any parse failure resolves to "no match" / null
// rather than throwing, so a malformed key or address can never crash the
// connection path.

const ipaddr = require("ipaddr.js");
const { state } = require("./state");

const DEFAULT_IPV6_PREFIX = 64;

function isRangeKey(key) {
  return typeof key === "string" && key.indexOf("/") !== -1;
}

// True while the block has not expired. Tolerates the legacy shape where the
// stored value is a bare expiry number instead of a { expiry, ... } object.
function isActiveBlock(b) {
  const expiry = b && typeof b === "object" ? b.expiry : b;
  return (
    !!b &&
    (!expiry || expiry === Number.MAX_SAFE_INTEGER || Date.now() < expiry)
  );
}

// Given an address, return the CIDR string of the range we'd ban to catch
// rotation, or null if the address should be banned as a single IP. Only real
// (non IPv4-mapped) IPv6 addresses get a range; IPv4 returns null.
function computeRangeCidr(ip, prefix = DEFAULT_IPV6_PREFIX) {
  try {
    const addr = ipaddr.parse(String(ip));
    if (addr.kind() !== "ipv6" || addr.isIPv4MappedAddress()) return null;
    const bytes = addr.toByteArray(); // 16 bytes, most-significant first
    const keepBytes = Math.floor(prefix / 8);
    for (let i = keepBytes; i < bytes.length; i++) bytes[i] = 0;
    // (prefix is a whole number of bytes for /64, so no partial-byte masking)
    const network = ipaddr.fromByteArray(bytes);
    return `${network.toString()}/${prefix}`;
  } catch (_) {
    return null;
  }
}

// Is `ip` inside the CIDR range `cidr`?
function ipInCidr(ip, cidr) {
  try {
    let addr = ipaddr.parse(String(ip));
    const [range, bits] = ipaddr.parseCIDR(String(cidr));
    if (addr.kind() !== range.kind()) {
      // An IPv4-mapped IPv6 client is logically IPv4; normalize so it can match
      // an IPv4 range. We don't create IPv4 ranges today, but stay correct.
      if (
        addr.kind() === "ipv6" &&
        addr.isIPv4MappedAddress() &&
        range.kind() === "ipv4"
      ) {
        addr = addr.toIPv4Address();
      } else {
        return false;
      }
    }
    return addr.match(range, bits);
  } catch (_) {
    return false;
  }
}

// Does an address match a blocklist key (exact or range)?
function matchesKey(ip, key) {
  return isRangeKey(key) ? ipInCidr(ip, key) : ip === key;
}

// The active block covering `ip`, or null. Checks the exact address first (the
// fast path and the only path for IPv4), then any CIDR range that contains it.
// Returns { key, block } so callers can act on the underlying entry.
function findActiveBlock(ip) {
  if (!ip) return null;
  const exact = state.blockedIPs.get(ip);
  if (exact !== undefined && isActiveBlock(exact)) {
    return { key: ip, block: exact };
  }
  for (const [key, b] of state.blockedIPs) {
    if (!isRangeKey(key)) continue;
    if (!isActiveBlock(b)) continue;
    if (ipInCidr(ip, key)) return { key, block: b };
  }
  return null;
}

// Convenience: is this address blocked right now?
function isBlocked(ip) {
  return findActiveBlock(ip) !== null;
}

// A bare, valid IPv4 or IPv6 address? Rejects CIDR text ("1.2.3.4/24"), so a
// typed range is refused and ranges stay opt-in via the checkbox.
function isValidIp(ip) {
  try {
    return ipaddr.isValid(String(ip));
  } catch (_) {
    return false;
  }
}

// Canonical form of a typed address so the stored key matches socket.clientIp
// (which is already canonical). Returns null on anything unparseable.
function normalizeIp(ip) {
  try {
    return ipaddr.parse(String(ip)).toString();
  } catch (_) {
    return null;
  }
}

// Remove every block that applies to `ip`: the exact entry plus any CIDR range
// that contains it. Used when a ban is lifted (e.g. a granted appeal) so a
// range-banned user is actually let back in instead of silently staying blocked
// because only their exact address was deleted. Returns the removed keys.
function removeBlocksForIp(ip) {
  const removed = [];
  if (!ip) return removed;
  if (state.blockedIPs.delete(ip)) removed.push(ip);
  for (const key of [...state.blockedIPs.keys()]) {
    if (isRangeKey(key) && ipInCidr(ip, key)) {
      state.blockedIPs.delete(key);
      removed.push(key);
    }
  }
  return removed;
}

module.exports = {
  DEFAULT_IPV6_PREFIX,
  isRangeKey,
  isActiveBlock,
  computeRangeCidr,
  ipInCidr,
  matchesKey,
  findActiveBlock,
  isBlocked,
  isValidIp,
  normalizeIp,
  removeBlocksForIp,
};
