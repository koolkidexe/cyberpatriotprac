// File and directory commands.
import { def } from '../registry.js';
import { CmdError } from '../../core/errors.js';
import { FsError } from '../../core/vfs.js';
import * as users from '../../core/users.js';
import { posix, modeToString, fmtLsDate, humanSize, globToRegex, sha256hex, md5ish, fmtIso } from '../../core/util.js';
import { getopt, eachInput, quoteName, lines } from './util.js';

const maps = (ctx) => {
  const pw = new Map(); for (const u of users.readPasswd(ctx.sys)) if (!pw.has(u.uid)) pw.set(u.uid, u.name);
  const gr = new Map(); for (const g of users.readGroups(ctx.sys)) if (!gr.has(g.gid)) gr.set(g.gid, g.name);
  return { uname: (id) => pw.get(id) ?? String(id), gname: (id) => gr.get(id) ?? String(id) };
};

// ------------------------------------------------------------------ ls
const sortKey = (n) => n.replace(/^[._\-]+/, '').toLowerCase();
const collate = (a, b) => {
  if (a === '.' || b === '.' || a === '..' || b === '..') { const o = { '.': 0, '..': 1 }; if (a in o && b in o) return o[a] - o[b]; if (a in o) return -1; if (b in o) return 1; }
  const x = sortKey(a); const y = sortKey(b); return x < y ? -1 : x > y ? 1 : a < b ? 1 : a > b ? -1 : 0; };
const ARCHIVE = /\.(tar|tgz|gz|zip|bz2|xz|deb|rpm|7z|rar|zst)$/i;
const IMAGE = /\.(jpg|jpeg|png|gif|bmp|svg|webp|mp3|mp4|mkv|ogg|wav|flac|avi|mov)$/i;

function lsColor(st, name) {
  let c = null;
  if (st.type === 'link') c = '01;36';
  else if (st.type === 'dir') c = st.mode & 0o1000 ? (st.mode & 0o002 ? '30;42' : '37;44') : st.mode & 0o002 ? '34;42' : '01;34';
  else if (st.mode & 0o4000) c = '37;41';
  else if (st.mode & 0o2000) c = '30;43';
  else if (st.mode & 0o111) c = '01;32';
  else if (ARCHIVE.test(name)) c = '01;31';
  else if (IMAGE.test(name)) c = '01;35';
  return c ? `\u001b[${c}m${name}\u001b[0m` : name;
}

