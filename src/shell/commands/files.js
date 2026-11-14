// File and directory commands: ls, mkdir, rm, cp, mv, touch, ln, chmod, chown, chgrp, stat, file, find, du, df, ...
import { cmd, parseOpts, usageError } from '../registry.js';
import { FsError } from '../../core/vfs.js';
import { posix, modeToString, humanSize, fmtLsDate, fmtIso, tzAbbrev, globToRegex } from '../../core/util.js';
import * as users from '../../core/users.js';

// ---------------------------------------------------------------- shared helpers
export function idMaps(sys) {
  const u = new Map(); const g = new Map();
  try { for (const x of users.readPasswd(sys)) if (!u.has(x.uid)) u.set(x.uid, x.name); } catch { /* no passwd */ }
  try { for (const x of users.readGroups(sys)) if (!g.has(x.gid)) g.set(x.gid, x.name); } catch { /* no group */ }
  return { uname: (id) => u.get(id) ?? String(id), gname: (id) => g.get(id) ?? String(id) };
}

const EXT_COLOR = {};
for (const e of ['tar', 'tgz', 'gz', 'bz2', 'xz', 'zip', 'deb', 'rpm', '7z', 'rar', 'zst', 'jar', 'iso']) EXT_COLOR[e] = '01;31';
for (const e of ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'tif', 'tiff', 'webp', 'mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'mpg', 'mpeg']) EXT_COLOR[e] = '01;35';
for (const e of ['mp3', 'ogg', 'wav', 'flac', 'aac', 'm4a', 'opus', 'oga']) EXT_COLOR[e] = '00;36';

/** LS_COLORS-compatible colour for a name given its lstat result. */
export function lsColor(name, st) {
  if (st.t === 'l') return '01;36';
  if (st.t === 'd') {
    const sticky = st.mode & 0o1000; const ow = st.mode & 0o002;
    if (sticky && ow) return '30;42';
    if (ow) return '34;42';
    if (sticky) return '37;44';
    return '01;34';
  }
  if (st.mode & 0o4000) return '37;41';
  if (st.mode & 0o2000) return '30;43';
  if (st.mode & 0o111) return '01;32';
  const dot = name.lastIndexOf('.');
  if (dot > 0) { const c = EXT_COLOR[name.slice(dot + 1).toLowerCase()]; if (c) return c; }
  return null;
}
const paint = (s, c) => (c ? `\u001b[${c}m${s}\u001b[0m` : s);

/** Sort key approximating glibc en_US.UTF-8 collation: ignore case and punctuation. */
export const collKey = (n) => n.replace(/[^A-Za-z0-9\u00c0-\uffff]/g, '').toLowerCase();
export function collate(a, b) {
  const ka = collKey(a); const kb = collKey(b);
  if (ka < kb) return -1;
  if (ka > kb) return 1;
  const la = a.toLowerCase(); const lb = b.toLowerCase();
  if (la < lb) return -1;
  if (la > lb) return 1;
  // lowercase sorts before uppercase for equal letters
  return a < b ? 1 : a > b ? -1 : 0;
}

const quoteName = (n) => (/[\s'"\\$`!&;|<>()*?\[\]{}~#]/.test(n) ? (n.includes("'") ? `"${n}"` : `'${n}'`) : n);

function blocksOf(st) { return st.t === 'd' ? 4 : Math.ceil(st.size / 4096) * 4; }

// ---------------------------------------------------------------- ls
cmd('ls', (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, {
    bool: 'aAlh1dRtrSFisCxnLpGUvXbQkf',
    long: {
      all: 'a', 'almost-all': 'A', 'human-readable': 'h', directory: 'd', recursive: 'R', reverse: 'r', classify: 'F', inode: 'i', size: 's', 'dereference': 'L',
      color: { key: 'color', val: true, optional: true }, 'group-directories-first': 'gdf', 'time-style': { key: 'timestyle', val: true }, 'full-time': 'fulltime',
      'no-group': 'G', numeric: 'n', 'hide-control-chars': 'q', literal: 'N', 'file-type': 'ft', 'author': 'author', sort: { key: 'sort', val: true }, 'si': 'si',
    },
  });
  if (err) return usageError(ctx, err);
  const fs = ctx.fs;
  const { uname, gname } = idMaps(ctx.sys);
  const now = ctx.sys.now();
  const colorOn = o.color === 'always' || o.color === 'yes' || o.color === 'force' || ((o.color === true || o.color === 'auto' || o.color === 'tty' || o.color === 'if-tty') && ctx.tty);
  const long = !!(o.l || o.n || o.fulltime);
  const showAll = o.a || o.f;
  const readLink = (p) => { try { return fs.readlink(p); } catch { return ''; } };

  const statOf = (abs, follow) => (follow ? fs.stat(abs) : fs.lstat(abs));
  const mk = (name, abs, follow = false) => {
    let st;
    try { st = statOf(abs, follow); } catch (e) {
      if (follow && e instanceof FsError) { try { st = fs.lstat(abs); } catch (e2) { throw e2; } } else throw e;
    }
    return { name, abs, st };
  };

  const sortEntries = (list) => {
    const cmpName = (a, b) => collate(a.name, b.name);
    let f = cmpName;
    const key = o.sort || (o.S ? 'size' : o.t ? 'time' : o.X ? 'extension' : o.U ? 'none' : 'name');
    if (key === 'size') f = (a, b) => b.st.size - a.st.size || cmpName(a, b);
    else if (key === 'time') f = (a, b) => b.st.mtime - a.st.mtime || cmpName(a, b);
    else if (key === 'extension') f = (a, b) => collate(posix.extname(a.name), posix.extname(b.name)) || cmpName(a, b);
    else if (key === 'none') f = () => 0;
    else if (key === 'version') f = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
    let out = [...list].sort(f);
    if (o.r) out.reverse();
    if (o.gdf) out = [...out.filter((e) => e.st.t === 'd'), ...out.filter((e) => e.st.t !== 'd')];
    return out;
  };

  const suffix = (e) => {
    if (!(o.F || o.p || o.ft)) return '';
    if (e.st.t === 'd') return '/';
    if (o.p) return '';
    if (e.st.t === 'l') return o.ft ? '@' : '@';
    if (!o.ft && (e.st.mode & 0o111)) return '*';
    return '';
  };

  const display = (e) => {
    let n = o.Q ? `"${e.name}"` : (o.N || o.b || !ctx.tty ? e.name : quoteName(e.name));
    if (o.Q || o.N) { /* literal */ } else if (!ctx.tty && !o.l) n = e.name;
    if (o.l && !ctx.tty) n = e.name;
    const col = colorOn ? lsColor(e.name, e.st) : null;
    let s = paint(n, col) + suffix(e);
    if (long && e.st.t === 'l' && !o.L) {
      const tgt = readLink(e.abs);
      let tcol = null;
      if (colorOn) { try { tcol = lsColor(posix.basename(tgt), fs.stat(posix.normalize(tgt, posix.dirname(e.abs)))); } catch { tcol = '01;31'; } }
      s += ' -> ' + paint(tgt, tcol);
    }
    return s;
  };
  const visLen = (s) => s.replace(/\u001b\[[0-9;]*m/g, '').length;

  const timeStr = (ms) => {
    if (o.fulltime || o.timestyle === 'full-iso') { const d = new Date(ms); const p = (n, w = 2) => String(n).padStart(w, '0'); return `${fmtIso(ms)}.${p(d.getMilliseconds(), 3)}000000 ${tzOffset(ms)}`; }
    if (o.timestyle === 'long-iso') return fmtIso(ms).slice(0, 16);
    if (o.timestyle === 'iso') return fmtLsDate(ms, now).replace(/^(\w+)\s+(\d+)\s+(.*)$/, (m, mo, d, r) => `${String(new Date(ms).getMonth() + 1).padStart(2, '0')}-${d.padStart(2, '0')} ${r.includes(':') ? r : r.trim() + '  '}`);
    return fmtLsDate(ms, now);
  };

  const emit = (entries, { header = null } = {}) => {
    if (header) ctx.out(header + '\n');
    if (long) {
      const rows = entries.map((e) => {
        const st = e.st;
        const sz = o.h ? humanSize(st.size, o.si) : String(st.size);
        return {
          ino: String(st.ino), blk: String(blocksOf(st)),
          perm: modeToString(st.mode, st.t), nl: String(st.nlink),
          user: o.n ? String(st.uid) : uname(st.uid), group: o.n ? String(st.gid) : gname(st.gid), size: sz, date: timeStr(st.mtime), text: display(e),
        };
      });
      const w = (k) => Math.max(0, ...rows.map((r) => r[k].length));
      if (header !== null || entries.listing) ctx.out(`total ${entries.reduce((a, e) => a + blocksOf(e.st), 0)}\n`);
      const wi = w('ino'); const wb = w('blk'); const wn = w('nl'); const wu = w('user'); const wg = w('group'); const ws = w('size');
      for (const r of rows) {
        ctx.out(`${o.i ? r.ino.padStart(wi) + ' ' : ''}${o.s ? r.blk.padStart(wb) + ' ' : ''}${r.perm} ${r.nl.padStart(wn)} ${r.user.padEnd(wu)} ${o.G ? '' : r.group.padEnd(wg) + ' '}${r.size.padStart(ws)} ${r.date} ${r.text}\n`);
      }
      return;
    }
    const cells = entries.map((e) => (o.i ? `${e.st.ino} ` : '') + (o.s ? `${blocksOf(e.st)} ` : '') + display(e));
    if (o['1'] || !ctx.tty || o.C === undefined && o.x === undefined && !ctx.tty) { for (const c of cells) ctx.out(c + '\n'); return; }
    if (!cells.length) return;
    const width = ctx.cols || 80;
    const lens = cells.map(visLen);
    // find the largest number of columns that fits (column-major, two-space gutters)
    let best = 1; let widths = [Math.max(...lens)];
    for (let cols = Math.min(cells.length, Math.floor(width / 3) || 1); cols >= 1; cols--) {
      const rowsN = Math.ceil(cells.length / cols);
      const ws = [];
      let total = 0;
      for (let c = 0; c < cols; c++) {
        let m = 0;
        for (let r = 0; r < rowsN; r++) { const idx = o.x ? r * cols + c : c * rowsN + r; if (idx < cells.length) m = Math.max(m, lens[idx]); }
        ws.push(m); total += m + (c ? 2 : 0);
      }
      if (total <= width) { best = cols; widths = ws; break; }
    }
    const rowsN = Math.ceil(cells.length / best);
    for (let r = 0; r < rowsN; r++) {
      let line = '';
      for (let c = 0; c < best; c++) {
        const idx = o.x ? r * best + c : c * rowsN + r;
        if (idx >= cells.length) continue;
        const last = (o.x ? idx + 1 >= cells.length || c === best - 1 : c * rowsN + r + rowsN >= cells.length || c === best - 1);
        line += last ? cells[idx] : cells[idx] + ' '.repeat(widths[c] - lens[idx] + 2);
      }
      ctx.out(line.replace(/\s+$/, (m) => (visLen(line) === line.length ? '' : m)) + '\n');
    }
  };

  let rc = 0;
  const targets = rest.length ? rest : ['.'];
  const files = []; const dirs = [];
  for (const t of targets) {
    const abs = ctx.resolve(t);
    try {
      const follow = o.L || (!long && !o.d && !o.F ? true : false);
      let e;
      if (!o.d && !o.L) {
        // ls follows a symlink given on the command line when it points to a directory (unless -l / -F / -d)
        const l = fs.lstat(abs);
        if (l.t === 'l' && !long && !o.F) { try { const s = fs.stat(abs); e = { name: t, abs, st: s }; } catch { e = { name: t, abs, st: l }; } }
        else e = { name: t, abs, st: l };
      } else e = mk(t, abs, follow && !o.d);
      if (e.st.t === 'd' && !o.d) dirs.push(e); else files.push(e);
    } catch (e) {
      if (e instanceof FsError) { ctx.err(`ls: cannot access '${t}': ${e.text}\n`); rc = 2; } else throw e;
    }
  }
  const listDir = (d, top, prefix) => {
    let names;
    try { names = fs.readdir(d.abs); } catch (e) {
      if (e instanceof FsError) { ctx.err(`ls: cannot open directory '${d.name}': ${e.text}\n`); rc = 2; return; }
      throw e;
    }
    const entries = [];
    const raw = showAll ? ['.', '..', ...names] : o.A ? names : names;
    for (const n of raw) {
      if (n.startsWith('.') && !showAll && !o.A) continue;
      if (!o.a && !o.f && o.A && (n === '.' || n === '..')) continue;
      const abs = n === '.' ? d.abs : n === '..' ? posix.dirname(d.abs) : posix.join(d.abs, n);
      try { entries.push({ name: n, abs, st: o.L ? fs.stat(abs) : fs.lstat(abs) }); } catch (e) {
        if (e instanceof FsError) { try { entries.push({ name: n, abs, st: fs.lstat(abs) }); } catch { ctx.err(`ls: cannot access '${posix.join(d.name, n)}': ${e.text}\n`); rc = 2; } } else throw e;
      }
    }
    const sorted = sortEntries(entries);
    sorted.listing = true;
    emit(sorted, { header: prefix });
    if (o.R) {
      for (const e of sorted) {
        if (e.st.t === 'd' && e.name !== '.' && e.name !== '..') {
          const nm = posix.join(d.name, e.name).replace(/^\.\//, d.name === '.' ? '' : './');
          ctx.out('\n');
          listDir({ name: d.name === '.' ? `./${e.name}` : `${d.name}/${e.name}`, abs: e.abs }, false, `${d.name === '.' ? './' + e.name : d.name + '/' + e.name}:`);
          void nm;
        }
      }
    }
  };
  if (files.length) { emit(sortEntries(files)); }
  const multi = dirs.length + files.length > 1 || o.R;
  const sortedDirs = sortEntries(dirs);
  sortedDirs.forEach((d, i) => {
    if (i > 0 || files.length) ctx.out('\n');
    listDir(d, true, multi ? `${d.name}:` : null);
  });
  return rc;
}, { usage: 'ls [OPTION]... [FILE]...' });

function tzOffset(ms) {
  const m = -new Date(ms).getTimezoneOffset();
  const s = m < 0 ? '-' : '+';
  const a = Math.abs(m);
  return `${s}${String(Math.floor(a / 60)).padStart(2, '0')}${String(a % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- mkdir / rmdir
const octalMode = (s) => (/^[0-7]{1,4}$/.test(s) ? parseInt(s, 8) : null);

cmd('mkdir', (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'pvZ', val: 'm', long: { parents: 'p', verbose: 'v', mode: { key: 'm', val: true } } });
  if (err) return usageError(ctx, err);
  if (!rest.length) { ctx.err("mkdir: missing operand\nTry 'mkdir --help' for more information.\n"); return 1; }
  let rc = 0;
  let mode;
  if (o.m != null) {
    mode = octalMode(o.m);
    if (mode == null) { const r = applyMode(0o777 & ~0o022, o.m, true); if (r == null) { ctx.err(`mkdir: invalid mode ‘${o.m}’\n`); return 1; } mode = r; }
  }
  for (const d of rest) {
    const abs = ctx.resolve(d);
    try {
      if (o.p) {
        const parts = posix.split(abs); let cur = '';
        for (const part of parts) {
          cur += '/' + part;
          if (ctx.sys.vfs.exists(cur)) { if (!ctx.sys.vfs.isDir(cur)) throw new FsError('ENOTDIR', d); continue; }
          ctx.fs.mkdir(cur, { mode: cur === abs ? mode ?? 0o755 : 0o755 });
          if (o.v) ctx.out(`mkdir: created directory '${cur === abs ? d : cur}'\n`);
        }
      } else {
        ctx.fs.mkdir(abs, { mode: mode ?? 0o755 });
        if (o.v) ctx.out(`mkdir: created directory '${d}'\n`);
      }
    } catch (e) {
      if (e instanceof FsError) { ctx.err(`mkdir: cannot create directory '${d}': ${e.text}\n`); rc = 1; } else throw e;
    }
  }
  return rc;
}, { usage: 'mkdir [OPTION]... DIRECTORY...' });

cmd('rmdir', (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'pv', long: { parents: 'p', verbose: 'v', 'ignore-fail-on-non-empty': 'i' } });
  if (err) return usageError(ctx, err);
  if (!rest.length) { ctx.err("rmdir: missing operand\nTry 'rmdir --help' for more information.\n"); return 1; }
  let rc = 0;
  for (const d of rest) {
    let abs = ctx.resolve(d);
    for (;;) {
      try { ctx.fs.rmdir(abs); if (o.v) ctx.out(`rmdir: removing directory, '${d}'\n`); } catch (e) {
        if (e instanceof FsError) { ctx.err(`rmdir: failed to remove '${d}': ${e.text}\n`); rc = 1; break; } throw e;
      }
      if (!o.p) break;
      abs = posix.dirname(abs);
      if (abs === '/') break;
    }
  }
  return rc;
});

// ---------------------------------------------------------------- touch
function parseTouchDate(s, now) {
  if (/^\d{8,12}(\.\d\d)?$/.test(s)) {
    const t = s.replace('.', '');
    let y; let rest;
    if (t.length === 12 || t.length === 14) { y = Number(t.slice(0, 4)); rest = t.slice(4); } else if (t.length === 10) { const yy = Number(t.slice(0, 2)); y = yy >= 69 ? 1900 + yy : 2000 + yy; rest = t.slice(2); } else { y = new Date(now).getFullYear(); rest = t; }
    const mo = Number(rest.slice(0, 2)) - 1; const d = Number(rest.slice(2, 4)); const h = Number(rest.slice(4, 6)); const mi = Number(rest.slice(6, 8)); const se = Number(rest.slice(8, 10) || 0);
    return new Date(y, mo, d, h, mi, se).getTime();
  }
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}

cmd('touch', (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'camf', val: 'dtr', long: { 'no-create': 'c', date: { key: 'd', val: true }, reference: { key: 'r', val: true } } });
  if (err) return usageError(ctx, err);
  if (!rest.length) { ctx.err("touch: missing file operand\nTry 'touch --help' for more information.\n"); return 1; }
  let mtime;
  if (o.d) { mtime = parseTouchDate(o.d, ctx.sys.now()); if (mtime == null) { ctx.err(`touch: invalid date format ‘${o.d}’\n`); return 1; } }
  if (o.t) { mtime = parseTouchDate(o.t, ctx.sys.now()); if (mtime == null) { ctx.err(`touch: invalid date format ‘${o.t}’\n`); return 1; } }
  if (o.r) { try { mtime = ctx.fs.stat(ctx.resolve(o.r)).mtime; } catch (e) { if (e instanceof FsError) { ctx.err(`touch: failed to get attributes of '${o.r}': ${e.text}\n`); return 1; } throw e; } }
  let rc = 0;
  for (const f of rest) {
    const abs = ctx.resolve(f);
    try {
      if (!ctx.fs.exists(abs)) {
        if (o.c) continue;
        ctx.fs.writeFile(abs, '', mtime != null ? { mtime } : {});
      } else ctx.fs.touch(abs, mtime != null ? { mtime } : {});
    } catch (e) {
      if (e instanceof FsError) { ctx.err(`touch: cannot touch '${f}': ${e.text}\n`); rc = 1; } else throw e;
    }
  }
  return rc;
}, { usage: 'touch [OPTION]... FILE...' });

// ---------------------------------------------------------------- rm
cmd('rm', async (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'rRfivdI', long: { recursive: 'r', force: 'f', verbose: 'v', interactive: 'i', dir: 'd', 'no-preserve-root': 'nopreserve', 'preserve-root': 'preserve', 'one-file-system': 'x' } });
  if (err) return usageError(ctx, err);
  const rec = o.r || o.R;
  if (!rest.length) { if (o.f) return 0; ctx.err("rm: missing operand\nTry 'rm --help' for more information.\n"); return 1; }
  let rc = 0;
  const fs = ctx.fs;
  const ask = async (q) => { const a = await ctx.term.readLine(q, { echo: true }); return a != null && /^y/i.test(a); };
  const kind = (st) => (st.t === 'd' ? 'directory' : st.t === 'l' ? 'symbolic link' : st.size === 0 ? 'regular empty file' : 'regular file');
  const del = async (abs, shown, top) => {
    let st;
    try { st = fs.lstat(abs); } catch (e) {
      if (e instanceof FsError) { if (!o.f || e.code !== 'ENOENT') { ctx.err(`rm: cannot remove '${shown}': ${e.text}\n`); rc = 1; } return false; } throw e;
    }
    if (st.t === 'd') {
      if (!rec && !o.d) { ctx.err(`rm: cannot remove '${shown}': Is a directory\n`); rc = 1; return false; }
      if (rec) {
        let names;
        try { names = fs.readdir(abs); } catch (e) {
          if (e instanceof FsError) { ctx.err(`rm: cannot remove '${shown}': ${e.text}\n`); rc = 1; return false; } throw e;
        }
        if (o.i && !(await ask(`rm: descend into directory '${shown}'? `))) return false;
        let all = true;
        for (const n of names) if (!(await del(posix.join(abs, n), `${shown.replace(/\/$/, '')}/${n}`, false))) all = false;
        if (!all) return false;
        if (o.i && !(await ask(`rm: remove directory '${shown}'? `))) return false;
      } else if (o.i && !(await ask(`rm: remove directory '${shown}'? `))) return false;
      try { fs.rmdir(abs); if (o.v) ctx.out(`removed directory '${shown}'\n`); return true; } catch (e) {
        if (e instanceof FsError) { ctx.err(`rm: cannot remove '${shown}': ${e.text}\n`); rc = 1; return false; } throw e;
      }
    }
    // write-protected prompt (not for root, not with -f)
    if (!o.f && st.t === 'f' && ctx.tty && ctx.cred.uid !== 0 && !o.i) {
      const w = ((st.uid === ctx.cred.uid ? st.mode >> 6 : ctx.cred.gids.includes(st.gid) ? st.mode >> 3 : st.mode) & 2) !== 0;
      if (!w) { if (!(await ask(`rm: remove write-protected ${kind(st)} '${shown}'? `))) return false; }
    }
    if (o.i && !(await ask(`rm: remove ${kind(st)} '${shown}'? `))) return false;
    try { fs.unlink(abs); if (o.v) ctx.out(`removed '${shown}'\n`); return true; } catch (e) {
      if (e instanceof FsError) { ctx.err(`rm: cannot remove '${shown}': ${e.text}\n`); rc = 1; return false; } throw e;
    }
  };
  for (const f of rest) {
    const abs = ctx.resolve(f);
    if (abs === '/' && rec && !o.nopreserve) { ctx.err("rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe\n"); rc = 1; continue; }
    if (f === '.' || f === '..' || f.endsWith('/.') || f.endsWith('/..')) { ctx.err(`rm: refusing to remove '.' or '..' directory: skipping '${f}'\n`); rc = 1; continue; }
    await del(abs, f, true);
  }
  return rc;
}, { usage: 'rm [OPTION]... [FILE]...' });

// ---------------------------------------------------------------- cp / mv
function destInfo(ctx, args, name) {
  // returns { sources, dest, destIsDir } or null after printing an error
  if (args.length < 2) {
    if (!args.length) ctx.err(`${name}: missing file operand\nTry '${name} --help' for more information.\n`);
    else ctx.err(`${name}: missing destination file operand after '${args[0]}'\nTry '${name} --help' for more information.\n`);
    return null;
  }
  const dest = args[args.length - 1];
  const sources = args.slice(0, -1);
  const destAbs = ctx.resolve(dest);
  let destIsDir = false;
  try { destIsDir = ctx.fs.isDir(destAbs); } catch { destIsDir = false; }
  if (sources.length > 1 && !destIsDir) { ctx.err(`${name}: target '${dest}' is not a directory\n`); return null; }
  return { sources, dest, destAbs, destIsDir };
}

cmd('cp', async (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'rRaplfivunTdPLH', val: 't', long: { recursive: 'r', archive: 'a', preserve: { key: 'p', val: true, optional: true }, force: 'f', interactive: 'i', verbose: 'v', update: 'u', 'no-clobber': 'n', 'no-target-directory': 'T', 'target-directory': { key: 't', val: true }, 'no-dereference': 'P', 'parents': 'parents' } });
  if (err) return usageError(ctx, err);
  const args = o.t ? [...rest, o.t] : rest;
  const info = destInfo(ctx, args, 'cp');
  if (!info) return 1;
  const rec = o.r || o.R || o.a;
  const preserve = o.a || o.p;
  let rc = 0;
  const fs = ctx.fs;
  for (const s of info.sources) {
    const sAbs = ctx.resolve(s);
    let st;
    try { st = fs.lstat(sAbs); } catch (e) {
      if (e instanceof FsError) { ctx.err(`cp: cannot stat '${s}': ${e.text}\n`); rc = 1; continue; } throw e;
    }
    if (st.t === 'l' && !(rec || o.P || o.a)) { try { st = fs.stat(sAbs); } catch { /* dangling */ } }
    if (st.t === 'd' && !rec) { ctx.err(`cp: -r not specified; omitting directory '${s}'\n`); rc = 1; continue; }
    const target = info.destIsDir && !o.T ? posix.join(info.destAbs, posix.basename(sAbs)) : info.destAbs;
    const shownTarget = info.destIsDir && !o.T ? `${info.dest.replace(/\/$/, '')}/${posix.basename(sAbs)}` : info.dest;
    if (sAbs === target) { ctx.err(`cp: '${s}' and '${shownTarget}' are the same file\n`); rc = 1; continue; }
    if (o.n && ctx.sys.vfs.exists(target)) continue;
    if (o.u && ctx.sys.vfs.exists(target) && fs.stat(target).mtime >= st.mtime) continue;
    if (o.i && ctx.sys.vfs.exists(target)) { const a = await ctx.term.readLine(`cp: overwrite '${shownTarget}'? `, { echo: true }); if (!a || !/^y/i.test(a)) continue; }
    try {
      if (st.t !== 'd') {
        try { fs.readFile(sAbs); } catch (e) { if (e instanceof FsError && st.t === 'f') { ctx.err(`cp: cannot open '${s}' for reading: ${e.text}\n`); rc = 1; continue; } }
      }
      const preserveOwner = preserve && ctx.cred.uid === 0;
      fs.copy(sAbs, target, { recursive: rec, preserve: preserveOwner, followLinks: !(rec || o.P), mode: preserve ? st.mode & 0o7777 : undefined });
      if (preserve && st.t === 'f' && !preserveOwner) { try { fs.chmod(target, st.mode & 0o7777); } catch { /* ignore */ } }
      if (o.v) ctx.out(`'${s}' -> '${shownTarget}'\n`);
    } catch (e) {
      if (e instanceof FsError) {
        const what = st.t === 'd' ? 'directory' : 'regular file';
        const msg = e.code === 'EISDIR' ? `cp: cannot overwrite directory '${shownTarget}' with non-directory\n` : `cp: cannot create ${what} '${shownTarget}': ${e.text}\n`;
        ctx.err(msg); rc = 1;
      } else throw e;
    }
  }
  return rc;
}, { usage: 'cp [OPTION]... SOURCE... DIRECTORY' });

cmd('mv', async (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'fivnuT', val: 't', long: { force: 'f', interactive: 'i', verbose: 'v', 'no-clobber': 'n', update: 'u', 'no-target-directory': 'T', 'target-directory': { key: 't', val: true } } });
  if (err) return usageError(ctx, err);
  const args = o.t ? [...rest, o.t] : rest;
  const info = destInfo(ctx, args, 'mv');
  if (!info) return 1;
  let rc = 0;
  for (const s of info.sources) {
    const sAbs = ctx.resolve(s);
    let st;
    try { st = ctx.fs.lstat(sAbs); } catch (e) { if (e instanceof FsError) { ctx.err(`mv: cannot stat '${s}': ${e.text}\n`); rc = 1; continue; } throw e; }
    const target = info.destIsDir && !o.T ? posix.join(info.destAbs, posix.basename(sAbs)) : info.destAbs;
    const shown = info.destIsDir && !o.T ? `${info.dest.replace(/\/$/, '')}/${posix.basename(sAbs)}` : info.dest;
    if (sAbs === target) { ctx.err(`mv: '${s}' and '${shown}' are the same file\n`); rc = 1; continue; }
    if (o.n && ctx.sys.vfs.exists(target)) continue;
    if (o.i && ctx.sys.vfs.exists(target)) { const a = await ctx.term.readLine(`mv: overwrite '${shown}'? `, { echo: true }); if (!a || !/^y/i.test(a)) continue; }
    try {
      if (st.t === 'd' && (target + '/').startsWith(sAbs + '/')) { ctx.err(`mv: cannot move '${s}' to a subdirectory of itself, '${shown}'\n`); rc = 1; continue; }
      const dn = ctx.sys.vfs.lookup(target);
      if (dn && dn.t === 'd' && st.t !== 'd') { ctx.err(`mv: cannot overwrite directory '${shown}' with non-directory\n`); rc = 1; continue; }
      ctx.fs.rename(sAbs, target);
      if (o.v) ctx.out(`renamed '${s}' -> '${shown}'\n`);
    } catch (e) {
      if (e instanceof FsError) { ctx.err(`mv: cannot move '${s}' to '${shown}': ${e.text}\n`); rc = 1; } else throw e;
    }
  }
  return rc;
}, { usage: 'mv [OPTION]... SOURCE... DIRECTORY' });

// ---------------------------------------------------------------- ln / readlink / realpath
cmd('ln', (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'sfvnTi', long: { symbolic: 's', force: 'f', verbose: 'v', 'no-dereference': 'n', 'no-target-directory': 'T' } });
  if (err) return usageError(ctx, err);
  if (!rest.length) { ctx.err("ln: missing file operand\nTry 'ln --help' for more information.\n"); return 1; }
  let sources; let dest;
  if (rest.length === 1) { sources = [rest[0]]; dest = posix.basename(rest[0]); } else { sources = rest.slice(0, -1); dest = rest[rest.length - 1]; }
  const destAbs = ctx.resolve(dest);
  const destIsDir = ctx.fs.isDir(destAbs) && !o.T;
  if (sources.length > 1 && !destIsDir) { ctx.err(`ln: target '${dest}' is not a directory\n`); return 1; }
  let rc = 0;
  for (const s of sources) {
    const target = destIsDir ? posix.join(destAbs, posix.basename(s)) : destAbs;
    const shown = destIsDir ? `${dest.replace(/\/$/, '')}/${posix.basename(s)}` : dest;
    try {
      if (ctx.sys.vfs.lookup(target, { follow: false })) {
        if (!o.f) throw new FsError('EEXIST', shown);
        ctx.fs.unlink(target);
      }
      if (o.s) ctx.fs.symlink(s, target);
      else {
        const sAbs = ctx.resolve(s);
        if (!ctx.fs.exists(sAbs)) throw Object.assign(new FsError('ENOENT', s), { src: true });
        if (ctx.fs.isDir(sAbs)) { ctx.err(`ln: ${s}: hard link not allowed for directory\n`); rc = 1; continue; }
        ctx.fs.copy(sAbs, target, { preserve: true });
      }
      if (o.v) ctx.out(`'${shown}' ${o.s ? '->' : '=>'} '${s}'\n`);
    } catch (e) {
      if (e instanceof FsError) {
        const kind = o.s ? 'symbolic link' : 'hard link';
        if (e.src) ctx.err(`ln: failed to access '${s}': ${e.text}\n`); else ctx.err(`ln: failed to create ${kind} '${shown}'${o.s ? '' : ` => '${s}'`}: ${e.text}\n`);
        rc = 1;
      } else throw e;
    }
  }
  return rc;
}, { usage: 'ln [OPTION]... TARGET LINK_NAME' });

function canonicalize(ctx, p, { mustExist = false, last = true } = {}) {
  const abs = ctx.resolve(p);
  try { return ctx.fs.realpath(abs); } catch (e) {
    if (!(e instanceof FsError)) throw e;
    if (mustExist) return null;
    // all but the last component must exist
    const parent = posix.dirname(abs);
    try { return posix.join(ctx.fs.realpath(parent), posix.basename(abs)); } catch { return null; }
  }
}

cmd('readlink', (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'fenmqsv', long: { canonicalize: 'f', 'canonicalize-existing': 'e', 'canonicalize-missing': 'm', 'no-newline': 'n' } });
  if (err) return usageError(ctx, err);
  if (!rest.length) { ctx.err("readlink: missing operand\nTry 'readlink --help' for more information.\n"); return 1; }
  let rc = 0;
  for (const f of rest) {
    const abs = ctx.resolve(f);
    if (o.f || o.e || o.m) {
      const r = canonicalize(ctx, f, { mustExist: o.e });
      if (r == null) { rc = 1; continue; }
      ctx.out(r + (o.n ? '' : '\n'));
    } else {
      try { ctx.out(ctx.fs.readlink(abs) + (o.n ? '' : '\n')); } catch { rc = 1; }
    }
  }
  return rc;
});

cmd('realpath', (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'esmqL', long: { 'canonicalize-existing': 'e', 'canonicalize-missing': 'm', 'no-symlinks': 's', quiet: 'q' } });
  if (err) return usageError(ctx, err);
  if (!rest.length) { ctx.err("realpath: missing operand\nTry 'realpath --help' for more information.\n"); return 1; }
  let rc = 0;
  for (const f of rest) {
    if (o.s || o.m) { ctx.out(ctx.resolve(f) + '\n'); continue; }
    const r = canonicalize(ctx, f, { mustExist: o.e });
    if (r == null) { if (!o.q) ctx.err(`realpath: ${f}: No such file or directory\n`); rc = 1; } else ctx.out(r + '\n');
  }
  return rc;
});

// ---------------------------------------------------------------- chmod
/** Apply a symbolic or octal mode string to `cur`. Returns the new mode or null if invalid. */
export function applyMode(cur, spec, isDir = false, umask = 0o022) {
  const oct = octalMode(spec);
  if (oct != null) return oct;
  let mode = cur & 0o7777;
  for (const clause of spec.split(',')) {
    const m = /^([ugoa]*)(([-+=][rwxXstugo]*)+)$/.exec(clause);
    if (!m) return null;
    let who = m[1];
    const noWho = who === '';
    if (noWho) who = 'a';
    const masks = { u: 0o700, g: 0o070, o: 0o007 };
    let whoMask = 0;
    for (const c of who) whoMask |= c === 'a' ? 0o777 : masks[c];
    const re = /([-+=])([rwxXstugo]*)/g;
    let r;
    while ((r = re.exec(m[2]))) {
      const op = r[1];
      let bits = 0;
      let special = 0;
      for (const p of r[2]) {
        const perm = (n) => (n === 'r' ? 4 : n === 'w' ? 2 : 1);
        if ('rwx'.includes(p)) { const v = perm(p); bits |= ((who.includes('u') || who.includes('a')) ? v << 6 : 0) | ((who.includes('g') || who.includes('a')) ? v << 3 : 0) | ((who.includes('o') || who.includes('a')) ? v : 0); }
        else if (p === 'X') { if (isDir || (cur & 0o111)) bits |= (who.includes('u') || who.includes('a') ? 0o100 : 0) | (who.includes('g') || who.includes('a') ? 0o010 : 0) | (who.includes('o') || who.includes('a') ? 0o001 : 0); }
        else if (p === 's') { if (who.includes('u') || who.includes('a')) special |= 0o4000; if (who.includes('g') || who.includes('a')) special |= 0o2000; }
        else if (p === 't') special |= 0o1000;
        else { // copy from u/g/o
          const src = p === 'u' ? (mode >> 6) & 7 : p === 'g' ? (mode >> 3) & 7 : mode & 7;
          bits |= (who.includes('u') || who.includes('a') ? src << 6 : 0) | (who.includes('g') || who.includes('a') ? src << 3 : 0) | (who.includes('o') || who.includes('a') ? src : 0);
        }
      }
      const effMask = noWho ? whoMask & ~umask : whoMask;
      bits &= effMask || bits;
      if (noWho) bits &= ~umask;
      if (op === '+') mode |= bits | special;
      else if (op === '-') mode &= ~(bits | special);
      else { mode = (mode & ~(whoMask | (special ? special : 0))) | bits | special; if (op === '=' && !special) mode &= ~0 ; }
    }
  }
  return mode & 0o7777;
}

cmd('chmod', (ctx) => {
  const spec = ctx.args.filter((a) => !(a.startsWith('-') && /^-[A-Za-z-]+$/.test(a) && !/^-[rwxXst]+$/.test(a.replace(/^-/, '')) === false && false));
  // chmod treats "-x" style modes as modes, so peel options manually
  const opts = { R: false, v: false, c: false, f: false, ref: null };
  const operands = [];
  for (let i = 0; i < ctx.args.length; i++) {
    const a = ctx.args[i];
    if (a === '--') { operands.push(...ctx.args.slice(i + 1)); break; }
    if (a.startsWith('--reference=')) { opts.ref = a.slice(12); continue; }
    if (a === '--recursive') { opts.R = true; continue; }
    if (a === '--verbose') { opts.v = true; continue; }
    if (a === '--changes') { opts.c = true; continue; }
    if (a === '--silent' || a === '--quiet') { opts.f = true; continue; }
    if (a.startsWith('--')) { ctx.err(`chmod: unrecognized option '${a}'\nTry 'chmod --help' for more information.\n`); return 1; }
    if (/^-[RvcfhH]+$/.test(a)) { for (const c of a.slice(1)) { if (c === 'R') opts.R = true; if (c === 'v') opts.v = true; if (c === 'c') opts.c = true; if (c === 'f') opts.f = true; } continue; }
    operands.push(a);
  }
  void spec;
  let mode = null;
  if (opts.ref == null) { mode = operands.shift(); if (mode === undefined) { ctx.err("chmod: missing operand\nTry 'chmod --help' for more information.\n"); return 1; } }
  if (!operands.length) { ctx.err(`chmod: missing operand after ‘${mode ?? opts.ref}’\nTry 'chmod --help' for more information.\n`); return 1; }
  let refMode = null;
  if (opts.ref != null) { try { refMode = ctx.fs.stat(ctx.resolve(opts.ref)).mode & 0o7777; } catch (e) { if (e instanceof FsError) { ctx.err(`chmod: failed to get attributes of '${opts.ref}': ${e.text}\n`); return 1; } throw e; } }
  if (refMode == null && applyMode(0o644, mode, false) == null) { ctx.err(`chmod: invalid mode: ‘${mode}’\nTry 'chmod --help' for more information.\n`); return 1; }
  let rc = 0;
  const one = (abs, shown, top) => {
    let st;
    try { st = ctx.fs.lstat(abs); } catch (e) {
      if (e instanceof FsError) { if (!opts.f) ctx.err(`chmod: cannot access '${shown}': ${e.text}\n`); rc = 1; return; } throw e;
    }
    if (st.t === 'l') {
      if (!top) return; // -R never follows or changes links found while recursing
      try { st = ctx.fs.stat(abs); } catch (e) { if (e instanceof FsError) { if (!opts.f) ctx.err(`chmod: cannot operate on dangling symlink '${shown}'\n`); rc = 1; return; } throw e; }
    }
    const nm = refMode ?? applyMode(st.mode, mode, st.t === 'd');
    try {
      ctx.fs.chmod(abs, (st.mode & ~0o7777) | nm);
      const oldS = modeToString(st.mode, st.t); const newS = modeToString((st.mode & ~0o7777) | nm, st.t);
      const o4 = (st.mode & 0o7777).toString(8).padStart(4, '0'); const n4 = nm.toString(8).padStart(4, '0');
      if (opts.v || (opts.c && o4 !== n4)) ctx.out(o4 === n4 && opts.v ? `mode of '${shown}' retained as ${o4} (${newS})\n` : `mode of '${shown}' changed from ${o4} (${oldS}) to ${n4} (${newS})\n`);
    } catch (e) {
      if (e instanceof FsError) { if (!opts.f) ctx.err(`chmod: changing permissions of '${shown}': ${e.text}\n`); rc = 1; } else throw e;
    }
    if (opts.R && st.t === 'd') {
      let names = [];
      try { names = ctx.fs.readdir(abs); } catch (e) { if (e instanceof FsError) { if (!opts.f) ctx.err(`chmod: cannot read directory '${shown}': ${e.text}\n`); rc = 1; return; } throw e; }
      for (const n of names) one(posix.join(abs, n), `${shown.replace(/\/$/, '')}/${n}`, false);
    }
  };
  for (const f of operands) one(ctx.resolve(f), f, true);
  return rc;
}, { usage: 'chmod [OPTION]... MODE[,MODE]... FILE...' });

// ---------------------------------------------------------------- chown / chgrp
function resolveOwner(ctx, spec, isGroupCmd) {
  const sys = ctx.sys;
  let userPart = null; let groupPart = null;
  if (isGroupCmd) groupPart = spec;
  else {
    const m = /^([^:.]*)([:.](.*))?$/.exec(spec) || [];
    userPart = m[1] ?? spec;
    if (m[2] !== undefined) groupPart = m[3];
    if (userPart.includes('.') && !users.getUser(sys, userPart) && groupPart === null) { const i = userPart.indexOf('.'); groupPart = userPart.slice(i + 1); userPart = userPart.slice(0, i); }
  }
  let uid = null; let gid = null;
  if (userPart) {
    const u = users.getUser(sys, userPart) || (/^\d+$/.test(userPart) ? { uid: Number(userPart), gid: null } : null);
    if (!u) return { err: `invalid user: ‘${spec}’` };
    uid = u.uid;
    if (groupPart === '') { const full = users.getUser(sys, userPart); gid = full ? full.gid : null; }
  }
  if (groupPart) {
    const g = users.getGroup(sys, groupPart) || (/^\d+$/.test(groupPart) ? { gid: Number(groupPart) } : null);
    if (!g) return { err: isGroupCmd ? `invalid group: ‘${spec}’` : `invalid group: ‘${spec}’` };
    gid = g.gid;
  }
  return { uid, gid };
}

function chownLike(ctx, isGroupCmd) {
  const name = ctx.name;
  const opts = { R: false, v: false, c: false, f: false, h: false, ref: null };
  const operands = [];
  for (let i = 0; i < ctx.args.length; i++) {
    const a = ctx.args[i];
    if (a === '--') { operands.push(...ctx.args.slice(i + 1)); break; }
    if (a.startsWith('--reference=')) { opts.ref = a.slice(12); continue; }
    if (a === '--recursive') { opts.R = true; continue; }
    if (a === '--verbose') { opts.v = true; continue; }
    if (a === '--changes') { opts.c = true; continue; }
    if (a === '--silent' || a === '--quiet') { opts.f = true; continue; }
    if (a === '--no-dereference') { opts.h = true; continue; }
    if (a.startsWith('--')) { ctx.err(`${name}: unrecognized option '${a}'\nTry '${name} --help' for more information.\n`); return 1; }
    if (/^-[RvcfhHLP]+$/.test(a)) { for (const c of a.slice(1)) { if (c in opts) opts[c] = true; } continue; }
    operands.push(a);
  }
  let owner;
  if (opts.ref != null) {
    try { const st = ctx.fs.stat(ctx.resolve(opts.ref)); owner = { uid: isGroupCmd ? null : st.uid, gid: st.gid }; } catch (e) { if (e instanceof FsError) { ctx.err(`${name}: failed to get attributes of '${opts.ref}': ${e.text}\n`); return 1; } throw e; }
  } else {
    const spec = operands.shift();
    if (spec === undefined) { ctx.err(`${name}: missing operand\nTry '${name} --help' for more information.\n`); return 1; }
    if (!operands.length) { ctx.err(`${name}: missing operand after ‘${spec}’\nTry '${name} --help' for more information.\n`); return 1; }
    owner = resolveOwner(ctx, spec, isGroupCmd);
    if (owner.err) { ctx.err(`${name}: ${owner.err}\n`); return 1; }
  }
  if (!operands.length) { ctx.err(`${name}: missing operand\nTry '${name} --help' for more information.\n`); return 1; }
  const { uname, gname } = idMaps(ctx.sys);
  let rc = 0;
  const one = (abs, shown, top) => {
    let st;
    try { st = ctx.fs.lstat(abs); } catch (e) {
      if (e instanceof FsError) { if (!opts.f) ctx.err(`${name}: cannot access '${shown}': ${e.text}\n`); rc = 1; return; } throw e;
    }
    const isLink = st.t === 'l';
    const newUid = owner.uid ?? st.uid; const newGid = owner.gid ?? st.gid;
    let allowed = ctx.cred.uid === 0;
    if (!allowed && st.uid === ctx.cred.uid && newUid === st.uid && (owner.gid == null || ctx.cred.gids.includes(newGid))) allowed = true;
    if (!allowed) { if (!opts.f) ctx.err(`${name}: changing ownership of '${shown}': Operation not permitted\n`); rc = 1; }
    else {
      try {
        ctx.sys.vfs.chown(abs, newUid, newGid, { follow: !(isLink && (opts.h || !top)) });
        const changed = newUid !== st.uid || newGid !== st.gid;
        if (opts.v || (opts.c && changed)) {
          if (!changed) ctx.out(`ownership of '${shown}' retained as ${uname(st.uid)}:${gname(st.gid)}\n`);
          else ctx.out(`changed ownership of '${shown}' from ${uname(st.uid)}:${gname(st.gid)} to ${uname(newUid)}:${gname(newGid)}\n`);
        }
      } catch (e) { if (e instanceof FsError) { if (!opts.f) ctx.err(`${name}: cannot access '${shown}': ${e.text}\n`); rc = 1; } else throw e; }
    }
    if (opts.R && st.t === 'd') {
      let names = [];
      try { names = ctx.fs.readdir(abs); } catch (e) { if (e instanceof FsError) { if (!opts.f) ctx.err(`${name}: cannot read directory '${shown}': ${e.text}\n`); rc = 1; return; } throw e; }
      for (const n of names) one(posix.join(abs, n), `${shown.replace(/\/$/, '')}/${n}`, false);
    }
  };
  for (const f of operands) one(ctx.resolve(f), f, true);
  return rc;
}
cmd('chown', (ctx) => chownLike(ctx, false), { usage: 'chown [OPTION]... [OWNER][:[GROUP]] FILE...' });
cmd('chgrp', (ctx) => chownLike(ctx, true), { usage: 'chgrp [OPTION]... GROUP FILE...' });

// ---------------------------------------------------------------- stat
const FTYPE = (st) => (st.t === 'd' ? 'directory' : st.t === 'l' ? 'symbolic link' : st.size === 0 ? 'regular empty file' : 'regular file');
function statTime(ms) { const d = new Date(ms); return `${fmtIso(ms)}.${String(d.getMilliseconds()).padStart(3, '0')}000000 ${tzOffset(ms)}`; }

cmd('stat', (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'Lt', val: 'c', long: { format: { key: 'c', val: true }, printf: { key: 'printf', val: true }, dereference: 'L', terse: 't' } });
  if (err) return usageError(ctx, err);
  if (!rest.length) { ctx.err("stat: missing operand\nTry 'stat --help' for more information.\n"); return 1; }
  const { uname, gname } = idMaps(ctx.sys);
  let rc = 0;
  for (const f of rest) {
    const abs = ctx.resolve(f);
    let st;
    try { st = o.L ? ctx.fs.stat(abs) : ctx.fs.lstat(abs); } catch (e) {
      if (e instanceof FsError) { ctx.err(`stat: cannot statx '${f}': ${e.text}\n`); rc = 1; continue; } throw e;
    }
    const fmt = o.c ?? o.printf;
    if (fmt != null) {
      const name = st.t === 'l' ? `'${f}' -> '${ctx.fs.readlink(abs)}'` : `'${f}'`;
      let out = fmt.replace(/%([a-zA-Z%])/g, (m, c) => ({
        n: f, N: name, a: (st.mode & 0o7777).toString(8), A: modeToString(st.mode, st.t), u: String(st.uid), g: String(st.gid), U: uname(st.uid), G: gname(st.gid),
        s: String(st.size), F: FTYPE(st), i: String(st.ino), h: String(st.nlink), b: String(Math.ceil(st.size / 512)), B: '512', y: statTime(st.mtime), Y: String(Math.floor(st.mtime / 1000)),
        x: statTime(st.mtime), X: String(Math.floor(st.mtime / 1000)), z: statTime(st.mtime), Z: String(Math.floor(st.mtime / 1000)), '%': '%', d: '2049', D: '801', f: st.mode.toString(16), F2: '', o: '4096', w: '-', W: '0', t: '0', T: '0', C: '?', m: '/',
      }[c] ?? m));
      if (o.printf != null) out = out.replace(/\\n/g, '\n').replace(/\\t/g, '\t'); else out += '\n';
      ctx.out(out);
      continue;
    }
    const head = st.t === 'l' ? `'${f}' -> '${ctx.fs.readlink(abs)}'` : f;
    const blocks = st.t === 'd' ? 8 : Math.ceil(st.size / 4096) * 8;
    const perm = `(${(st.mode & 0o7777).toString(8).padStart(4, '0')}/${modeToString(st.mode, st.t)})`;
    ctx.out(`  File: ${head}\n  Size: ${String(st.size).padEnd(10)}\tBlocks: ${String(blocks).padEnd(10)} IO Block: 4096   ${FTYPE(st)}\n`);
    ctx.out(`Device: 801h/2049d\tInode: ${String(st.ino).padEnd(10)} Links: ${st.nlink}\n`);
    ctx.out(`Access: ${perm}  Uid: (${String(st.uid).padStart(5)}/${uname(st.uid).padStart(8)})   Gid: (${String(st.gid).padStart(5)}/${gname(st.gid).padStart(8)})\n`);
    ctx.out(`Access: ${statTime(st.mtime)}\nModify: ${statTime(st.mtime)}\nChange: ${statTime(st.mtime)}\n Birth: ${statTime(st.mtime)}\n`);
  }
  return rc;
}, { usage: 'stat [OPTION]... FILE...' });

// ---------------------------------------------------------------- file
export function describeFile(ctx, abs) {
  const st = ctx.fs.lstat(abs);
  if (st.t === 'd') return 'directory';
  if (st.t === 'l') return `symbolic link to ${ctx.fs.readlink(abs)}`;
  if (st.size === 0) return 'empty';
  let data = '';
  try { data = ctx.fs.readFile(abs); } catch (e) { if (e instanceof FsError) return `cannot open (${e.text})`; throw e; }
  if (data.startsWith('\u007fELF')) return 'ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV), dynamically linked, interpreter /lib64/ld-linux-x86-64.so.2, BuildID[sha1]=3b1d0a6e3c1b57a0a0e6c2a1a8f6d3f4a0c1b2d3, for GNU/Linux 3.2.0, stripped';
  if (data.startsWith('ID3')) return 'Audio file with ID3 version 2.3.0, contains: MPEG ADTS, layer III, v1, 192 kbps, 44.1 kHz, Stereo';
  if (/^.{4}ftyp/s.test(data)) return 'ISO Media, MP4 v2 [ISO 14496-14]';
  if (data.startsWith('\u0089PNG')) return 'PNG image data';
  if (data.startsWith('\u00ff\u00d8\u00ff')) return 'JPEG image data, JFIF standard 1.01';
  if (data.startsWith('%PDF')) return 'PDF document, version 1.7';
  if (data.startsWith('PK\u0003\u0004')) return 'Zip archive data, at least v2.0 to extract';
  if (data.startsWith('\u001f\u008b')) return 'gzip compressed data, from Unix';
  if (data.startsWith('#!')) {
    const sh = data.split('\n')[0].slice(2).trim();
    const nm = sh.split(/\s+/).pop().split('/').pop();
    const lang = { bash: 'Bourne-Again shell script', sh: 'POSIX shell script', dash: 'POSIX shell script', python3: 'Python script', python: 'Python script', perl: 'Perl script text executable' }[nm] || `${nm} script`;
    return `${lang}, ASCII text executable`;
  }
  const nonAscii = /[^\x09\x0a\x0d\x20-\x7e]/.test(data);
  const crlf = data.includes('\r\n');
  const longLine = data.split('\n').some((l) => l.length > 300);
  const bin = /[\x00-\x08\x0e-\x1f]/.test(data);
  if (bin) return 'data';
  const kind = nonAscii ? 'Unicode text, UTF-8 text' : 'ASCII text';
  return kind + (longLine ? ', with very long lines (' + Math.max(...data.split('\n').map((l) => l.length)) + ')' : '') + (crlf ? ', with CRLF line terminators' : '');
}

cmd('file', (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'bLiNsz', long: { brief: 'b', 'mime-type': 'm', mime: 'i', dereference: 'L' } });
  if (err) return usageError(ctx, err);
  if (!rest.length) { ctx.err('Usage: file [OPTION...] [FILE...]\nDetermine type of FILEs.\n'); return 1; }
  const w = Math.max(...rest.map((r) => r.length));
  let rc = 0;
  for (const f of rest) {
    const abs = ctx.resolve(f);
    let d;
    try {
      d = describeFile(ctx, abs);
      if (o.m || o.i) {
        const mime = d === 'directory' ? 'inode/directory' : d.startsWith('symbolic link') ? 'inode/symlink' : d === 'empty' ? 'inode/x-empty' : d.startsWith('ELF') ? 'application/x-pie-executable' : d.startsWith('Audio') ? 'audio/mpeg' : d.startsWith('ISO Media') ? 'video/mp4' : d.startsWith('PNG') ? 'image/png' : d.startsWith('JPEG') ? 'image/jpeg' : d.startsWith('PDF') ? 'application/pdf' : d.includes('script') ? 'text/x-shellscript' : d === 'data' ? 'application/octet-stream' : 'text/plain';
        d = o.i ? `${mime}; charset=${mime.startsWith('text') ? (d.includes('UTF-8') ? 'utf-8' : 'us-ascii') : 'binary'}` : mime;
      }
    } catch (e) {
      if (e instanceof FsError) { d = `cannot open \`${f}' (${e.text})`; rc = 0; } else throw e;
    }
    ctx.out(o.b ? `${d}\n` : `${(f + ':').padEnd(w + 1)} ${d}\n`);
  }
  return rc;
}, { usage: 'file [OPTION...] [FILE...]' });

