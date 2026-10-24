// Shared helpers: POSIX path handling, SHA-256, password hashing, date formatting.
// Pure JS, no DOM / Node APIs, so it works in the browser and in the Node test runner.

// ---------------------------------------------------------------- paths
export const posix = {
  normalize(p, cwd = '/') {
    if (p === '' || p == null) p = '.';
    if (!p.startsWith('/')) p = (cwd.endsWith('/') ? cwd : cwd + '/') + p;
    const out = [];
    for (const part of p.split('/')) {
      if (part === '' || part === '.') continue;
      if (part === '..') out.pop();
      else out.push(part);
    }
    return '/' + out.join('/');
  },
  split(p) {
    return p.split('/').filter(Boolean);
  },
  dirname(p) {
    if (p === '/' || p === '') return '/';
    const t = p.replace(/\/+$/, '');
    const i = t.lastIndexOf('/');
    if (i < 0) return '.';
    return i === 0 ? '/' : t.slice(0, i);
  },
  basename(p) {
    if (p === '/') return '/';
    const t = p.replace(/\/+$/, '');
    return t.slice(t.lastIndexOf('/') + 1);
  },
  join(...parts) {
    return parts.filter((x) => x !== '').join('/').replace(/\/+/g, '/');
  },
  extname(p) {
    const b = posix.basename(p);
    const i = b.lastIndexOf('.');
    return i <= 0 ? '' : b.slice(i);
  },
};

// ---------------------------------------------------------------- SHA-256 (sync)
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function utf8Bytes(str) {
  const out = [];
  for (const ch of str) {
    let c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

/** SHA-256 of a byte array / string; returns Uint8Array(32). */
export function sha256(input) {
  const bytes = typeof input === 'string' ? utf8Bytes(input) : Array.from(input);
  const l = bytes.length;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const bitLenHi = Math.floor((l * 8) / 0x100000000);
  const bitLenLo = (l * 8) >>> 0;
  for (let i = 3; i >= 0; i--) bytes.push((bitLenHi >>> (i * 8)) & 255);
  for (let i = 3; i >= 0; i--) bytes.push((bitLenLo >>> (i * 8)) & 255);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = H[i] >>> 24; out[i * 4 + 1] = (H[i] >>> 16) & 255; out[i * 4 + 2] = (H[i] >>> 8) & 255; out[i * 4 + 3] = H[i] & 255;
  }
  return out;
}

export function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
export const sha256hex = (s) => hex(sha256(s));

/** Cheap, stable (non-crypto) MD5 stand-in is NOT provided; md5sum prints a SHA-256 truncated to 32 hex chars. */
export const md5ish = (s) => sha256hex('md5:' + s).slice(0, 32);

// ---------------------------------------------------------------- password hashing
// A simulation of crypt(3) yescrypt "$y$j9T$salt$hash" (the Mint 21 / Ubuntu 22.04 default). Not cryptographically meaningful, but deterministic,
// salted and verifiable, which is all the simulator needs.
const B64 = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const hashCache = new Map();

export function randomSalt(len = 22, rnd = Math.random) {
  let s = '';
  for (let i = 0; i < len; i++) s += B64[Math.floor(rnd() * 64)];
  return s;
}

export function hashPassword(password, salt = randomSalt()) {
  const key = salt + '\u0000' + password;
  const cached = hashCache.get(key);
  if (cached) return cached;
  let d = sha256(`${salt}$${password}`);
  for (let i = 0; i < 64; i++) d = sha256([...d, ...utf8Bytes(salt), ...utf8Bytes(password)]);
  let bits = '';
  for (const b of d) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < 43; i++) out += B64[parseInt(bits.slice(i * 6, i * 6 + 6).padEnd(6, '0'), 2)];
  const res = `$y$j9T$${salt}$${out}`;
  hashCache.set(key, res);
  return res;
}

export function verifyPassword(password, hash) {
  if (typeof hash !== 'string') return false;
  const m = /^\$y\$j9T\$([^$]+)\$/.exec(hash);
  if (!m) return false;
  return hashPassword(password, m[1]) === hash;
}

// ---------------------------------------------------------------- misc formatting
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad2 = (n) => String(n).padStart(2, '0');

export function tzAbbrev(ms) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(new Date(ms));
    return parts.find((p) => p.type === 'timeZoneName')?.value || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** `ls -l` style: "Oct 22 21:05" for recent files, "Oct 22  2025" for old ones. */