def('ls', (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'aAlhRdtrS1FisCxfgGoU', long: { all: 'a', 'almost-all': 'A', 'human-readable': 'h', recursive: 'R', directory: 'd', color: ['color', true], 'group-directories-first': 'gdf', 'no-group': 'G' } });
  const color = opts.color ? opts.color !== 'never' && (opts.color === 'always' || ctx.tty) : false;
  const long = opts.l || opts.g || opts.o; const showAll = opts.a || opts.f; const almost = opts.A;
  const { uname, gname } = maps(ctx);
  const now = ctx.now();
  const fs = ctx.fs;
  const targets = rest.length ? rest : ['.'];
  let code = 0;
  const info = (dir, name) => {
    const p = dir === null ? ctx.abs(name) : posix.join(dir, name);
    const st = fs.lstat(p);
    return { name, p, st };
  };
  const decorate = (e) => {
    let n = e.name;
    if (opts.F) { if (e.st.type === 'dir') n += '/'; else if (e.st.type === 'link') n += '@'; else if (e.st.mode & 0o111) n += '*'; }
    return n;
  };
  const sortEntries = (es) => {
    es.sort((a, b) => collate(a.name, b.name));
    if (opts.S) es.sort((a, b) => b.st.size - a.st.size);
    if (opts.t) es.sort((a, b) => b.st.mtime - a.st.mtime);
    if (opts.r) es.reverse();
    if (opts.gdf) es.sort((a, b) => (b.st.type === 'dir') - (a.st.type === 'dir'));
    return es;
  };
  const render = (es, tag) => {
    if (long) {
      const rows = es.map((e) => {
        const st = e.st;
        let name = color ? lsColor(st, e.name) : e.name;
        name = (opts.F ? decorate({ ...e, name }) : name);
        if (st.type === 'link') { let t = st.target; let tn = t; if (color) { try { tn = lsColor(fs.stat(posix.normalize(t, posix.dirname(e.p))), t); } catch { tn = `\u001b[40;31;01m${t}\u001b[0m`; } } name += ` -> ${tn}`; }
        const sz = opts.h ? humanSize(st.size) : String(st.size);
        return [opts.i ? String(st.ino) : '', modeToString(st.mode, st.type === 'dir' ? 'd' : st.type === 'link' ? 'l' : 'f'), String(st.nlink), opts.g ? null : uname(st.uid), opts.G ? null : gname(st.gid), sz, fmtLsDate(st.mtime, now), name];
      });
      const w = [0, 1, 2, 3, 4, 5].map((i) => Math.max(...rows.map((r) => (r[i] ?? '').length), 0));
      if (tag !== 'files') ctx.out(`total ${es.reduce((a, e) => a + Math.ceil(e.st.size / 4096) * 4, 0)}\n`);
      for (const r of rows) {
        const cols = [];
        if (opts.i) cols.push(r[0].padStart(w[0]));
        cols.push(r[1], r[2].padStart(w[2]));
        if (r[3] !== null) cols.push(r[3].padEnd(w[3]));
        if (r[4] !== null) cols.push(r[4].padEnd(w[4]));
        cols.push(r[5].padStart(w[5]), r[6], r[7]);
        ctx.out(cols.join(' ') + '\n');
      }
      return;
    }
    const names = es.map((e) => ({ plain: decorate(e), shown: color ? decorate({ ...e, name: lsColor(e.st, e.name) }) : decorate(e) }));
    if (!ctx.tty || opts[1]) { for (const n of names) ctx.out(n.shown + '\n'); return; }
    if (!names.length) return;
    const width = ctx.cols; const lens = names.map((n) => [...quoteName(n.plain)].length);
    let ncols = Math.min(names.length, Math.max(1, Math.floor(width / 3)));
    let layout;
    for (; ncols >= 1; ncols--) {
      const nrows = Math.ceil(names.length / ncols); const colw = [];
      for (let c = 0; c < ncols; c++) { let m = 0; for (let r = 0; r < nrows; r++) { const i = c * nrows + r; if (i < names.length) m = Math.max(m, lens[i]); } colw.push(m); }
      const total = colw.reduce((a, b) => a + b, 0) + 2 * (ncols - 1);
      if (total <= width || ncols === 1) { layout = { nrows, colw }; break; }
    }
    for (let r = 0; r < layout.nrows; r++) {
      let line = '';
      for (let c = 0; c * layout.nrows + r < names.length; c++) {
        const i = c * layout.nrows + r; const last = (c + 1) * layout.nrows + r >= names.length;
        const q = quoteName(names[i].plain); const shown = q === names[i].plain ? names[i].shown : q;
        line += last ? shown : shown + ' '.repeat(layout.colw[c] - lens[i] + 2);
      }
      ctx.out(line + '\n');
    }
  };
  const listDir = (path, label, header) => {
    let names;
    try { names = fs.readdir(path); } catch (e) { if (e instanceof FsError) { ctx.err(`ls: cannot open directory '${label}': ${e.text}\n`); code = 2; return; } throw e; }
    if (showAll) names = ['.', '..', ...names]; else if (!almost) names = names.filter((n) => !n.startsWith('.'));
    else names = names.filter((n) => n !== '.' && n !== '..');
    if (almost) names = names.filter((n) => true);
    if (!showAll && !almost) names = names.filter((n) => !n.startsWith('.'));
    if (header) ctx.out(`${label}:\n`);
    let es;
    try { es = names.map((n) => info(path, n)); } catch (e) { es = []; for (const n of names) { try { es.push(info(path, n)); } catch { /* skip */ } } }
    render(sortEntries(es), 'dir');
    if (opts.R) for (const e of es) if (e.st.type === 'dir' && e.name !== '.' && e.name !== '..') { ctx.out('\n'); listDir(e.p, `${label === '.' ? '.' : label}/${e.name}`, true); }
  };
  const files = []; const dirs = [];
  for (const t of targets) {
    try {
      const e = info(null, t);
      let isDir = e.st.type === 'dir';
      if (e.st.type === 'link' && !long && !opts.d) { try { isDir = fs.stat(e.p).type === 'dir'; } catch { /* dangling */ } }
      if (isDir && !opts.d) dirs.push({ t, e }); else files.push({ t, e: { ...e, name: t } });
    } catch (e) { if (e instanceof FsError) { ctx.err(`ls: cannot access '${t}': ${e.text}\n`); code = 2; } else throw e; }
  }
  if (files.length) { render(sortEntries(files.map((f) => f.e)), 'files'); if (dirs.length) ctx.out('\n'); }
  dirs.sort((a, b) => collate(a.t, b.t));
  dirs.forEach((d, i) => { if (i > 0) ctx.out('\n'); listDir(d.e.p, d.t, targets.length > 1 || opts.R); });
  return code;
});
def('dir', (ctx) => ctx.exec(['ls', ...ctx.args]));
def('vdir', (ctx) => ctx.exec(['ls', '-l', ...ctx.args]));

