// Text processing: cat, head, tail, wc, grep, sed, awk, cut, sort, uniq, tr, tee, xargs, ...
import { cmd, parseOpts, usageError } from '../registry.js';
import { FsError } from '../../core/vfs.js';
import { sha256hex, md5ish, posix } from '../../core/util.js';
import { formatPrintf } from './builtins.js';

// ---------------------------------------------------------------- regex translation (POSIX BRE/ERE -> JS)
const CLASSES = { alpha: 'a-zA-Z', digit: '0-9', alnum: 'a-zA-Z0-9', upper: 'A-Z', lower: 'a-z', space: '\\s', blank: ' \\t', punct: '!-\\/:-@\\[-`{-~', xdigit: '0-9a-fA-F', word: '\\w' };

export function posixRegex(pat, { ere = false, icase = false, word = false, line = false, flags = '' } = {}) {
  let out = '';
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === '[') {
      let j = i + 1;
      let cls = '[';
      if (pat[j] === '^') { cls += '^'; j++; }
      if (pat[j] === ']') { cls += '\\]'; j++; }
      for (; j < pat.length && pat[j] !== ']'; j++) {
        if (pat[j] === '[' && pat[j + 1] === ':') {
          const e = pat.indexOf(':]', j + 2);
          if (e > 0) { cls += CLASSES[pat.slice(j + 2, e)] || ''; j = e + 1; continue; }
        }
        cls += pat[j] === '\\' ? '\\\\' : pat[j] === '[' ? '\\[' : pat[j];
      }
      out += cls + ']'; i = j; continue;
    }
    if (c === '\\' && i + 1 < pat.length) {
      const d = pat[++i];
      if (!ere && '(){}|+?'.includes(d)) out += d;
      else if (d === '<' || d === '>') out += '\\b';
      else if ('wWsSbBdD'.includes(d)) out += '\\' + d;
      else if (/[0-9]/.test(d)) out += '\\' + d;
      else out += '\\' + d;
      continue;
    }
    if (!ere && '(){}|+?'.includes(c)) { out += '\\' + c; continue; }
    if (c === '*' && (out === '' || out.endsWith('(') && false)) { out += '\\*'; continue; }
    if (c === '{' && ere && !/^\{\d+(,\d*)?\}/.test(pat.slice(i))) { out += '\\{'; continue; }
    out += c;
  }
  if (word) out = `(?<![\\w])(?:${out})(?![\\w])`;
  if (line) out = `^(?:${out})$`;
  try { return new RegExp(out, (icase ? 'i' : '') + flags); } catch { return null; }
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------- file reading helper
export function readInput(ctx, path) {
  try { return { text: ctx.fs.readFile(ctx.resolve(path)) }; } catch (e) {
    if (e instanceof FsError) return { error: e.text };
    throw e;
  }
}
const lines = (t) => { const a = t.split('\n'); if (a[a.length - 1] === '') a.pop(); return a; };

// ---------------------------------------------------------------- cat / tac / rev / tee / head / tail / wc
cmd('cat', async (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'nAbEsTv', long: { number: 'n', 'show-all': 'A' } });
  if (err) return usageError(ctx, err);
  let rc = 0; let n = 0;
  const emit = (t) => {
    if (o.n || o.b || o.A || o.E) {
      const ls = t.split('\n'); const trail = ls[ls.length - 1] === ''; if (trail) ls.pop();
      ctx.out(ls.map((l) => { const body = (o.A || o.E) ? l + '$' : l; if (o.b && l === '') return body; return o.n || o.b ? `${String(++n).padStart(6)}\t${body}` : body; }).join('\n') + (trail ? '\n' : ''));
    } else ctx.out(t);
  };
  if (!rest.length) { emit(await ctx.stdinText()); return 0; }
  for (const f of rest) {
    if (f === '-') { emit(ctx.readAll()); continue; }
    const r = readInput(ctx, f);
    if (r.error) { ctx.err(`cat: ${f}: ${r.error}\n`); rc = 1; } else emit(r.text);
  }
  return rc;
}, { usage: 'cat [OPTION]... [FILE]...' });

cmd('tac', async (ctx) => { const t = rest0(ctx) ?? (await ctx.stdinText()); ctx.out(lines(t).reverse().join('\n') + '\n'); return 0; });
cmd('rev', async (ctx) => { const t = rest0(ctx) ?? (await ctx.stdinText()); ctx.out(lines(t).map((l) => [...l].reverse().join('')).join('\n') + '\n'); return 0; });
function rest0(ctx) { const f = ctx.args.filter((a) => !a.startsWith('-'))[0]; if (!f) return null; const r = readInput(ctx, f); if (r.error) { ctx.err(`${ctx.name}: ${f}: ${r.error}\n`); return ''; } return r.text; }

cmd('tee', async (ctx) => {
  const { o, rest } = parseOpts(ctx.args, { bool: 'ai' });
  const text = await ctx.stdinText();
  ctx.out(text);
  let rc = 0;
  for (const f of rest) {
    try { ctx.fs.writeFile(ctx.resolve(f), text, { append: !!o.a }); } catch (e) { if (e instanceof FsError) { ctx.err(`tee: ${f}: ${e.text}\n`); rc = 1; } else throw e; }
  }
  return rc;
});

function headTail(ctx, isHead) {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'qvf', val: 'nc', num: true, long: { lines: { key: 'n', val: true }, bytes: { key: 'c', val: true }, quiet: 'q' } });
  if (err) return usageError(ctx, err);
  const spec = o.n ?? o.num ?? '10';
  const files = rest.length ? rest : [null];
  let rc = 0;
  files.forEach((f, idx) => {
    let text;
    if (f == null) text = ctx.readAll();
    else { const r = readInput(ctx, f); if (r.error) { ctx.err(`${ctx.name}: cannot open '${f}' for reading: ${r.error}\n`); rc = 1; return; } text = r.text; }
    if (files.length > 1 && !o.q) ctx.out(`${idx ? '\n' : ''}==> ${f ?? 'standard input'} <==\n`);
    if (o.c != null) { ctx.out(isHead ? text.slice(0, Number(o.c)) : text.slice(-Number(o.c))); return; }
    const ls = lines(text);
    const plus = String(spec).startsWith('+');
    const n = Math.abs(Number(String(spec).replace('+', '')));
    let sel;
    if (isHead) sel = String(spec).startsWith('-') ? ls.slice(0, Math.max(0, ls.length - n)) : ls.slice(0, n);
    else sel = plus ? ls.slice(n - 1) : ls.slice(Math.max(0, ls.length - n));
    if (sel.length) ctx.out(sel.join('\n') + '\n');
  });
  return rc;
}
cmd('head', (ctx) => headTail(ctx, true), { usage: 'head [OPTION]... [FILE]...' });
cmd('tail', (ctx) => headTail(ctx, false), { usage: 'tail [OPTION]... [FILE]...' });