// ---------------------------------------------------------------- find
function parseSize(spec) {
  const m = /^([+-]?)(\d+)([cwbkKMGT]?)$/.exec(spec);
  if (!m) return null;
  const mult = { c: 1, w: 2, b: 512, k: 1024, K: 1024, M: 1048576, G: 1073741824, T: 1099511627776 }[m[3] || 'b'];
  return { cmp: m[1], n: Number(m[2]), mult };
}
const cmpNum = (cmpOp, val, n) => (cmpOp === '+' ? val > n : cmpOp === '-' ? val < n : val === n);

cmd('find', async (ctx) => {
  const args = [...ctx.args];
  const paths = [];
  while (args.length && !(args[0].startsWith('-') && args[0] !== '-') && args[0] !== '(' && args[0] !== '!' && args[0] !== ')') paths.push(args.shift());
  if (!paths.length) paths.push('.');
  const { uname, gname } = idMaps(ctx.sys);
  const now = ctx.sys.now();
  const gopts = { maxdepth: Infinity, mindepth: 0, depth: false, follow: false };
  let i = 0;
  const fail = (msg) => { throw Object.assign(new Error(msg), { findErr: true }); };
  const quotesFor = (s) => `‘${s}’`;
  let hasAction = false;

  // expression grammar: or > and > not > primary
  const parseOr = () => {
    let left = parseAnd();
    while (args[i] === '-o' || args[i] === '-or') { i++; const right = parseAnd(); const l = left; left = (e) => l(e) || right(e); }
    return left;
  };
  const parseAnd = () => {
    let left = parseNot();
    while (i < args.length && args[i] !== '-o' && args[i] !== '-or' && args[i] !== ')') {
      if (args[i] === '-a' || args[i] === '-and') i++;
      const right = parseNot(); const l = left; left = (e) => l(e) && right(e);
    }
    return left;
  };
  const parseNot = () => {
    if (args[i] === '!' || args[i] === '-not') { i++; const f = parseNot(); return (e) => !f(e); }
    return parsePrimary();
  };
  const need = (opt) => { if (i >= args.length) fail(`missing argument to \`${opt}'`); return args[i++]; };
  const parsePrimary = () => {
    const t = args[i++];
    if (t === undefined) fail('invalid expression; expected an expression');
    if (t === '(') { const f = parseOr(); if (args[i] !== ')') fail('invalid expression; I was expecting to find a \')\' somewhere but did not see one.'); i++; return f; }
    switch (t) {
      case '-maxdepth': gopts.maxdepth = Number(need(t)); return () => true;
      case '-mindepth': gopts.mindepth = Number(need(t)); return () => true;
      case '-depth': gopts.depth = true; return () => true;
      case '-xdev': case '-mount': case '-noleaf': case '-ignore_readdir_race': return () => true;
      case '-follow': gopts.follow = true; return () => true;
      case '-name': case '-iname': {
        const re = globToRegex(need(t), { dot: true }); const ic = t === '-iname';
        const r = ic ? new RegExp(re.source, 'i') : re;
        return (e) => r.test(e.name);
      }
      case '-path': case '-wholename': case '-ipath': {
        const pat = need(t); const re = globToRegex(pat.replace(/\*/g, '*'), { dot: true });
        const src = re.source.replace(/\[\^\/\]\*/g, '.*');
        const r = new RegExp(src, t === '-ipath' ? 'i' : '');
        return (e) => r.test(e.shown);
      }
      case '-regex': case '-iregex': { const r = new RegExp(`^(?:${need(t)})$`, t === '-iregex' ? 'i' : ''); return (e) => r.test(e.shown); }
      case '-type': { const ty = need(t).split(','); return (e) => ty.some((c) => (c === 'f' ? e.st.t === 'f' : c === 'd' ? e.st.t === 'd' : c === 'l' ? e.st.t === 'l' : false)); }
      case '-user': { const v = need(t); const u = users.getUser(ctx.sys, v); const id = u ? u.uid : /^\d+$/.test(v) ? Number(v) : fail(`${quotesFor(v)} is not the name of a known user`); return (e) => e.st.uid === id; }
      case '-group': { const v = need(t); const g = users.getGroup(ctx.sys, v); const id = g ? g.gid : /^\d+$/.test(v) ? Number(v) : fail(`${quotesFor(v)} is not the name of an existing group`); return (e) => e.st.gid === id; }
      case '-uid': { const v = need(t); const m = /^([+-]?)(\d+)$/.exec(v); return (e) => cmpNum(m[1], e.st.uid, Number(m[2])); }
      case '-gid': { const v = need(t); const m = /^([+-]?)(\d+)$/.exec(v); return (e) => cmpNum(m[1], e.st.gid, Number(m[2])); }
      case '-nouser': return (e) => !users.getUserByUid(ctx.sys, e.st.uid);
      case '-nogroup': return (e) => !users.getGroupByGid(ctx.sys, e.st.gid);
      case '-perm': {
        const v = need(t);
        const mode = v.replace(/^[-/+]/, '');
        let bits = octalMode(mode);
        if (bits == null) bits = applyMode(0, mode, false, 0);
        if (bits == null) fail(`Invalid mode ${quotesFor(v)}`);
        if (v.startsWith('-')) return (e) => (e.st.mode & bits) === bits;
        if (v.startsWith('/') || v.startsWith('+')) return (e) => bits === 0 || (e.st.mode & bits) !== 0;
        return (e) => (e.st.mode & 0o7777) === bits;
      }
      case '-size': { const v = need(t); const s = parseSize(v); if (!s) fail(`invalid argument ${quotesFor(v)} to \`-size'`); return (e) => { const units = Math.ceil(e.st.size / s.mult); return cmpNum(s.cmp, units, s.n); }; }
      case '-empty': return (e) => (e.st.t === 'd' ? ctx.fs.readdir(e.abs).length === 0 : e.st.t === 'f' && e.st.size === 0);
      case '-mtime': case '-atime': case '-ctime': { const v = need(t); const m = /^([+-]?)(\d+)$/.exec(v); if (!m) fail(`invalid argument ${quotesFor(v)} to \`${t}'`); return (e) => cmpNum(m[1], Math.floor((now - e.st.mtime) / 86400000), Number(m[2])); }
      case '-mmin': case '-amin': case '-cmin': { const v = need(t); const m = /^([+-]?)(\d+)$/.exec(v); if (!m) fail(`invalid argument ${quotesFor(v)} to \`${t}'`); return (e) => cmpNum(m[1], Math.floor((now - e.st.mtime) / 60000), Number(m[2])); }
      case '-newer': { const ref = need(t); let rm; try { rm = ctx.fs.stat(ctx.resolve(ref)).mtime; } catch { fail(`${quotesFor(ref)}: No such file or directory`); } return (e) => e.st.mtime > rm; }
      case '-readable': return (e) => permFor(ctx, e.st, 4);
      case '-writable': return (e) => permFor(ctx, e.st, 2);
      case '-executable': return (e) => permFor(ctx, e.st, 1);
      case '-true': return () => true;
      case '-false': return () => false;
      case '-prune': return (e) => { e.prune = true; return true; };
      case '-print': hasAction = true; return (e) => { ctx.out(e.shown + '\n'); return true; };
      case '-print0': hasAction = true; return (e) => { ctx.out(e.shown + '\0'); return true; };
      case '-printf': { hasAction = true; const f = need(t); return (e) => { ctx.out(f.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/%([pfsmuUgGTkMdhy%])/g, (m, c) => ({ p: e.shown, f: e.name, s: String(e.st.size), m: (e.st.mode & 0o7777).toString(8), u: uname(e.st.uid), U: String(e.st.uid), g: gname(e.st.gid), G: String(e.st.gid), '%': '%', y: e.st.t === 'd' ? 'd' : e.st.t === 'l' ? 'l' : 'f', h: posix.dirname(e.shown), M: modeToString(e.st.mode, e.st.t), d: String(e.depth), k: String(Math.ceil(e.st.size / 1024)), T: '', }[c] ?? m))); return true; }; }
      case '-ls': hasAction = true; return (e) => { const st = e.st; ctx.out(`${String(st.ino).padStart(8)} ${String(Math.ceil(st.size / 1024)).padStart(4)} ${modeToString(st.mode, st.t)} ${String(st.nlink).padStart(3)} ${uname(st.uid).padEnd(8)} ${gname(st.gid).padEnd(8)} ${String(st.size).padStart(8)} ${fmtLsDate(st.mtime, now)} ${e.shown}${st.t === 'l' ? ' -> ' + ctx.fs.readlink(e.abs) : ''}\n`); return true; };
      case '-delete': hasAction = true; gopts.depth = true; return (e) => { try { if (e.st.t === 'd') ctx.fs.rmdir(e.abs); else ctx.fs.unlink(e.abs); return true; } catch (er) { if (er instanceof FsError) { ctx.err(`find: cannot delete ${quotesFor(e.shown)}: ${er.text}\n`); rc = 1; return false; } throw er; } };
      case '-exec': case '-execdir': case '-ok': {
        hasAction = true;
        const tpl = [];
        while (i < args.length && args[i] !== ';' && args[i] !== '+') tpl.push(args[i++]);
        if (i >= args.length) fail(`missing argument to \`${t}'`);
        const term = args[i++];
        if (term === '+') { const batch = []; execBatches.push({ tpl, batch }); return (e) => { batch.push(e.shown); return true; }; }
        return (e) => { pending.push({ argv: tpl.map((a) => a.split('{}').join(e.shown)), ask: t === '-ok' }); return true; };
      }
      case '-quit': return (e) => { quit = true; return true; };
      default:
        if (t.startsWith('-')) fail(`unknown predicate \`${t}'`);
        fail(`paths must precede expression: \`${t}'`);
    }
    return () => true;
  };

  let rc = 0;
  let quit = false;
  const execBatches = [];
  const pending = [];
  let expr;
  try {
    expr = i < args.length ? parseOr() : () => true;
    if (i < args.length) fail(`unknown predicate \`${args[i]}'`);
  } catch (e) {
    if (e.findErr) { ctx.err(`find: ${e.message}\n`); return 1; }
    throw e;
  }
  const evalExpr = hasAction ? expr : (e) => { if (expr(e)) { ctx.out(e.shown + '\n'); } return true; };

  const flush = async () => {
    while (pending.length) {
      const p = pending.shift();
      const st = await ctx.exec(p.argv, { out: ctx.out, err: ctx.err, stdin: null, tty: false });
      if (st !== 0) rc = 1;
    }
  };
  const visit = async (abs, shown, depth) => {
    if (quit || ctx.aborted()) return;
    let st;
    try { st = gopts.follow ? ctx.fs.stat(abs) : ctx.fs.lstat(abs); } catch (e) {
      if (e instanceof FsError) { ctx.err(`find: ${quotesFor(shown)}: ${e.text}\n`); rc = 1; return; } throw e;
    }
    const e = { abs, shown, name: depth === 0 ? shown.replace(/\/+$/, '').split('/').pop() || shown : posix.basename(abs), st, depth, prune: false };
    const run = async () => { if (depth >= gopts.mindepth) { evalExpr(e); await flush(); } };
    if (!gopts.depth) await run();
    if (st.t === 'd' && !e.prune && depth < gopts.maxdepth) {
      let names;
      try { names = ctx.fs.readdir(abs); } catch (er) { if (er instanceof FsError) { ctx.err(`find: ${quotesFor(shown)}: ${er.text}\n`); rc = 1; names = []; } else throw er; }
      for (const n of names) await visit(posix.join(abs, n), `${shown.replace(/\/$/, '')}/${n}`, depth + 1);
    }
    if (gopts.depth) await run();
  };
  for (const p of paths) {
    const abs = ctx.resolve(p);
    if (!ctx.sys.vfs.lookup(abs, { follow: false })) { ctx.err(`find: ${quotesFor(p)}: No such file or directory\n`); rc = 1; continue; }
    await visit(abs, p, 0);
  }
  for (const b of execBatches) {
    if (!b.batch.length) continue;
    const argv = [];
    for (const a of b.tpl) { if (a === '{}') argv.push(...b.batch); else argv.push(a); }
    const st = await ctx.exec(argv, { out: ctx.out, err: ctx.err, stdin: null, tty: false });
    if (st !== 0) rc = 1;
  }
  return rc;
}, { usage: 'find [-H] [-L] [-P] [-Olevel] [-D debugopts] [path...] [expression]' });