// ------------------------------------------------------------------ cat / head / tail / wc / tee
def('cat', (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'nAbsvET', long: { 'number': 'n' } });
  let n = 0;
  return eachInput(ctx, rest, (t, label) => {
    void label;
    if (!opts.n && !opts.b && !opts.A && !opts.E) { ctx.out(t); return; }
    const ls = t.split('\n'); if (ls[ls.length - 1] === '') ls.pop();
    for (const l of ls) { n++; ctx.out(`${opts.n || opts.b ? String(n).padStart(6) + '\t' : ''}${l}${opts.E || opts.A ? '$' : ''}\n`); }
  });
});
def('tac', (ctx) => eachInput(ctx, ctx.args.filter((a) => !a.startsWith('-')), (t) => ctx.out(lines(t).reverse().join('\n') + '\n')));
def('head', (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'qv', withArg: 'nc', numeric: true });
  const n = opts.num ?? (opts.n !== undefined ? Number(opts.n) : 10);
  const multi = rest.length > 1 && !opts.q;
  return eachInput(ctx, rest, (t, f) => { if (multi) ctx.out(`==> ${f} <==\n`); if (opts.c) ctx.out(t.slice(0, Number(opts.c))); else { const l = lines(t); ctx.out((n < 0 ? l.slice(0, n) : l.slice(0, n)).map((x) => x + '\n').join('')); } });
});
def('tail', (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'qvf', withArg: 'nc', numeric: true });
  let spec = opts.n !== undefined ? String(opts.n) : opts.num !== undefined ? String(opts.num) : '10';
  const multi = rest.length > 1 && !opts.q;
  return eachInput(ctx, rest, (t, f) => {
    if (multi) ctx.out(`==> ${f} <==\n`);
    const l = lines(t);
    ctx.out((spec.startsWith('+') ? l.slice(Number(spec.slice(1)) - 1) : l.slice(-Number(spec) || undefined)).map((x) => x + '\n').join(''));
  });
});
def('wc', (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'lwcmL' });
  const any = opts.l || opts.w || opts.c || opts.m;
  const rows = []; let code = 0;
  code = eachInput(ctx, rest, (t, f) => rows.push({ f: f === '-' && !rest.length ? '' : f, l: (t.match(/\n/g) || []).length, w: t.split(/\s+/).filter(Boolean).length, c: new TextEncoder().encode(t).length }));
  const total = rows.reduce((a, r) => ({ l: a.l + r.l, w: a.w + r.w, c: a.c + r.c }), { l: 0, w: 0, c: 0 });
  const all = rows.length > 1 ? [...rows, { ...total, f: 'total' }] : rows;
  const wd = rows.length === 1 && any && [opts.l, opts.w, opts.c].filter(Boolean).length === 1 ? 0 : Math.max(...all.map((r) => String(r.c).length), 1);
  for (const r of all) {
    const cols = [];
    if (!any || opts.l) cols.push(String(r.l).padStart(wd)); if (!any || opts.w) cols.push(String(r.w).padStart(wd)); if (!any || opts.c || opts.m) cols.push(String(r.c).padStart(wd));
    ctx.out(cols.join(' ') + (r.f ? ' ' + r.f : '') + '\n');
  }
  return code;
});
def('tee', (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'ai' });
  ctx.out(ctx.stdin);
  let code = 0;
  for (const f of rest) { try { ctx.fs.writeFile(ctx.abs(f), ctx.stdin, { append: !!opts.a, mode: 0o644 }); } catch (e) { if (e instanceof FsError) { ctx.err(`tee: ${f}: ${e.text}\n`); code = 1; } else throw e; } }
  return code;
});

// ------------------------------------------------------------------ create / remove / move
def('touch', (ctx) => {
  const { rest } = getopt(ctx, ctx.args, { flags: 'acm', withArg: 'dtr' });
  let code = 0;
  for (const f of rest) { try { ctx.fs.touch(ctx.abs(f)); } catch (e) { if (e instanceof FsError) { ctx.err(`touch: cannot touch '${f}': ${e.text}\n`); code = 1; } else throw e; } }
  return code;
});
def('mkdir', (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'pv', withArg: 'm', long: { parents: 'p', verbose: 'v' } });
  if (!rest.length) throw new CmdError("mkdir: missing operand\nTry 'mkdir --help' for more information.", 1);
  let code = 0;
  for (const d of rest) {
    try {
      const p = ctx.abs(d);
      if (opts.p) ctx.fs.vfs.mkdir(p, { parents: true, cred: ctx.cred, mode: opts.m ? parseInt(opts.m, 8) : 0o755 });
      else ctx.fs.mkdir(p, { mode: opts.m ? parseInt(opts.m, 8) : 0o755 });
      if (opts.v) ctx.out(`mkdir: created directory '${d}'\n`);
    } catch (e) { if (e instanceof FsError) { ctx.err(`mkdir: cannot create directory '${d}': ${e.text}\n`); code = 1; } else throw e; }
  }
  return code;
});
def('rmdir', (ctx) => {
  let code = 0;
  for (const d of ctx.args.filter((a) => !a.startsWith('-'))) { try { ctx.fs.rmdir(ctx.abs(d)); } catch (e) { if (e instanceof FsError) { ctx.err(`rmdir: failed to remove '${d}': ${e.text}\n`); code = 1; } else throw e; } }
  return code;
});
def('rm', (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'rRfvidI', long: { recursive: 'r', force: 'f', verbose: 'v', 'no-preserve-root': 'npr', dir: 'd' } });
  const rec = opts.r || opts.R;
  if (!rest.length && !opts.f) throw new CmdError("rm: missing operand\nTry 'rm --help' for more information.", 1);
  let code = 0;
  const rm = (p, shown) => {
    const node = ctx.fs.vfs.lookup(p, { follow: false, cred: ctx.cred });
    if (!node) { if (!opts.f) { ctx.err(`rm: cannot remove '${shown}': No such file or directory\n`); code = 1; } return; }
    if (node.t === 'd') {
      if (!rec && !opts.d) { ctx.err(`rm: cannot remove '${shown}': Is a directory\n`); code = 1; return; }
      if (rec) { for (const n of ctx.fs.readdir(p)) rm(posix.join(p, n), `${shown}/${n}`); }
      ctx.fs.rmdir(p);
    } else ctx.fs.unlink(p);
    if (opts.v) ctx.out(`${node.t === 'd' ? "removed directory" : 'removed'} '${shown}'\n`);
  };
  for (const f of rest) {
    const p = ctx.abs(f);
    if (p === '/' && rec && !opts.npr) { ctx.err("rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe\n"); return 1; }
    if (/(^|\/)\.\.?$/.test(f)) { ctx.err(`rm: refusing to remove '.' or '..' directory: skipping '${f}'\n`); code = 1; continue; }
    try { rm(p, f); } catch (e) { if (e instanceof FsError) { ctx.err(`rm: cannot remove '${f}': ${e.text}\n`); code = 1; } else throw e; }
  }
  return code;
});
def('unlink', (ctx) => { try { ctx.fs.unlink(ctx.abs(ctx.args[0])); } catch (e) { ctx.err(`unlink: cannot unlink '${ctx.args[0]}': ${e.text}\n`); return 1; } });