cmd('wc', async (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'lwcmL' });
  if (err) return usageError(ctx, err);
  const all = !o.l && !o.w && !o.c && !o.m;
  const rows = [];
  let rc = 0;
  const count = (t) => ({ l: (t.match(/\n/g) || []).length, w: (t.trim() ? t.trim().split(/\s+/).length : 0), c: new TextEncoder().encode(t).length, m: [...t].length });
  if (!rest.length) rows.push([null, count(await ctx.stdinText())]);
  for (const f of rest) { const r = readInput(ctx, f); if (r.error) { ctx.err(`wc: ${f}: ${r.error}\n`); rc = 1; } else rows.push([f, count(r.text)]); }
  if (rest.length > 1) rows.push(['total', rows.reduce((a, [, c]) => ({ l: a.l + c.l, w: a.w + c.w, c: a.c + c.c, m: a.m + c.m }), { l: 0, w: 0, c: 0, m: 0 })]);
  const cols = all ? ['l', 'w', 'c'] : ['l', 'w', 'c', 'm'].filter((k) => o[k]);
  const width = Math.max(...rows.flatMap(([, c]) => cols.map((k) => String(c[k]).length)), 1);
  for (const [name, c] of rows) ctx.out(cols.map((k) => (cols.length === 1 && name == null ? String(c[k]) : String(c[k]).padStart(width))).join(' ') + (name != null ? ' ' + name : '') + '\n');
  return rc;
});

// ---------------------------------------------------------------- grep
cmd(['grep', 'egrep', 'fgrep', 'rgrep'], async (ctx) => {
  const args = [];
  const pats = [];
  for (let i = 0; i < ctx.args.length; i++) {
    const a = ctx.args[i];
    if (a === '-e' && i + 1 < ctx.args.length) { pats.push(ctx.args[++i]); continue; }
    if (a.startsWith('--regexp=')) { pats.push(a.slice(9)); continue; }
    args.push(a);
  }
  const { o, rest, err } = parseOpts(args, {
    bool: 'ivncrRlLEFPwxoqsHhzaI', val: 'ABCm', num: true,
    long: { 'ignore-case': 'i', 'invert-match': 'v', 'line-number': 'n', count: 'c', recursive: 'r', 'dereference-recursive': 'R', 'files-with-matches': 'l', 'files-without-match': 'L', 'extended-regexp': 'E', 'fixed-strings': 'F', 'perl-regexp': 'P', 'word-regexp': 'w', 'line-regexp': 'x', 'only-matching': 'o', quiet: 'q', silent: 'q', 'no-messages': 's', 'with-filename': 'H', 'no-filename': 'h', color: { key: 'color', val: true, optional: true }, colour: { key: 'color', val: true, optional: true }, include: { key: 'include', val: true }, exclude: { key: 'exclude', val: true }, 'exclude-dir': { key: 'exdir', val: true }, 'after-context': { key: 'A', val: true }, 'before-context': { key: 'B', val: true }, context: { key: 'C', val: true }, text: 'a', 'max-count': { key: 'm', val: true }, 'binary-files': { key: 'binfiles', val: true } },
  });
  if (err) { ctx.err(`grep: ${err}\nUsage: grep [OPTION]... PATTERNS [FILE]...\nTry 'grep --help' for more information.\n`); return 2; }
  const files = [...rest];
  if (!pats.length) { if (!files.length) { ctx.err("Usage: grep [OPTION]... PATTERNS [FILE]...\nTry 'grep --help' for more information.\n"); return 2; } pats.push(...files.shift().split('\n')); }
  const fixed = o.F || ctx.name === 'fgrep';
  const ere = o.E || o.P || ctx.name === 'egrep';
  const rec = o.r || o.R || ctx.name === 'rgrep';
  const res = pats.map((p) => (fixed ? new RegExp(escapeRe(p), o.i ? 'i' : '') : posixRegex(p, { ere, icase: !!o.i, word: !!o.w, line: !!o.x })));
  if (res.some((r) => !r)) { ctx.err('grep: Invalid regular expression\n'); return 2; }
  const color = o.color === 'always' || ((o.color === true || o.color === 'auto') && ctx.tty);
  const A = Number(o.A ?? o.C ?? o.num ?? 0); const B = Number(o.B ?? o.C ?? o.num ?? 0);
  const inc = o.include ? new RegExp('^' + escapeRe(o.include).replace(/\\\*/g, '.*').replace(/\\\?/g, '.') + '$') : null;
  const exc = o.exclude ? new RegExp('^' + escapeRe(o.exclude).replace(/\\\*/g, '.*').replace(/\\\?/g, '.') + '$') : null;

  // build the file list
  const targets = [];
  const addDir = (dir, shown) => {
    let names;
    try { names = ctx.fs.readdir(dir); } catch (e) { if (e instanceof FsError) { if (!o.s) ctx.err(`grep: ${shown}: ${e.text}\n`); return; } throw e; }
    for (const n of names.sort()) {
      const full = posix.join(dir, n); const sh = shown === '' ? n : `${shown.replace(/\/$/, '')}/${n}`;
      let st;
      try { st = ctx.fs.lstat(full); } catch { continue; }
      if (st.type === 'dir') { if (o.exdir && n === o.exdir) continue; addDir(full, sh); } else if (st.type === 'file' || (o.R && st.type === 'link')) targets.push([full, sh]);
    }
  };
  if (!files.length) { if (rec) addDir(ctx.cwd, ''); else targets.push([null, '(standard input)']); }
  for (const f of files) {
    const abs = ctx.resolve(f);
    let st = null;
    try { st = ctx.fs.stat(abs); } catch (e) { if (e instanceof FsError) { if (!o.s) ctx.err(`grep: ${f}: ${e.text}\n`); targets.push(null); continue; } throw e; }
    if (st.type === 'dir') { if (rec) addDir(abs, f); else { if (!o.s) ctx.err(`grep: ${f}: Is a directory\n`); } } else targets.push([abs, f]);
  }
  const showName = o.H || (!o.h && (files.length > 1 || rec));
  let any = false; let hadErr = files.length && targets.includes(null);
  const hl = (line) => {
    if (!color || o.v) return line;
    let r = line; const ranges = [];
    for (const re of res) { const g = new RegExp(re.source, re.flags + 'g'); let m; while ((m = g.exec(line))) { if (m[0] === '') { g.lastIndex++; continue; } ranges.push([m.index, m.index + m[0].length]); } }
    if (!ranges.length) return line;
    ranges.sort((a, b) => a[0] - b[0]);
    r = ''; let pos = 0;
    for (const [s, e] of ranges) { if (s < pos) continue; r += line.slice(pos, s) + '\u001b[01;31m\u001b[K' + line.slice(s, e) + '\u001b[m\u001b[K'; pos = e; }
    return r + line.slice(pos);
  };
  for (const t of targets) {
    if (!t) continue;
    const [abs, shown] = t;
    if (inc && !inc.test(posix.basename(shown))) continue;
    if (exc && exc.test(posix.basename(shown))) continue;
    let text;
    if (abs == null) text = ctx.stdin ? ctx.readAll() : await ctx.stdinText();
    else { const r = readInput(ctx, abs); if (r.error) { if (!o.s) ctx.err(`grep: ${shown}: ${r.error}\n`); hadErr = true; continue; } text = r.text; }
    if (!o.a && (text.includes('\u0000') || text.startsWith('\u007fELF')) ) {
      const m = lines(text).some((l) => (res.some((re) => re.test(l)) !== !!o.v));
      if (m) { any = true; if (!o.q && !o.c) ctx.out(`grep: ${shown}: binary file matches\n`); }
      continue;
    }
    const ls = lines(text);
    let count = 0; let last = -1; let printedAny = false;
    const prefix = (n, sep) => (showName ? (color ? `\u001b[35m\u001b[K${shown}\u001b[m\u001b[K\u001b[36m\u001b[K${sep}\u001b[m\u001b[K` : `${shown}${sep}`) : '') + (o.n ? (color ? `\u001b[32m\u001b[K${n + 1}\u001b[m\u001b[K\u001b[36m\u001b[K${sep}\u001b[m\u001b[K` : `${n + 1}${sep}`) : '');
    for (let i = 0; i < ls.length; i++) {
      const hit = res.some((re) => re.test(ls[i])) !== !!o.v;
      if (!hit) continue;
      count++; any = true;
      if (o.q) return 0;
      if (o.l || o.L) break;
      if (o.m && count > Number(o.m)) break;
      if (!o.c) {
        if (o.o && !o.v) {
          for (const re of res) { const g = new RegExp(re.source, re.flags + 'g'); let m; while ((m = g.exec(ls[i]))) { if (m[0] === '') { g.lastIndex++; continue; } ctx.out(prefix(i, ':') + (color ? `\u001b[01;31m\u001b[K${m[0]}\u001b[m\u001b[K` : m[0]) + '\n'); } }
        } else {
          if (B || A) { const from = Math.max(last + 1, i - B); if (printedAny && from > last + 1) ctx.out('--\n'); for (let k = from; k < i; k++) ctx.out(prefix(k, '-') + ls[k] + '\n'); }
          ctx.out(prefix(i, ':') + hl(ls[i]) + '\n');
          if (A) { for (let k = i + 1; k <= Math.min(ls.length - 1, i + A); k++) { if (res.some((re) => re.test(ls[k])) !== !!o.v) break; } }
          printedAny = true; last = i;
          if (A) { let k = i + 1; for (; k <= Math.min(ls.length - 1, i + A); k++) { if (res.some((re) => re.test(ls[k])) !== !!o.v) { ctx.out(prefix(k, '-') + ls[k] + '\n'); last = k; } else break; } }
        }
      }
    }
    if (o.c) ctx.out((showName ? `${shown}:` : '') + count + '\n');
    if (o.l && count) ctx.out(`${shown}\n`);
    if (o.L && !count) ctx.out(`${shown}\n`);
  }
  if (hadErr && !any) return 2;
  return any ? 0 : 1;
}, { usage: 'grep [OPTION]... PATTERNS [FILE]...' });