function permFor(ctx, st, bit) {
  const c = ctx.cred;
  if (c.uid === 0) return bit !== 1 || st.t === 'd' || (st.mode & 0o111) !== 0;
  const shift = st.uid === c.uid ? 6 : c.gids.includes(st.gid) ? 3 : 0;
  return ((st.mode >> shift) & bit) !== 0;
}

// ---------------------------------------------------------------- du / df
cmd('du', (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'shacxkmbL', val: 'd', long: { summarize: 's', 'human-readable': 'h', all: 'a', total: 'c', 'max-depth': { key: 'd', val: true }, 'apparent-size': 'apparent', 'one-file-system': 'x', 'si': 'si' } });
  if (err) return usageError(ctx, err);
  const maxDepth = o.d != null ? Number(o.d) : o.s ? 0 : Infinity;
  const fmt = (kb, bytes) => (o.h ? humanSize(kb * 1024, o.si) : o.m ? String(Math.ceil(kb / 1024)) : o.b ? String(bytes) : String(kb));
  let rc = 0; let grand = 0;
  const walk = (abs, shown, depth) => {
    let st;
    try { st = ctx.fs.lstat(abs); } catch (e) { if (e instanceof FsError) { ctx.err(`du: cannot access '${shown}': ${e.text}\n`); rc = 1; return { kb: 0, bytes: 0 }; } throw e; }
    let kb = o.apparent || o.b ? Math.ceil(st.size / 1024) : st.t === 'd' ? 4 : Math.ceil(st.size / 4096) * 4;
    let bytes = st.size;
    if (st.t === 'd') {
      let names = [];
      try { names = ctx.fs.readdir(abs); } catch (e) { if (e instanceof FsError) { ctx.err(`du: cannot read directory '${shown}': ${e.text}\n`); rc = 1; } else throw e; }
      for (const n of names) {
        const r = walk(posix.join(abs, n), `${shown.replace(/\/$/, '')}/${n}`, depth + 1);
        kb += r.kb; bytes += r.bytes;
      }
      if (depth <= maxDepth) ctx.out(`${fmt(kb, bytes)}\t${shown}\n`);
    } else if ((o.a || depth === 0) && depth <= maxDepth) ctx.out(`${fmt(kb, bytes)}\t${shown}\n`);
    return { kb, bytes };
  };
  for (const f of rest.length ? rest : ['.']) { const r = walk(ctx.resolve(f), f, 0); grand += r.kb; }
  if (o.c) ctx.out(`${fmt(grand, grand * 1024)}\ttotal\n`);
  return rc;
}, { usage: 'du [OPTION]... [FILE]...' });