function copyMove(ctx, move) {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'rRafvinpTu', long: { recursive: 'r', force: 'f', verbose: 'v', archive: 'a', 'no-clobber': 'n', interactive: 'i' }, withArg: 't' });
  const cmd = ctx.name;
  let srcs; let dst;
  if (opts.t) { dst = opts.t; srcs = rest; } else { if (rest.length < 2) throw new CmdError(rest.length ? `${cmd}: missing destination file operand after '${rest[0]}'\nTry '${cmd} --help' for more information.` : `${cmd}: missing file operand\nTry '${cmd} --help' for more information.`, 1); dst = rest[rest.length - 1]; srcs = rest.slice(0, -1); }
  const dp = ctx.abs(dst);
  const dstIsDir = ctx.fs.exists(dp) && ctx.fs.isDir(dp);
  if (srcs.length > 1 && !dstIsDir) throw new CmdError(`${cmd}: target '${dst}' is not a directory`, 1);
  let code = 0;
  for (const s of srcs) {
    const sp = ctx.abs(s);
    try {
      if (!ctx.sys.vfs.lookup(sp, { follow: false })) { ctx.err(`${cmd}: cannot stat '${s}': No such file or directory\n`); code = 1; continue; }
      const target = dstIsDir ? posix.join(dp, posix.basename(sp)) : dp;
      if (opts.n && ctx.fs.exists(target)) continue;
      if (move) ctx.fs.rename(sp, target);
      else ctx.fs.copy(sp, target, { recursive: !!(opts.r || opts.R || opts.a), preserve: !!(opts.a || opts.p) });
      if (opts.v) ctx.out(`${move ? 'renamed' : ''}${move ? ' ' : ''}'${s}' -> '${dstIsDir ? posix.join(dst, posix.basename(sp)) : dst}'\n`);
    } catch (e) {
      if (e instanceof FsError) { const what = e.code === 'EISDIR' && !move ? `-r not specified; omitting directory '${s}'` : move ? `cannot move '${s}' to '${dst}': ${e.text}` : `cannot create regular file '${dst}': ${e.text}`; ctx.err(`${cmd}: ${what}\n`); code = 1; } else throw e;
    }
  }
  return code;
}
def('cp', (ctx) => copyMove(ctx, false));
def('mv', (ctx) => copyMove(ctx, true));
def('ln', (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'sfv' });
  if (rest.length < 2) throw new CmdError("ln: missing file operand", 1);
  let [t, l] = rest; let lp = ctx.abs(l);
  if (ctx.fs.isDir(lp)) lp = posix.join(lp, posix.basename(t));
  try {
    if (opts.f && ctx.sys.vfs.lookup(lp, { follow: false })) ctx.fs.unlink(lp);
    if (opts.s) ctx.fs.symlink(t, lp); else ctx.fs.copy(ctx.abs(t), lp);
  } catch (e) { if (e instanceof FsError) { ctx.err(`ln: failed to create ${opts.s ? 'symbolic ' : 'hard '}link '${l}': ${e.text}\n`); return 1; } throw e; }
});