// ---------------------------------------------------------------- sort / uniq / cut / tr
cmd('sort', async (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'rnuhfbVMc', val: 'kto', long: { reverse: 'r', numeric: 'n', unique: 'u', 'ignore-case': 'f', 'field-separator': { key: 't', val: true }, key: { key: 'k', val: true }, output: { key: 'o', val: true } } });
  if (err) return usageError(ctx, err);
  let text = '';
  if (!rest.length) text = await ctx.stdinText();
  for (const f of rest) { const r = readInput(ctx, f); if (r.error) { ctx.err(`sort: cannot read: ${f}: ${r.error}\n`); return 2; } text += r.text; }
  let ls = lines(text);
  const key = (l) => {
    let v = l;
    if (o.k) { const [spec] = String(o.k).split(','); const n = Number(spec.split('.')[0]) - 1; const f = o.t ? l.split(o.t) : l.trim().split(/\s+/); v = (o.k.includes(',') ? f.slice(n, Number(String(o.k).split(',')[1]) || undefined) : f.slice(n)).join(o.t || ' '); }
    if (o.f) v = v.toLowerCase();
    if (o.b) v = v.trimStart();
    return v;
  };
  const cmpF = (a, b) => {
    const x = key(a); const y = key(b);
    if (o.n || o.h) { const d = (parseFloat(x) || 0) - (parseFloat(y) || 0); if (d) return d; return 0; }
    if (o.V) return x.localeCompare(y, undefined, { numeric: true });
    return x < y ? -1 : x > y ? 1 : 0;
  };
  const coll = (a, b) => { const d = cmpF(a, b); if (d) return d; const x = a.toLowerCase(); const y = b.toLowerCase(); return o.n ? 0 : x < y ? -1 : x > y ? 1 : a < b ? 1 : a > b ? -1 : 0; };
  ls.sort(o.n || o.V || o.h ? cmpF : (a, b) => { const x = key(a).toLowerCase().replace(/[^a-z0-9]/g, ''); const y = key(b).toLowerCase().replace(/[^a-z0-9]/g, ''); return x < y ? -1 : x > y ? 1 : coll(a, b); });
  if (o.r) ls.reverse();
  if (o.u) ls = ls.filter((l, i) => i === 0 || cmpF(l, ls[i - 1]) !== 0);
  const outText = ls.length ? ls.join('\n') + '\n' : '';
  if (o.o) { try { ctx.fs.writeFile(ctx.resolve(o.o), outText); } catch (e) { if (e instanceof FsError) return ctx.fsErr(e, o.o); throw e; } } else ctx.out(outText);
  return 0;
});

cmd('uniq', async (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'cdui', long: { count: 'c', repeated: 'd', unique: 'u', 'ignore-case': 'i' } });
  if (err) return usageError(ctx, err);
  const text = rest.length ? (readInput(ctx, rest[0]).text ?? '') : await ctx.stdinText();
  const ls = lines(text); const out = [];
  const same = (a, b) => (o.i ? a.toLowerCase() === b.toLowerCase() : a === b);
  for (const l of ls) { const last = out[out.length - 1]; if (last && same(last.l, l)) last.n++; else out.push({ l, n: 1 }); }
  for (const e of out) { if (o.d && e.n < 2) continue; if (o.u && e.n > 1) continue; ctx.out((o.c ? `${String(e.n).padStart(7)} ` : '') + e.l + '\n'); }
  return 0;
});

function parseList(spec) {
  const parts = spec.split(',').map((p) => { const m = /^(\d*)-(\d*)$/.exec(p); if (m) return [m[1] ? Number(m[1]) : 1, m[2] ? Number(m[2]) : Infinity]; return [Number(p), Number(p)]; });
  return (i) => parts.some(([a, b]) => i >= a && i <= b);
}
cmd('cut', async (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 's', val: 'dfcb', long: { delimiter: { key: 'd', val: true }, fields: { key: 'f', val: true }, characters: { key: 'c', val: true }, 'only-delimited': 's' } });
  if (err) return usageError(ctx, err);
  if (o.f == null && o.c == null && o.b == null) { ctx.err("cut: you must specify a list of bytes, characters, or fields\nTry 'cut --help' for more information.\n"); return 1; }
  const d = o.d ?? '\t';
  let text = '';
  if (!rest.length) text = await ctx.stdinText();
  for (const f of rest) { const r = readInput(ctx, f); if (r.error) { ctx.err(`cut: ${f}: ${r.error}\n`); return 1; } text += r.text; }
  const sel = parseList(o.f ?? o.c ?? o.b);
  for (const l of lines(text)) {
    if (o.f != null) {
      if (!l.includes(d)) { if (!o.s) ctx.out(l + '\n'); continue; }
      ctx.out(l.split(d).filter((_, i) => sel(i + 1)).join(d) + '\n');
    } else ctx.out([...l].filter((_, i) => sel(i + 1)).join('') + '\n');
  }
  return 0;
});