const DF_TABLE = [
  { fs: 'tmpfs', size: 809_000, used: 1_980, mount: '/run', type: 'tmpfs' },
  { fs: '/dev/sda2', size: 31_450_000, used: 11_760_000, mount: '/', type: 'ext4' },
  { fs: 'tmpfs', size: 4_045_000, used: 0, mount: '/dev/shm', type: 'tmpfs' },
  { fs: 'tmpfs', size: 5_120, used: 4, mount: '/run/lock', type: 'tmpfs' },
  { fs: '/dev/sda1', size: 523_244, used: 6_220, mount: '/boot/efi', type: 'vfat' },
  { fs: 'tmpfs', size: 809_000, used: 116, mount: '/run/user/1000', type: 'tmpfs' },
];
cmd('df', (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'hHkTaPil', val: 'tx', long: { 'human-readable': 'h', si: 'H', 'print-type': 'T', local: 'l', all: 'a', inodes: 'i' } });
  if (err) return usageError(ctx, err);
  let rows = DF_TABLE;
  if (rest.length) {
    for (const f of rest) { if (!ctx.fs.exists(ctx.resolve(f))) { ctx.err(`df: ${f}: No such file or directory\n`); return 1; } }
    rows = [DF_TABLE[1]];
  }
  if (o.a || true) rows = [{ fs: 'udev', size: 4_020_000, used: 0, mount: '/dev', type: 'devtmpfs' }, ...rows].filter((r, i, a) => (rest.length ? true : a.indexOf(r) === i));
  const fmt = (kb) => (o.h ? humanSize(kb * 1024) : o.H ? humanSize(kb * 1024, true) : String(kb));
  const table = rows.map((r) => ({ fs: r.fs, type: r.type, size: fmt(r.size), used: fmt(r.used), avail: fmt(r.size - r.used), pct: Math.ceil((r.used / r.size) * 100) + '%', mount: r.mount }));
  const head = { fs: 'Filesystem', type: 'Type', size: o.h || o.H ? 'Size' : '1K-blocks', used: 'Used', avail: 'Avail', pct: 'Use%', mount: 'Mounted on' };
  const all = [head, ...table];
  const w = (k) => Math.max(...all.map((r) => r[k].length));
  const wf = w('fs'); const wt = w('type'); const ws = w('size'); const wu = w('used'); const wa = w('avail'); const wp = w('pct');
  for (const r of all) ctx.out(`${r.fs.padEnd(wf)} ${o.T ? r.type.padEnd(wt) + ' ' : ''}${r.size.padStart(ws)} ${r.used.padStart(wu)} ${r.avail.padStart(wa)} ${r.pct.padStart(wp)} ${r.mount}\n`);
  return 0;
}, { usage: 'df [OPTION]... [FILE]...' });