// ------------------------------------------------------------------ chmod / chown / chgrp
export function applyChmod(spec, cur, isDir) {
  if (/^[0-7]{1,4}$/.test(spec)) return parseInt(spec, 8);
  let mode = cur & 0o7777;
  for (const clause of spec.split(',')) {
    const m = /^([ugoa]*)([-+=])([rwxXst]*|[ugo])$/.exec(clause);
    if (!m) return null;
    const who = m[1] || 'a'; const op = m[2]; let bits = 0;
    const perms = m[3];
    const mask = (r, w, x) => (r ? 4 : 0) | (w ? 2 : 0) | (x ? 1 : 0);
    let p;
    if (/^[ugo]$/.test(perms)) { const sh = { u: 6, g: 3, o: 0 }[perms]; p = (cur >> sh) & 7; }
    else p = mask(perms.includes('r'), perms.includes('w'), perms.includes('x') || (perms.includes('X') && (isDir || (cur & 0o111) !== 0)));
    const targets = who.includes('a') ? ['u', 'g', 'o'] : who.split('');
    for (const t of targets) bits |= p << { u: 6, g: 3, o: 0 }[t];
    let special = 0;
    if (perms.includes('s')) { if (targets.includes('u')) special |= 0o4000; if (targets.includes('g')) special |= 0o2000; }
    if (perms.includes('t')) special |= 0o1000;
    const all = bits | special;
    let clear = 0; for (const t of targets) clear |= 7 << { u: 6, g: 3, o: 0 }[t];
    if (op === '+') mode |= all; else if (op === '-') mode &= ~all; else { mode = (mode & ~clear) | all; }
  }
  return mode;
}
def('chmod', (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args.map((a) => (/^-[rwxXst]+/.test(a) || /^-[ugoa]/.test(a) ? ' ' + a : a)), { flags: 'Rvcf', long: { recursive: 'R', verbose: 'v' } });
  rest.forEach((r, i) => { rest[i] = r.replace(/^ /, ''); });
  if (rest.length < 2) throw new CmdError(rest.length ? `chmod: missing operand after '${rest[0]}'\nTry 'chmod --help' for more information.` : "chmod: missing operand\nTry 'chmod --help' for more information.", 1);
  const [spec, ...files] = rest; let code = 0;
  const one = (p, shown) => {
    const st = ctx.sys.vfs.stat(p, { follow: true, cred: ctx.cred });
    const m = applyChmod(spec, st.mode, st.type === 'dir');
    if (m === null) throw new CmdError(`chmod: invalid mode: '${spec}'\nTry 'chmod --help' for more information.`, 1);
    ctx.fs.chmod(p, m);
    if (opts.v) ctx.out(`mode of '${shown}' changed from ${(st.mode & 0o7777).toString(8).padStart(4, '0')} (${modeToString(st.mode, st.type === 'dir' ? 'd' : 'f').slice(1)}) to ${m.toString(8).padStart(4, '0')} (${modeToString(m, st.type === 'dir' ? 'd' : 'f').slice(1)})\n`);
  };
  for (const f of files) {
    const p = ctx.abs(f);
    try {
      if (!ctx.sys.vfs.exists(p)) { ctx.err(`chmod: cannot access '${f}': No such file or directory\n`); code = 1; continue; }
      one(p, f);
      if (opts.R && ctx.fs.isDir(p)) for (const [q, n] of ctx.sys.vfs.walk(p)) if (q !== p && n.t !== 'l') one(q, q);
    } catch (e) { if (e instanceof FsError) { ctx.err(`chmod: changing permissions of '${f}': ${e.text}\n`); code = 1; } else throw e; }
  }
  return code;
});
function chownLike(ctx, group) {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'Rvhf', long: { recursive: 'R' } });
  if (rest.length < 2) throw new CmdError(`${ctx.name}: missing operand${rest.length ? ` after '${rest[0]}'` : ''}\nTry '${ctx.name} --help' for more information.`, 1);
  const [spec, ...files] = rest;
  let u = null; let g = null;
  if (group) g = spec; else { const [a, b] = spec.split(/[:.]/); u = a || null; g = b === undefined ? null : b; if (g === '' ) { const usr = users.getUser(ctx.sys, u); g = usr ? String(usr.gid) : null; } }
  let uid = null; let gid = null;
  if (u !== null) { const e = /^\d+$/.test(u) ? { uid: Number(u) } : users.getUser(ctx.sys, u); if (!e) throw new CmdError(`${ctx.name}: invalid user: '${spec}'`, 1); uid = e.uid; }
  if (g !== null) { const e = /^\d+$/.test(g) ? { gid: Number(g) } : users.getGroup(ctx.sys, g); if (!e) throw new CmdError(`${ctx.name}: invalid group: '${spec}'`, 1); gid = e.gid; }
  let code = 0;
  for (const f of files) {
    const p = ctx.abs(f);
    try {
      if (!ctx.sys.vfs.lookup(p, { follow: false })) { ctx.err(`${ctx.name}: cannot access '${f}': No such file or directory\n`); code = 1; continue; }
      const list = opts.R ? [...ctx.sys.vfs.walk(p)].map((x) => x[0]) : [p];
      for (const q of list) ctx.fs.chown(q, uid, gid, { follow: false });
    } catch (e) { if (e instanceof FsError) { ctx.err(`${ctx.name}: changing ownership of '${f}': ${e.text}\n`); code = 1; } else throw e; }
  }
  return code;
}
def('chown', (ctx) => chownLike(ctx, false));
def('chgrp', (ctx) => chownLike(ctx, true));