function expandSet(s) {
  let out = '';
  s = s.replace(/\[:(\w+):\]/g, (_, n) => ({ lower: 'abcdefghijklmnopqrstuvwxyz', upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', digit: '0123456789', alpha: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', alnum: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', space: ' \t\n', punct: '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~' }[n] || ''));
  s = s.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  for (let i = 0; i < s.length; i++) { if (s[i + 1] === '-' && i + 2 < s.length) { for (let c = s.charCodeAt(i); c <= s.charCodeAt(i + 2); c++) out += String.fromCharCode(c); i += 2; } else out += s[i]; }
  return out;
}
cmd('tr', async (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'dsc' });
  if (err) return usageError(ctx, err);
  if (!rest.length) { ctx.err("tr: missing operand\nTry 'tr --help' for more information.\n"); return 1; }
  let set1 = expandSet(rest[0]); const set2 = rest[1] != null ? expandSet(rest[1]) : '';
  let text = await ctx.stdinText();
  if (o.c) { const keep = set1; text = [...text].map((ch) => (keep.includes(ch) ? ch : (o.d ? '' : set2.slice(-1) || ch))).join(''); }
  else if (o.d) text = [...text].filter((ch) => !set1.includes(ch)).join('');
  else if (set2) text = [...text].map((ch) => { const i = set1.indexOf(ch); return i < 0 ? ch : set2[Math.min(i, set2.length - 1)]; }).join('');
  if (o.s) { const sq = set2 || set1; text = text.replace(new RegExp(`([${escapeRe(sq)}])\\1+`, 'g'), '$1'); }
  ctx.out(text);
  return 0;
});

// ---------------------------------------------------------------- sed
function parseSed(script) {
  const cmds = []; let i = 0;
  const n = script.length;
  const skip = () => { while (i < n && /[\s;]/.test(script[i])) i++; };
  const readDelim = (d) => { let s = ''; while (i < n && script[i] !== d) { if (script[i] === '\\' && i + 1 < n) { if (script[i + 1] === d) { s += d; i += 2; continue; } s += script[i] + script[i + 1]; i += 2; continue; } s += script[i++]; } i++; return s; };
  for (skip(); i < n; skip()) {
    const c = { a1: null, a2: null, neg: false };
    const addr = () => {
      if (script[i] === '$') { i++; return { last: true }; }
      const m = /^\d+/.exec(script.slice(i)); if (m) { i += m[0].length; return { line: Number(m[0]) }; }
      if (script[i] === '/') { i++; const re = readDelim('/'); return { re }; }
      return null;
    };
    c.a1 = addr();
    if (c.a1 && script[i] === ',') { i++; c.a2 = addr(); }
    while (script[i] === ' ') i++;
    if (script[i] === '!') { c.neg = true; i++; }
    c.cmd = script[i++];
    if (c.cmd === 's') {
      const d = script[i++]; const re = readDelim(d); const rep = readDelim(d);
      let fl = ''; while (i < n && /[gpiI0-9]/.test(script[i])) fl += script[i++];
      Object.assign(c, { re, rep, g: fl.includes('g'), p: fl.includes('p'), icase: /[iI]/.test(fl), nth: Number((/\d+/.exec(fl) || [0])[0]) });
    } else if (c.cmd === 'y') { const d = script[i++]; c.from = readDelim(d); c.to = readDelim(d); }
    else if ('aic'.includes(c.cmd)) { while (script[i] === '\\' || script[i] === ' ') i++; let t = ''; while (i < n && script[i] !== '\n') t += script[i++]; c.text = t; }
    cmds.push(c);
  }
  return cmds;
}
function sedRun(text, cmds, { n: quiet, ere }) {
  const ls = lines(text); const out = [];
  const compiled = cmds.map((c) => ({ ...c, rx: c.re != null && c.cmd === 's' ? posixRegex(c.re, { ere, icase: c.icase, flags: c.g ? 'g' : '' }) : null, ax1: c.a1?.re != null ? posixRegex(c.a1.re, { ere }) : null, ax2: c.a2?.re != null ? posixRegex(c.a2.re, { ere }) : null, active: false }));
  for (let idx = 0; idx < ls.length; idx++) {
    let line = ls[idx]; let deleted = false; const ln = idx + 1; const last = idx === ls.length - 1; let quit = false;
    const pre = [];
    for (const c of compiled) {
      let m = true;
      if (c.a1) {
        const hit = (a, rx) => (a.line != null ? a.line === ln : a.last ? last : rx.test(line));
        if (!c.a2) m = hit(c.a1, c.ax1);
        else if (c.active) { m = true; if (hit(c.a2, c.ax2) || (c.a2.line != null && ln >= c.a2.line)) c.active = false; }
        else if (hit(c.a1, c.ax1)) { m = true; if (!(c.a2.line != null && c.a2.line <= ln)) c.active = true; } else m = false;
      }
      if (c.neg) m = !m;
      if (!m) continue;
      if (c.cmd === 's') {
        if (!c.rx) continue;
        let count = 0;
        const repl = (full, ...g) => { count++; if (c.nth && count !== c.nth) return full; const groups = g.slice(0, -2).filter((x) => typeof x !== 'object'); return c.rep.replace(/\\(\d)|&|\\&|\\n|\\t|\\(.)/g, (mm, d, ch) => (d ? groups[Number(d) - 1] ?? '' : mm === '&' ? full : mm === '\\&' ? '&' : mm === '\\n' ? '\n' : mm === '\\t' ? '\t' : ch ?? mm)); };
        const nl = line.replace(c.rx, repl);
        if (nl !== line) { line = nl; if (c.p) out.push(line); }
      } else if (c.cmd === 'd') { deleted = true; break; }
      else if (c.cmd === 'p') out.push(line);
      else if (c.cmd === 'q') { quit = true; break; }
      else if (c.cmd === 'y') line = [...line].map((ch) => { const k = c.from.indexOf(ch); return k < 0 ? ch : c.to[k] ?? ch; }).join('');
      else if (c.cmd === 'a') pre.push({ after: c.text });
      else if (c.cmd === 'i') out.push(c.text);
      else if (c.cmd === 'c') { out.push(c.text); deleted = true; break; }
    }
    if (!deleted && !quiet) out.push(line);
    for (const p of pre) out.push(p.after);
    if (quit) break;
  }
  return out.length ? out.join('\n') + '\n' : '';
}
cmd('sed', async (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'nEruzs', val: 'ief', long: { quiet: 'n', silent: 'n', 'regexp-extended': 'E', expression: { key: 'e', val: true }, 'in-place': { key: 'i', val: true, optional: true }, file: { key: 'f', val: true } } });
  if (err) return usageError(ctx, err);
  // -i takes an optional suffix glued on; parseOpts treats it as value-taking, so give it back if it swallowed the script
  let script = o.e; const files = [...rest];
  let inplace = o.i != null; let suffix = typeof o.i === 'string' && !(o.i.includes('s') && o.i.length > 2 && !o.e) ? o.i : '';
  if (inplace && typeof o.i === 'string' && /^s.|^\d|^\//.test(o.i) && script == null) { script = o.i; suffix = ''; }
  if (o.f) { const r = readInput(ctx, o.f); if (r.error) return ctx.fail(`couldn't open file ${o.f}: ${r.error}`, 1); script = r.text; }
  if (script == null) { if (!files.length) { ctx.err('Usage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...\n'); return 1; } script = files.shift(); }
  let cmds;
  try { cmds = parseSed(script); } catch { ctx.err(`sed: -e expression #1, char 0: unknown command\n`); return 1; }
  for (const c of cmds) if (!'sdpqyaic'.includes(c.cmd)) { ctx.err(`sed: -e expression #1, char ${script.indexOf(c.cmd) + 1}: unknown command: \`${c.cmd}'\n`); return 1; }
  const opts = { n: !!o.n, ere: !!(o.E || o.r) };
  if (!files.length) { ctx.out(sedRun(await ctx.stdinText(), cmds, opts)); return 0; }
  let rc = 0;
  for (const f of files) {
    const r = readInput(ctx, f);
    if (r.error) { ctx.err(`sed: ${inplace ? "couldn't edit" : "can't read"} ${f}: ${r.error}\n`); rc = 4; continue; }
    const res = sedRun(r.text, cmds, opts);
    if (inplace) {
      try { if (suffix) ctx.fs.writeFile(ctx.resolve(f) + suffix, r.text); ctx.fs.writeFile(ctx.resolve(f), res); } catch (e) { if (e instanceof FsError) { ctx.err(`sed: couldn't open temporary file ${posix.dirname(ctx.resolve(f))}/sedXXXXXX: ${e.text}\n`); rc = 4; } else throw e; }
    } else ctx.out(res);
  }
  return rc;
}, { usage: 'sed [OPTION]... {script-only-if-no-other-script} [input-file]...' });