export function fmtLsDate(ms, now) {
  const d = new Date(ms);
  const day = String(d.getDate()).padStart(2, ' ');
  const sixMonths = 182 * 86400000;
  if (Math.abs(now - ms) > sixMonths) return `${MONTHS[d.getMonth()]} ${day}  ${d.getFullYear()}`;
  return `${MONTHS[d.getMonth()]} ${day} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** `date` default format with en_US locale (12-hour clock). */
export function fmtDate(ms) {
  const d = new Date(ms);
  const h = d.getHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, ' ')} ${pad2(h12)}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ${h < 12 ? 'AM' : 'PM'} ${tzAbbrev(ms)} ${d.getFullYear()}`;
}

export function fmtIso(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function fmtSyslog(ms) {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, ' ')} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** Days since the epoch, as used by /etc/shadow's lastchg field. */
export const daysSinceEpoch = (ms) => Math.floor(ms / 86400000);

export function modeToString(mode, type = 'f') {
  const t = type === 'd' ? 'd' : type === 'l' ? 'l' : '-';
  const bits = 'rwxrwxrwx';
  let s = '';
  for (let i = 0; i < 9; i++) s += mode & (1 << (8 - i)) ? bits[i] : '-';
  const chars = s.split('');
  if (mode & 0o4000) chars[2] = chars[2] === 'x' ? 's' : 'S';
  if (mode & 0o2000) chars[5] = chars[5] === 'x' ? 's' : 'S';
  if (mode & 0o1000) chars[8] = chars[8] === 'x' ? 't' : 'T';
  return t + chars.join('');
}

export function humanSize(n, si = false) {
  const base = si ? 1000 : 1024;
  if (n < base) return String(n);
  const units = ['K', 'M', 'G', 'T'];
  let v = n;
  let i = -1;
  do { v /= base; i++; } while (v >= base && i < units.length - 1);
  return (v < 10 ? (Math.ceil(v * 10) / 10).toFixed(1) : String(Math.ceil(v))) + units[i];
}

/** Compare two Debian version strings (simplified dpkg algorithm). Returns -1, 0, 1. */
export function compareVersions(a, b) {
  const split = (v) => {
    let epoch = 0;
    let rest = v;
    const e = /^(\d+):(.*)$/.exec(v);
    if (e) { epoch = Number(e[1]); rest = e[2]; }
    return [epoch, rest];
  };
  const order = (c) => {
    if (c === '~') return -1;
    if (c === undefined || c === '') return 0;
    if (/[A-Za-z]/.test(c)) return c.charCodeAt(0);
    return c.charCodeAt(0) + 256;
  };
  const cmpPart = (x, y) => {
    let i = 0, j = 0;
    while (i < x.length || j < y.length) {
      while ((i < x.length && !/\d/.test(x[i])) || (j < y.length && !/\d/.test(y[j]))) {
        const ca = order(i < x.length && !/\d/.test(x[i]) ? x[i] : undefined);
        const cb = order(j < y.length && !/\d/.test(y[j]) ? y[j] : undefined);
        if (ca !== cb) return ca < cb ? -1 : 1;
        if (i < x.length && !/\d/.test(x[i])) i++;
        if (j < y.length && !/\d/.test(y[j])) j++;
        if (i >= x.length && j >= y.length) break;
      }
      let n1 = '', n2 = '';
      while (i < x.length && /\d/.test(x[i])) n1 += x[i++];
      while (j < y.length && /\d/.test(y[j])) n2 += y[j++];
      const d1 = n1 === '' ? 0 : Number(n1), d2 = n2 === '' ? 0 : Number(n2);
      if (d1 !== d2) return d1 < d2 ? -1 : 1;
    }
    return 0;
  };
  const [ea, ra] = split(a);
  const [eb, rb] = split(b);
  if (ea !== eb) return ea < eb ? -1 : 1;
  return cmpPart(ra, rb);
}

/** Tiny glob matcher used for both file globbing and `find -name`. Supports * ? [...] */
export function globToRegex(glob, { dot = true } = {}) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') re += '.*';
    else if (c === '?') re += '.';
    else if (c === '[') {
      const j = glob.indexOf(']', i + 2);
      if (j < 0) { re += '\\['; continue; }
      let cls = glob.slice(i + 1, j);
      if (cls[0] === '!') cls = '^' + cls.slice(1);
      re += '[' + cls.replace(/\\/g, '\\\\') + ']';
      i = j;
    } else if (c === '\\' && i + 1 < glob.length) { re += '\\' + glob[++i]; }
    else re += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  void dot;
  return new RegExp('^' + re + '$');
}

export function deepClone(o) {
  return o === undefined ? undefined : JSON.parse(JSON.stringify(o));
}