// ------------------------------------------------------------------ stat / file / du / df
def('stat', (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'L', withArg: 'c', long: { format: ['c', true], 'dereference': 'L' } });
  const { uname, gname } = maps(ctx); let code = 0;
  for (const f of rest) {
    try {
      const st = opts.L ? ctx.fs.stat(ctx.abs(f)) : ctx.fs.lstat(ctx.abs(f));
      if (opts.c) {
        ctx.out(opts.c.replace(/%([a-zA-Z%])/g, (m, c) => ({ n: f, s: st.size, a: (st.mode & 0o7777).toString(8), A: modeToString(st.mode, st.type === 'dir' ? 'd' : 'f'), U: uname(st.uid), G: gname(st.gid), u: st.uid, g: st.gid, F: st.type === 'dir' ? 'directory' : st.type === 'link' ? 'symbolic link' : st.size ? 'regular file' : 'regular empty file', Y: Math.floor(st.mtime / 1000), '%': '%' }[c] ?? m)) + '\n');
        continue;
      }
      const kind = st.type === 'dir' ? 'directory' : st.type === 'link' ? 'symbolic link' : st.size ? 'regular file' : 'regular empty file';
      const t = fmtIso(st.mtime);
      ctx.out(`  File: ${f}${st.type === 'link' ? ` -> ${st.target}` : ''}\n  Size: ${String(st.size).padEnd(10)}\tBlocks: ${String(Math.ceil(st.size / 512)).padEnd(10)} IO Block: 4096   ${kind}\nDevice: 801h/2049d\tInode: ${String(st.ino).padEnd(10)} Links: ${st.nlink}\nAccess: (${(st.mode & 0o7777).toString(8).padStart(4, '0')}/${modeToString(st.mode, st.type === 'dir' ? 'd' : st.type === 'link' ? 'l' : 'f')})  Uid: (${String(st.uid).padStart(5)}/${uname(st.uid).padStart(8)})   Gid: (${String(st.gid).padStart(5)}/${gname(st.gid).padStart(8)})\nAccess: ${t}\nModify: ${t}\nChange: ${t}\n Birth: -\n`);
    } catch (e) { if (e instanceof FsError) { ctx.err(`stat: cannot statx '${f}': ${e.text}\n`); code = 1; } else throw e; }
  }
  return code;
});
def('file', (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'bi' });
  let code = 0;
  for (const f of rest) {
    try {
      const st = ctx.fs.lstat(ctx.abs(f)); let d;
      if (st.type === 'dir') d = 'directory';
      else if (st.type === 'link') d = `symbolic link to ${st.target}`;
      else { const t = ctx.fs.readFile(ctx.abs(f)); d = st.size === 0 ? 'empty' : t.startsWith('\u007fELF') ? 'ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV), dynamically linked, stripped' : t.startsWith('ID3') ? 'Audio file with ID3 version 2.3.0, contains: MPEG ADTS, layer III, v1, 128 kbps, 44.1 kHz, Stereo' : /ftypmp4|ftypisom/.test(t.slice(0, 16)) ? 'ISO Media, MP4 v2 [ISO 14496-14]' : t.startsWith('\u00ff\u00d8') ? 'JPEG image data, JFIF standard 1.01' : t.startsWith('#!') ? `${/python/.test(t.split('\n')[0]) ? 'Python script' : 'POSIX shell script'}, ASCII text executable` : /[^\x09\x0a\x0d\x20-\x7e]/.test(t) ? 'UTF-8 Unicode text' : 'ASCII text'; }
      ctx.out(opts.b ? d + '\n' : `${f}: ${d}\n`);
    } catch (e) { if (e instanceof FsError) { ctx.out(`${f}: cannot open \`${f}' (${e.text})\n`); code = 1; } else throw e; }
  }
  return code;
});
function duSize(ctx, p) { let t = 0; for (const [, n] of ctx.sys.vfs.walk(p)) t += n.t === 'd' ? 4096 : Math.ceil(ctx.sys.vfs.sizeOf(n) / 4096) * 4096; return t; }
def('du', (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'shackxd', withArg: 'd', long: { 'human-readable': 'h', summarize: 's' } });
  const fmt = (b) => (opts.h ? humanSize(b) : String(Math.ceil(b / 1024)));
  for (const f of rest.length ? rest : ['.']) {
    const p = ctx.abs(f);
    if (!ctx.sys.vfs.exists(p)) { ctx.err(`du: cannot access '${f}': No such file or directory\n`); continue; }
    if (opts.s || !ctx.fs.isDir(p)) { ctx.out(`${fmt(duSize(ctx, p))}\t${f}\n`); continue; }
    const rec = (q, shown) => { for (const n of ctx.fs.readdir(q).sort()) { const c = posix.join(q, n); if (ctx.sys.vfs.lookup(c, { follow: false }).t === 'd') rec(c, `${shown}/${n}`); else if (opts.a) ctx.out(`${fmt(duSize(ctx, c))}\t${shown}/${n}\n`); } ctx.out(`${fmt(duSize(ctx, q))}\t${shown}\n`); };
    rec(p, f);
  }
});
def('df', (ctx) => {
  const { opts } = getopt(ctx, ctx.args, { flags: 'hTiaPkl', long: { 'human-readable': 'h' } });
  const rows = [['/dev/sda1', '49G', '17G', '30G', '36%', '/'], ['tmpfs', '2.0G', '0', '2.0G', '0%', '/dev/shm'], ['tmpfs', '393M', '2.3M', '391M', '1%', '/run'], ['/dev/sda15', '105M', '6.1M', '99M', '6%', '/boot/efi']];
  const kb = (s) => { const n = parseFloat(s); const m = /[KMGT]/.exec(s)?.[0]; return Math.round(n * { K: 1, M: 1024, G: 1048576, T: 1073741824 }[m || 'K']); };
  ctx.out(`${'Filesystem'.padEnd(14)}${opts.h ? '  Size  Used Avail Use%' : '1K-blocks     Used Available Use%'} Mounted on\n`);
  for (const r of rows) ctx.out(`${r[0].padEnd(14)}${opts.h ? `${r[1].padStart(6)}${r[2].padStart(6)}${r[3].padStart(6)}${r[4].padStart(5)}` : `${String(kb(r[1])).padStart(9)}${String(kb(r[2])).padStart(9)}${String(kb(r[3])).padStart(10)}${r[4].padStart(5)}`} ${r[5]}\n`);
});