// ---------------------------------------------------------------- awk (a useful subset)
function awkTokens(src) {
  const toks = []; let i = 0; const n = src.length;
  const prevOperand = () => { const t = toks[toks.length - 1]; return t && (t.t === 'num' || t.t === 'str' || t.t === 'id' || t.v === ')' || t.v === ']' || t.v === '$' && false || t.t === 'fn'); };
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '\\' && src[i + 1] === '\n') { i += 2; continue; }
    if (c === '#') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '\n') { toks.push({ t: 'op', v: ';', nl: true }); i++; continue; }
    if (/[0-9.]/.test(c) && !(c === '.' && !/[0-9]/.test(src[i + 1] || ''))) { const m = /^(\d+\.?\d*([eE][-+]?\d+)?|\.\d+)/.exec(src.slice(i)); toks.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue; }
    if (c === '"') { let s = ''; i++; while (i < n && src[i] !== '"') { if (src[i] === '\\') { i++; const e = src[i]; s += e === 'n' ? '\n' : e === 't' ? '\t' : e === '"' ? '"' : e === '\\' ? '\\' : e === '/' ? '/' : '\\' + e; i++; } else s += src[i++]; } i++; toks.push({ t: 'str', v: s }); continue; }
    if (c === '/' && !prevOperand()) { let s = ''; i++; while (i < n && src[i] !== '/') { if (src[i] === '\\' && src[i + 1] === '/') { s += '/'; i += 2; } else s += src[i++]; } i++; toks.push({ t: 're', v: s }); continue; }
    if (/[A-Za-z_]/.test(c)) { const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i)); i += m[0].length; toks.push({ t: src[i] === '(' && !['if', 'while', 'for'].includes(m[0]) ? 'fn' : 'id', v: m[0] }); continue; }
    const three = src.slice(i, i + 3); const two = src.slice(i, i + 2);
    if (['**='].includes(three)) { toks.push({ t: 'op', v: three }); i += 3; continue; }
    if (['&&', '||', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '^=', '++', '--', '!~', '**'].includes(two)) { toks.push({ t: 'op', v: two }); i += 2; continue; }
    toks.push({ t: 'op', v: c }); i++;
  }
  return toks;
}