// ---------------------------------------------------------------- mktemp / tree / install
cmd('mktemp', (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'dqu', val: 'p', long: { directory: 'd', tmpdir: { key: 'p', val: true, optional: true } } });
  if (err) return usageError(ctx, err);
  const tpl = rest[0] || 'tmp.XXXXXXXXXX';
  const rnd = () => { const c = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; return c[Math.floor(ctx.sys.rng() * c.length)]; };
  const name = tpl.replace(/X+$/, (m) => Array.from(m, rnd).join(''));
  const dir = typeof o.p === 'string' ? o.p : '/tmp';
  const abs = tpl.includes('/') ? ctx.resolve(name) : posix.join(dir, name);
  try { if (o.d) ctx.fs.mkdir(abs, { mode: 0o700 }); else ctx.fs.writeFile(abs, '', { mode: 0o600 }); } catch (e) {
    if (e instanceof FsError) { ctx.err(`mktemp: failed to create ${o.d ? 'directory' : 'file'} via template ‘${tpl.includes('/') ? tpl : posix.join(dir, tpl)}’: ${e.text}\n`); return 1; } throw e;
  }
  ctx.out(abs + '\n');
  return 0;
});

cmd('tree', (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'adfpugsCL', val: 'L', long: {} });
  if (err) return usageError(ctx, err);
  const maxLevel = o.L ? Number(o.L) : Infinity;
  let dirs = 0; let files = 0;
  const root = rest[0] || '.';
  ctx.out(root + '\n');
  const walk = (abs, prefix, level) => {
    let names;
    try { names = ctx.fs.readdir(abs); } catch (e) { if (e instanceof FsError) { return; } throw e; }
    names = names.filter((n) => o.a || !n.startsWith('.')).sort(collate);
    names.forEach((n, idx) => {
      const last = idx === names.length - 1;
      const p = posix.join(abs, n);
      let st; try { st = ctx.fs.lstat(p); } catch { return; }
      ctx.out(`${prefix}${last ? '└── ' : '├── '}${n}${st.t === 'l' ? ' -> ' + ctx.fs.readlink(p) : ''}\n`);
      if (st.t === 'd') { dirs++; if (level < maxLevel) walk(p, prefix + (last ? '    ' : '│   '), level + 1); } else files++;
    });
  };
  walk(ctx.resolve(root), '', 1);
  ctx.out(`\n${dirs} directories, ${files} files\n`);
  return 0;
}, { pkg: 'tree' });