// ------------------------------------------------------------------ find
function parseFindExpr(ctx, toks, now) {
  let i = 0;
  const peek = () => toks[i];
  const prim = () => {
    const t = toks[i++];
    if (t === '(') { const e = or(); i++; return e; }
    if (t === '!' || t === '-not') { const e = prim(); return (n) => !e(n); }
    const arg = () => toks[i++];
    const cmp = (v, f) => { const m = /^([+-]?)(\d+)$/.exec(v); const n = Number(m?.[2] ?? 0); return m?.[1] === '+' ? (x) => f(x) > n : m?.[1] === '-' ? (x) => f(x) < n : (x) => f(x) === n; };
    switch (t) {
      case '-name': { const re = globToRegex(arg()); return (n) => re.test(n.name); }
      case '-iname': { const re = new RegExp(globToRegex(arg()).source, 'i'); return (n) => re.test(n.name); }
      case '-path': case '-wholename': { const re = globToRegex(arg()); return (n) => re.test(n.path); }
      case '-regex': { const re = new RegExp(`^${arg()}$`); return (n) => re.test(n.path); }
      case '-type': { const c = arg(); return (n) => ({ f: 'file', d: 'dir', l: 'link' }[c] === n.st.type); }
      case '-user': { const u = arg(); const e = users.getUser(ctx.sys, u) || users.getUserByUid(ctx.sys, Number(u)); return (n) => !!e && n.st.uid === e.uid; }
      case '-group': { const g = arg(); const e = users.getGroup(ctx.sys, g); return (n) => !!e && n.st.gid === e.gid; }
      case '-uid': { const u = Number(arg()); return (n) => n.st.uid === u; }
      case '-nouser': return (n) => !users.getUserByUid(ctx.sys, n.st.uid);
      case '-nogroup': return (n) => !users.getGroupByGid(ctx.sys, n.st.gid);
      case '-perm': { const v = arg(); const pre = /^[-/]/.test(v) ? v[0] : ''; const want = parseInt(v.replace(/^[-/]/, ''), 8); return (n) => { const m = n.st.mode & 0o7777; return pre === '-' ? (m & want) === want : pre === '/' ? (m & want) !== 0 : m === want; }; }
      case '-mtime': { const f = cmp(arg(), (x) => Math.floor((now - x.st.mtime) / 86400000)); return f; }
      case '-mmin': { return cmp(arg(), (x) => Math.floor((now - x.st.mtime) / 60000)); }
      case '-size': { const v = arg(); const m = /^([+-]?)(\d+)([cwbkMG]?)$/.exec(v) || []; const unit = { c: 1, w: 2, b: 512, k: 1024, M: 1048576, G: 1073741824, '': 512 }[m[3] ?? '']; const num = Number(m[2]); return (n) => { const s = Math.ceil(n.st.size / unit); return m[1] === '+' ? s > num : m[1] === '-' ? s < num : s === num; }; }
      case '-empty': return (n) => (n.st.type === 'dir' ? ctx.sys.vfs.readdir(n.path).length === 0 : n.st.size === 0);
      case '-readable': case '-writable': case '-executable': return () => true;
      case '-print': return (n) => { ctx.out(n.path + '\n'); return true; };
      case '-print0': return (n) => { ctx.out(n.path + '\0'); return true; };
      case '-true': return () => true;
      case '-delete': return (n) => { try { if (n.st.type === 'dir') ctx.fs.rmdir(n.path); else ctx.fs.unlink(n.path); } catch (e) { if (e instanceof FsError) ctx.err(`find: cannot delete '${n.path}': ${e.text}\n`); } return true; };
      case '-ls': return (n) => { ctx.out(`${n.st.ino} ${modeToString(n.st.mode, n.st.type === 'dir' ? 'd' : 'f')} ${n.st.size} ${n.path}\n`); return true; };
      case '-exec': case '-ok': {
        const cmd = []; while (toks[i] !== ';' && toks[i] !== '+' && i < toks.length) cmd.push(toks[i++]);
        const plus = toks[i++] === '+';
        if (plus) { const bag = []; ctx._findPlus = ctx._findPlus || []; ctx._findPlus.push({ cmd, bag }); return (n) => { bag.push(n.path); return true; }; }
        return (n) => { const argv = cmd.map((c) => c.replace(/\{\}/g, n.path)); ctx.exec(argv, { out: { write: ctx.out }, err: { write: ctx.err } }); return true; };
      }
      default: throw new CmdError(`find: unknown predicate \`${t}'`, 1);
    }
  };
  const and = () => { let l = prim(); while (i < toks.length && peek() !== '-o' && peek() !== ')') { if (peek() === '-a' || peek() === '-and') i++; const r = prim(); const ll = l; l = (n) => ll(n) && r(n); } return l; };
  const or = () => { let l = and(); while (peek() === '-o' || peek() === '-or') { i++; const r = and(); const ll = l; l = (n) => ll(n) || r(n); } return l; };
  const e = toks.length ? or() : () => true;
  return { expr: e, hasAction: toks.some((t) => ['-print', '-exec', '-delete', '-ls', '-print0', '-ok'].includes(t)) };
}
def('find', async (ctx) => {
  const a = [...ctx.args]; const starts = [];
  while (a.length && !a[0].startsWith('-') && a[0] !== '!' && a[0] !== '(') starts.push(a.shift());
  let maxd = Infinity; let mind = 0; const exprToks = [];
  for (let i = 0; i < a.length; i++) { if (a[i] === '-maxdepth') maxd = Number(a[++i]); else if (a[i] === '-mindepth') mind = Number(a[++i]); else if (['-xdev', '-mount', '-depth', '-follow'].includes(a[i])) continue; else exprToks.push(a[i]); }
  const now = ctx.now();
  const { expr, hasAction } = parseFindExpr(ctx, exprToks, now);
  let code = 0;
  const visit = (path, shown, depth) => {
    let node; try { node = ctx.sys.vfs.lookup(path, { follow: false, cred: ctx.cred }); } catch (e) { if (e instanceof FsError) { ctx.err(`find: ‘${shown}’: ${e.text}\n`); code = 1; return; } throw e; }
    if (!node) { ctx.err(`find: ‘${shown}’: No such file or directory\n`); code = 1; return; }
    const st = ctx.sys.vfs.statNode(node, path);
    if (depth >= mind) { const ent = { name: posix.basename(path) === '/' ? '/' : (shown.endsWith('/') && shown !== '/' ? posix.basename(shown.slice(0, -1)) : posix.basename(shown)), path: shown, st }; ent.path = shown; const real = { ...ent, path: shown }; const m = expr({ ...real, path: shown }); if (m && !hasAction) ctx.out(shown + '\n'); }
    if (node.t === 'd' && depth < maxd) {
      let names;
      try { names = ctx.fs.readdir(path); } catch (e) { if (e instanceof FsError) { ctx.err(`find: ‘${shown}’: ${e.text}\n`); code = 1; return; } throw e; }
      for (const n of names.sort()) visit(posix.join(path, n), shown === '/' ? `/${n}` : `${shown.replace(/\/$/, '')}/${n}`, depth + 1);
    }
  };
  for (const s of starts.length ? starts : ['.']) visit(ctx.abs(s), s, 0);
  for (const g of ctx._findPlus || []) if (g.bag.length) await ctx.exec([...g.cmd.filter((c) => c !== '{}'), ...g.bag], { out: { write: ctx.out }, err: { write: ctx.err } });
  return code;
});
def(['locate', 'mlocate'], (ctx) => {
  const pats = ctx.args.filter((a) => !a.startsWith('-')); let found = false;
  for (const [p] of ctx.sys.vfs.walk('/')) for (const pat of pats) if (p.toLowerCase().includes(pat.replace(/\*/g, '').toLowerCase())) { ctx.out(p + '\n'); found = true; }
  return found ? 0 : 1;
}, { bin: '/usr/bin/locate' });
def('updatedb', (ctx) => { if (ctx.uid !== 0) throw new CmdError('updatedb: can not open a temporary file for `/var/lib/mlocate/mlocate.db\'', 1); });