function awkParse(src) {
  const toks = awkTokens(src); let p = 0;
  const peek = () => toks[p]; const next = () => toks[p++];
  const isOp = (v) => peek() && peek().t === 'op' && peek().v === v;
  const eat = (v) => { if (!isOp(v)) throw new Error(`syntax error at source line 1: expected ${v}`); p++; };
  const skipNl = () => { while (isOp(';')) p++; };
  const prog = { begin: [], end: [], rules: [] };
  function block() { eat('{'); const st = []; skipNl(); while (!isOp('}')) { st.push(stmt()); skipNl(); } eat('}'); return { k: 'block', st }; }
  function simpleOrBlock() { skipNl(); return isOp('{') ? block() : stmt(); }
  function stmt() {
    const t = peek();
    if (isOp('{')) return block();
    if (t.t === 'id') {
      if (t.v === 'if') { next(); eat('('); const c = expr(); eat(')'); const a = simpleOrBlock(); let b = null; const save = p; skipNl(); if (peek() && peek().t === 'id' && peek().v === 'else') { next(); b = simpleOrBlock(); } else p = save; return { k: 'if', c, a, b }; }
      if (t.v === 'while') { next(); eat('('); const c = expr(); eat(')'); return { k: 'while', c, body: simpleOrBlock() }; }
      if (t.v === 'for') {
        next(); eat('(');
        if (peek().t === 'id' && toks[p + 1] && toks[p + 1].v === 'in') { const v = next().v; next(); const arr = next().v; eat(')'); return { k: 'forin', v, arr, body: simpleOrBlock() }; }
        const init = isOp(';') ? null : expr(); eat(';'); const c = isOp(';') ? null : expr(); eat(';'); const inc = isOp(')') ? null : expr(); eat(')');
        return { k: 'for', init, c, inc, body: simpleOrBlock() };
      }
      if (t.v === 'print' || t.v === 'printf') {
        next(); const args = [];
        const paren = isOp('(') && (() => { let d = 0; for (let j = p; j < toks.length; j++) { if (toks[j].v === '(' && toks[j].t === 'op') d++; if (toks[j].v === ')' && toks[j].t === 'op') { d--; if (!d) return toks[j + 1] === undefined || (toks[j + 1].t === 'op' && [';', '}', '>', '|'].includes(toks[j + 1].v)); } } return false; })();
        if (paren) { next(); while (!isOp(')')) { args.push(expr()); if (isOp(',')) next(); } next(); }
        else while (peek() && !isOp(';') && !isOp('}') && !isOp('>') && !isOp('|')) { args.push(expr(true)); if (isOp(',')) next(); else break; }
        let redir = null; if (isOp('>')) { next(); redir = expr(true); }
        return { k: t.v, args, redir };
      }
      if (t.v === 'next') { next(); return { k: 'next' }; }
      if (t.v === 'exit') { next(); const e = peek() && !isOp(';') && !isOp('}') ? expr() : null; return { k: 'exit', e }; }
      if (t.v === 'delete') { next(); const name = next().v; let idx = null; if (isOp('[')) { next(); idx = [expr()]; while (isOp(',')) { next(); idx.push(expr()); } eat(']'); } return { k: 'delete', name, idx }; }
    }
    return { k: 'expr', e: expr() };
  }
  const ASSIGN = ['=', '+=', '-=', '*=', '/=', '%=', '^='];
  function expr(noGt) { return assign(noGt); }
  function assign(noGt) {
    const l = ternary(noGt);
    if (peek() && peek().t === 'op' && ASSIGN.includes(peek().v) && (l.k === 'var' || l.k === 'idx' || l.k === 'field')) { const op = next().v; return { k: 'assign', op, l, r: assign(noGt) }; }
    return l;
  }
  function ternary(noGt) { const c = or(noGt); if (isOp('?')) { next(); const a = assign(noGt); eat(':'); const b = assign(noGt); return { k: 'tern', c, a, b }; } return c; }
  function or(g) { let l = and(g); while (isOp('||')) { next(); l = { k: 'or', l, r: and(g) }; } return l; }
  function and(g) { let l = inop(g); while (isOp('&&')) { next(); l = { k: 'and', l, r: inop(g) }; } return l; }
  function inop(g) { let l = match(g); while (peek() && peek().t === 'id' && peek().v === 'in') { next(); l = { k: 'in', l, arr: next().v }; } return l; }
  function match(g) { let l = cmp(g); while (isOp('~') || isOp('!~')) { const neg = next().v === '!~'; l = { k: 'match', l, r: cmp(g), neg }; } return l; }
  function cmp(g) { let l = concat(g); while (peek() && peek().t === 'op' && ['<', '<=', '==', '!=', '>=', '>'].includes(peek().v) && !(g && peek().v === '>')) { const op = next().v; l = { k: 'cmp', op, l, r: concat(g) }; } return l; }
  function startsOperand() { const t = peek(); if (!t) return false; if (t.t === 'num' || t.t === 'str' || t.t === 're' || t.t === 'fn') return true; if (t.t === 'id') return !['in', 'else'].includes(t.v); return t.t === 'op' && ['$', '(', '!', '-', '+'].includes(t.v) && !(t.v === '-' || t.v === '+') ; }
  function concat(g) { let l = add(g); while (startsOperand()) l = { k: 'cat', l, r: add(g) }; return l; }
  function add(g) { let l = mul(g); while (isOp('+') || isOp('-')) { const op = next().v; l = { k: 'bin', op, l, r: mul(g) }; } return l; }
  function mul(g) { let l = unary(g); while (isOp('*') || isOp('/') || isOp('%')) { const op = next().v; l = { k: 'bin', op, l, r: unary(g) }; } return l; }
  function unary(g) { if (isOp('!')) { next(); return { k: 'not', e: unary(g) }; } if (isOp('-')) { next(); return { k: 'neg', e: unary(g) }; } if (isOp('+')) { next(); return { k: 'pos', e: unary(g) }; } return pow(g); }
  function pow(g) { const l = postfix(g); if (isOp('^') || isOp('**')) { next(); return { k: 'bin', op: '^', l, r: unary(g) }; } return l; }
  function postfix(g) { const e = primary(g); if ((isOp('++') || isOp('--')) && (e.k === 'var' || e.k === 'idx' || e.k === 'field')) { const op = next().v; return { k: 'post', op, e }; } return e; }
  function primary() {
    const t = next();
    if (!t) throw new Error('syntax error: unexpected end');
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 're') return { k: 're', v: t.v };
    if (t.t === 'op') {
      if (t.v === '(') { const e = expr(); eat(')'); return { k: 'group', e }; }
      if (t.v === '$') { const e = isOp('(') ? primary() : (isOp('++') || isOp('--')) ? primary() : unaryDollar(); return { k: 'field', e }; }
      if (t.v === '++' || t.v === '--') { const e = primary(); return { k: 'pre', op: t.v, e }; }
    }
    if (t.t === 'fn') { eat('('); const args = []; while (!isOp(')')) { args.push(expr()); if (isOp(',')) next(); } next(); return { k: 'call', name: t.v, args }; }
    if (t.t === 'id') {
      if (isOp('[')) { next(); const idx = [expr()]; while (isOp(',')) { next(); idx.push(expr()); } eat(']'); return { k: 'idx', name: t.v, idx }; }
      return { k: 'var', name: t.v };
    }
    throw new Error(`syntax error at source line 1 near ${t.v}`);
  }
  function unaryDollar() { const t = peek(); if (t.t === 'num') { next(); return { k: 'num', v: t.v }; } if (t.t === 'id') { next(); return { k: 'var', name: t.v }; } return primary(); }

  skipNl();
  while (peek()) {
    const t = peek();
    if (t.t === 'id' && t.v === 'BEGIN') { next(); prog.begin.push(block()); }
    else if (t.t === 'id' && t.v === 'END') { next(); prog.end.push(block()); }
    else if (isOp('{')) prog.rules.push({ pat: null, body: block() });
    else { const pat = expr(); let body = null; if (isOp('{')) body = block(); prog.rules.push({ pat, body }); }
    skipNl();
  }
  return prog;
}

const numLike = (s) => typeof s === 'string' && /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(s);
const toNum = (v) => (typeof v === 'number' ? v : parseFloat(v) || 0);
const toStr = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)))) : v == null ? '' : String(v));

class AwkExit extends Error {}
class AwkNext extends Error {}