cmd('install', (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'dvCp', val: 'mogt', long: { directory: 'd' } });
  if (err) return usageError(ctx, err);
  if (o.d) { for (const d of rest) { try { ctx.fs.mkdir(ctx.resolve(d), { parents: true, mode: o.m ? parseInt(o.m, 8) : 0o755 }); } catch (e) { if (e instanceof FsError) { ctx.err(`install: cannot create directory '${d}': ${e.text}\n`); return 1; } throw e; } } return 0; }
  if (rest.length < 2) { ctx.err("install: missing file operand\n"); return 1; }
  const dest = ctx.resolve(rest[rest.length - 1]);
  for (const s of rest.slice(0, -1)) {
    try {
      const target = ctx.fs.isDir(dest) ? posix.join(dest, posix.basename(s)) : dest;
      ctx.fs.copy(ctx.resolve(s), target, { mode: o.m ? parseInt(o.m, 8) : 0o755 });
      if (o.m) ctx.fs.chmod(target, parseInt(o.m, 8));
    } catch (e) { if (e instanceof FsError) { ctx.err(`install: cannot create regular file '${rest[rest.length - 1]}': ${e.text}\n`); return 1; } throw e; }
  }
  return 0;
});

cmd(['lsattr'], (ctx) => {
  const { rest } = parseOpts(ctx.args, { bool: 'adR' });
  for (const f of rest.length ? rest : ['.']) {
    const abs = ctx.resolve(f);
    try {
      if (ctx.fs.isDir(abs) && !rest.length) { for (const n of ctx.fs.readdir(abs)) ctx.out(`--------------e------- ${posix.join(f, n)}\n`); } else ctx.out(`--------------e------- ${f}\n`);
    } catch (e) { if (e instanceof FsError) { ctx.err(`lsattr: ${e.text} While reading flags on ${f}\n`); return 1; } throw e; }
  }
  return 0;
});
cmd('chattr', () => 0);

export { tzAbbrev };