// ------------------------------------------------------------------ checksums, base64, misc
def('base64', (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'd', withArg: 'w', long: { decode: 'd' } });
  return eachInput(ctx, rest, (t) => {
    if (opts.d) { try { ctx.out(decodeURIComponent(escape(atob(t.replace(/\s+/g, ''))))); } catch { ctx.err('base64: invalid input\n'); } return; }
    const b = btoa(unescape(encodeURIComponent(t))); const w = opts.w === undefined ? 76 : Number(opts.w);
    ctx.out(w ? b.replace(new RegExp(`(.{${w}})`, 'g'), '$1\n').replace(/\n?$/, '\n') : b + '\n');
  });
});
def(['sha256sum', 'md5sum', 'sha1sum'], (ctx) => eachInput(ctx, ctx.args.filter((a) => !a.startsWith('-')), (t, f) => ctx.out(`${ctx.name === 'sha256sum' ? sha256hex(t) : ctx.name === 'md5sum' ? md5ish(t) : sha256hex('sha1:' + t).slice(0, 40)}  ${f}\n`)));
def('mktemp', (ctx) => { const dir = ctx.args.includes('-d'); const p = `/tmp/tmp.${Math.random().toString(36).slice(2, 12)}`; if (dir) ctx.fs.mkdir(p, { mode: 0o700 }); else ctx.fs.writeFile(p, '', { mode: 0o600 }); ctx.out(p + '\n'); });
def('tree', (ctx) => {
  const root = ctx.abs(ctx.args.find((a) => !a.startsWith('-')) || '.'); let d = 0; let f = 0;
  const rec = (p, prefix) => { const names = ctx.fs.readdir(p).filter((n) => !n.startsWith('.')).sort(); names.forEach((n, i) => { const last = i === names.length - 1; ctx.out(`${prefix}${last ? '└── ' : '├── '}${n}\n`); const c = posix.join(p, n); if (ctx.sys.vfs.lookup(c, { follow: false }).t === 'd') { d++; rec(c, prefix + (last ? '    ' : '│   ')); } else f++; }); };
  ctx.out((ctx.args.find((a) => !a.startsWith('-')) || '.') + '\n'); rec(root, ''); ctx.out(`\n${d} directories, ${f} files\n`);
}, { bin: '/usr/bin/tree' });