function awkExec(prog, input, { FS = ' ', vars = {}, out, readFile }) {
  const G = new Map(Object.entries({ FS, OFS: ' ', ORS: '\n', RS: '\n', NR: 0, NF: 0, FILENAME: '', ...vars }));
  const arrays = new Map();
  let fields = ['']; // fields[0] = $0
  const setRecord = (line) => { fields = [line, ...splitFields(line)]; G.set('NF', fields.length - 1); };
  const splitFields = (line) => { const fs = G.get('FS'); if (fs === ' ') return line.trim() === '' ? [] : line.trim().split(/\s+/); if (fs === '\t') return line.split('\t'); if (fs.length === 1) return line.split(fs); return line.split(new RegExp(fs)); };
  const rebuild = () => { fields[0] = fields.slice(1).join(G.get('OFS')); };
  const arr = (n) => { if (!arrays.has(n)) arrays.set(n, new Map()); return arrays.get(n); };
  const key = (idx, ev) => idx.map((e) => toStr(ev(e))).join('\u001c');
  const rx = (v) => (v instanceof RegExp ? v : new RegExp(toStr(v)));
  let exitCode = null;
  const ev = (e) => {
    switch (e.k) {
      case 'num': return e.v; case 'str': return e.v; case 'group': return ev(e.e);
      case 're': return new RegExp(e.v).test(fields[0]) ? 1 : 0;
      case 'var': return G.has(e.name) ? G.get(e.name) : '';
      case 'idx': return arr(e.name).get(key(e.idx, ev)) ?? '';
      case 'field': { const i = toNum(ev(e.e)); return fields[i] ?? ''; }
      case 'assign': {
        let v = ev(e.r);
        if (e.op !== '=') { const cur = toNum(ev(e.l)); const r = toNum(v); v = { '+=': cur + r, '-=': cur - r, '*=': cur * r, '/=': cur / r, '%=': cur % r, '^=': cur ** r }[e.op]; }
        store(e.l, v); return v;
      }
      case 'tern': return truthy(ev(e.c)) ? ev(e.a) : ev(e.b);
      case 'or': return truthy(ev(e.l)) || truthy(ev(e.r)) ? 1 : 0;
      case 'and': return truthy(ev(e.l)) && truthy(ev(e.r)) ? 1 : 0;
      case 'not': return truthy(ev(e.e)) ? 0 : 1;
      case 'neg': return -toNum(ev(e.e)); case 'pos': return toNum(ev(e.e));
      case 'in': return arr(e.arr).has(toStr(ev(e.l))) ? 1 : 0;
      case 'match': { const m = rx(e.r.k === 're' ? new RegExp(e.r.v) : ev(e.r)).test(toStr(ev(e.l))); return (e.neg ? !m : m) ? 1 : 0; }
      case 'cmp': {
        const a = ev(e.l); const b = ev(e.r);
        const numeric = (typeof a === 'number' || numLike(a)) && (typeof b === 'number' || numLike(b));
        const x = numeric ? toNum(a) : toStr(a); const y = numeric ? toNum(b) : toStr(b);
        return { '<': x < y, '<=': x <= y, '==': x === y, '!=': x !== y, '>=': x >= y, '>': x > y }[e.op] ? 1 : 0;
      }
      case 'cat': return toStr(ev(e.l)) + toStr(ev(e.r));
      case 'bin': { const a = toNum(ev(e.l)); const b = toNum(ev(e.r)); return { '+': a + b, '-': a - b, '*': a * b, '/': b === 0 ? (() => { throw new Error('division by zero'); })() : a / b, '%': a % b, '^': a ** b }[e.op]; }
      case 'pre': { const v = toNum(ev(e.e)) + (e.op === '++' ? 1 : -1); store(e.e, v); return v; }
      case 'post': { const old = toNum(ev(e.e)); store(e.e, old + (e.op === '++' ? 1 : -1)); return old; }
      case 'call': return call(e);
      default: throw new Error('bad expression ' + e.k);
    }
  };
  const truthy = (v) => (typeof v === 'number' ? v !== 0 : v !== '' && !(numLike(v) && toNum(v) === 0 && false));
  function store(l, v) {
    if (l.k === 'var') { G.set(l.name, v); if (l.name === 'NF') { fields = fields.slice(0, toNum(v) + 1); while (fields.length < toNum(v) + 1) fields.push(''); rebuild(); } }
    else if (l.k === 'idx') arr(l.name).set(key(l.idx, ev), v);
    else if (l.k === 'field') { const i = toNum(ev(l.e)); if (i === 0) setRecord(toStr(v)); else { while (fields.length <= i) fields.push(''); fields[i] = toStr(v); G.set('NF', fields.length - 1); rebuild(); } }
  }
  function call(e) {
    const a = e.args.map((x) => (x.k === 'var' && ['split'].includes(e.name) ? x : ev(x)));
    switch (e.name) {
      case 'length': return e.args.length ? toStr(a[0]).length : fields[0].length;
      case 'substr': { const s = toStr(a[0]); const st = Math.max(1, Math.round(toNum(a[1]))); return a.length > 2 ? s.substr(st - 1, Math.round(toNum(a[2]))) : s.slice(st - 1); }
      case 'index': return toStr(a[0]).indexOf(toStr(a[1])) + 1;
      case 'tolower': return toStr(a[0]).toLowerCase(); case 'toupper': return toStr(a[0]).toUpperCase();
      case 'int': return Math.trunc(toNum(a[0])); case 'sqrt': return Math.sqrt(toNum(a[0]));
      case 'sprintf': return formatPrintf(toStr(a[0]), a.slice(1).map(toStr));
      case 'sub': case 'gsub': { const target = e.args[2] || { k: 'field', e: { k: 'num', v: 0 } }; const s = toStr(ev(target)); const re = e.args[0].k === 're' ? new RegExp(e.args[0].v, e.name === 'gsub' ? 'g' : '') : new RegExp(toStr(a[0]), e.name === 'gsub' ? 'g' : ''); let n = 0; const r = s.replace(re, (m) => { n++; return toStr(a[1]).replace(/\\&/g, '\u0000').replace(/&/g, m).replace(/\u0000/g, '&'); }); store(target, r); return n; }
      case 'split': { const s = toStr(ev(e.args[0])); const sep = e.args[2] ? toStr(ev(e.args[2])) : G.get('FS'); const parts = sep === ' ' ? s.trim().split(/\s+/).filter(Boolean) : s.split(sep.length === 1 ? sep : new RegExp(sep)); const A = arr(e.args[1].name); A.clear(); parts.forEach((p, i) => A.set(String(i + 1), p)); return parts.length; }
      case 'match': { const m = new RegExp(toStr(a[1])).exec(toStr(a[0])); G.set('RSTART', m ? m.index + 1 : 0); G.set('RLENGTH', m ? m[0].length : -1); return m ? m.index + 1 : 0; }
      default: throw new Error(`function ${e.name} never defined`);
    }
  }
  const run = (s) => {
    switch (s.k) {
      case 'block': for (const x of s.st) run(x); break;
      case 'expr': ev(s.e); break;
      case 'if': if (truthy(ev(s.c))) run(s.a); else if (s.b) run(s.b); break;
      case 'while': { let g = 0; while (truthy(ev(s.c)) && ++g < 1e6) run(s.body); break; }
      case 'for': { let g = 0; if (s.init) ev(s.init); while ((!s.c || truthy(ev(s.c))) && ++g < 1e6) { run(s.body); if (s.inc) ev(s.inc); } break; }
      case 'forin': for (const k of [...arr(s.arr).keys()]) { G.set(s.v, k); run(s.body); } break;
      case 'print': { const parts = s.args.length ? s.args.map((a) => toStr(ev(a))) : [fields[0]]; out(parts.join(G.get('OFS')) + G.get('ORS')); break; }
      case 'printf': out(formatPrintf(toStr(ev(s.args[0])), s.args.slice(1).map((a) => toStr(ev(a))))); break;
      case 'next': throw new AwkNext();
      case 'exit': exitCode = s.e ? toNum(ev(s.e)) : 0; throw new AwkExit();
      case 'delete': if (s.idx) arr(s.name).delete(key(s.idx, ev)); else arr(s.name).clear(); break;
      default: break;
    }
  };
  try { for (const b of prog.begin) run(b); } catch (e) { if (!(e instanceof AwkExit)) throw e; return exitCode ?? 0; }
  if (prog.rules.length || prog.end.length) {
    try {
      for (const { text, name } of input) {
        G.set('FILENAME', name ?? '');
        for (const line of lines(text)) {
          G.set('NR', toNum(G.get('NR')) + 1); setRecord(line);
          try { for (const r of prog.rules) { if (!r.pat || truthy(ev(r.pat))) { if (r.body) run(r.body); else out(fields[0] + G.get('ORS')); } } } catch (e) { if (!(e instanceof AwkNext)) throw e; }
        }
      }
    } catch (e) { if (!(e instanceof AwkExit)) throw e; }
  }
  try { for (const b of prog.end) run(b); } catch (e) { if (!(e instanceof AwkExit)) throw e; }
  void readFile;
  return exitCode ?? 0;
}

cmd(['awk', 'mawk', 'gawk'], async (ctx) => {
  const args = [...ctx.args]; let FS = ' '; const vars = {}; let src = null;
  while (args.length && args[0].startsWith('-') && args[0] !== '-') {
    const a = args.shift();
    if (a === '--') break;
    if (a.startsWith('-F')) { FS = a.length > 2 ? a.slice(2) : args.shift(); if (FS === 't') FS = '\t'; }
    else if (a === '-v') { const [k, ...v] = args.shift().split('='); vars[k] = v.join('='); }
    else if (a === '-f') { const r = readInput(ctx, args.shift()); src = r.text ?? ''; }
    else if (a === '--version') { ctx.out('mawk 1.3.4 20200120\n'); return 0; }
  }
  if (src == null) src = args.shift();
  if (src == null) { ctx.err('usage: awk [-F value] [-v var=value] [prog | -f progfile][file ...]\n'); return 2; }
  let prog;
  try { prog = awkParse(src); } catch (e) { ctx.err(`awk: ${e.message}\n`); return 2; }
  const input = [];
  let rc = 0;
  if (!args.length) { if (prog.rules.length || prog.end.length) input.push({ text: await ctx.stdinText() }); }
  for (const f of args) { const r = readInput(ctx, f); if (r.error) { ctx.err(`awk: cannot open ${f} (${r.error})\n`); rc = 2; } else input.push({ text: r.text, name: f }); }
  try { const st = awkExec(prog, input, { FS, vars, out: (s) => ctx.out(s) }); return rc || st; } catch (e) { ctx.err(`awk: ${e.message}\n`); return 2; }
});

// ---------------------------------------------------------------- xargs, base64, checksums, small utilities
cmd('xargs', async (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: '0rtp', val: 'nIdLs', stopAtFirst: true });
  if (err) return usageError(ctx, err);
  const input = await ctx.stdinText();
  const items = o['0'] ? input.split('\0').filter(Boolean) : (o.d ? input.split(o.d) : input.split(/\s+/)).filter(Boolean);
  const base = rest.length ? rest : ['echo'];
  if (!items.length && o.r) return 0;
  let rc = 0;
  if (o.I) { for (const it of items) { const st = await ctx.exec(base.map((a) => a.split(o.I).join(it)), ctx.stdio); if (st) rc = 123; } return rc; }
  const per = o.n ? Number(o.n) : items.length || 1;
  for (let i = 0; i < Math.max(items.length, 1); i += per) { const st = await ctx.exec([...base, ...items.slice(i, i + per)], ctx.stdio); if (st) rc = 123; }
  return rc;
});

cmd('base64', async (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'd', val: 'w', long: { decode: 'd', wrap: { key: 'w', val: true } } });
  if (err) return usageError(ctx, err);
  const text = rest.length ? (readInput(ctx, rest[0]).text ?? '') : await ctx.stdinText();
  if (o.d) {
    try { const bin = atob(text.replace(/\s+/g, '')); const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0)); ctx.out(new TextDecoder().decode(bytes)); return 0; } catch { ctx.err('base64: invalid input\n'); return 1; }
  }
  const enc = btoa(String.fromCharCode(...new TextEncoder().encode(text)));
  const w = o.w != null ? Number(o.w) : 76;
  ctx.out((w > 0 ? enc.replace(new RegExp(`(.{${w}})`, 'g'), '$1\n') : enc).replace(/\n$/, '') + '\n');
  return 0;
});

cmd(['sha256sum', 'md5sum', 'sha1sum'], async (ctx) => {
  const h = ctx.name === 'sha256sum' ? sha256hex : ctx.name === 'md5sum' ? md5ish : (s) => sha256hex('sha1:' + s).slice(0, 40);
  if (!ctx.args.length) { ctx.out(`${h(await ctx.stdinText())}  -\n`); return 0; }
  let rc = 0;
  for (const f of ctx.args) { const r = readInput(ctx, f); if (r.error) { ctx.err(`${ctx.name}: ${f}: ${r.error}\n`); rc = 1; } else ctx.out(`${h(r.text)}  ${f}\n`); }
  return rc;
});

cmd('basename', (ctx) => { if (!ctx.args.length) return ctx.fail('missing operand', 1); let b = posix.basename(ctx.args[0]); if (ctx.args[1] && b.endsWith(ctx.args[1]) && b !== ctx.args[1]) b = b.slice(0, -ctx.args[1].length); ctx.out(b + '\n'); return 0; });
cmd('dirname', (ctx) => { if (!ctx.args.length) return ctx.fail('missing operand', 1); for (const a of ctx.args) ctx.out(posix.dirname(a) + '\n'); return 0; });
cmd('seq', (ctx) => {
  const n = ctx.args.filter((a) => !a.startsWith('-') || /^-\d/.test(a)).map(Number);
  if (!n.length) return ctx.fail('missing operand', 1);
  const [a, step, b] = n.length === 1 ? [1, 1, n[0]] : n.length === 2 ? [n[0], 1, n[1]] : n;
  const out = []; for (let i = a; step > 0 ? i <= b : i >= b; i += step) { out.push(i); if (out.length > 100000) break; }
  ctx.out(out.join('\n') + (out.length ? '\n' : '')); return 0;
});
cmd(['less', 'more'], async (ctx) => { const t = rest0(ctx) ?? (await ctx.stdinText()); ctx.out(t); return 0; });
cmd('yes', async (ctx) => { for (let i = 0; i < 20 && !ctx.aborted(); i++) ctx.out((ctx.args.join(' ') || 'y') + '\n'); return 0; });
cmd('nl', async (ctx) => { const t = rest0(ctx) ?? (await ctx.stdinText()); let n = 0; ctx.out(lines(t).map((l) => (l === '' ? '' : `${String(++n).padStart(6)}\t`) + l).join('\n') + '\n'); return 0; });
cmd('diff', (ctx) => {
  const [a, b] = ctx.args.filter((x) => !x.startsWith('-'));
  const ra = readInput(ctx, a); const rb = readInput(ctx, b);
  if (ra.error || rb.error) { ctx.err(`diff: ${ra.error ? a : b}: ${ra.error || rb.error}\n`); return 2; }
  const la = lines(ra.text); const lb = lines(rb.text); let rc = 0;
  const max = Math.max(la.length, lb.length);
  for (let i = 0; i < max; i++) if (la[i] !== lb[i]) { rc = 1; if (la[i] !== undefined) ctx.out(`${i + 1}c${i + 1}\n< ${la[i]}\n---\n> ${lb[i] ?? ''}\n`); else ctx.out(`${la.length}a${i + 1}\n> ${lb[i]}\n`); }
  return rc;
});
cmd('column', async (ctx) => { const t = await ctx.stdinText(); const rows = lines(t).map((l) => l.split(/\s+/)); const w = []; rows.forEach((r) => r.forEach((c, i) => { w[i] = Math.max(w[i] || 0, c.length); })); ctx.out(rows.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(w[i] + 2))).join('')).join('\n') + '\n'); return 0; });
