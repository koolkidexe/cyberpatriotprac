// Text-processing commands: grep, sed, awk, sort, uniq, cut, tr, xargs, ...
import { def } from '../registry.js';
import { CmdError } from '../../core/errors.js';
import { FsError } from '../../core/vfs.js';
import { posix, globToRegex } from '../../core/util.js';
import { getopt, eachInput, lines } from './util.js';
import { unescape } from './builtins.js';

/** POSIX BRE/ERE to a JS RegExp source. */
export function toJsRegex(pat, { ere = false, fixed = false } = {}) {
  if (fixed) return pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let out = ''; let inBracket = false;
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (inBracket) { if (c === ']' && pat[i - 1] !== '[' && !(pat[i - 1] === '^' && pat[i - 2] === '[')) inBracket = false; out += c === '\\' ? '\\\\' : c; continue; }
    if (c === '[') {
      const m = /^\[(\^?)\[:(alpha|digit|alnum|upper|lower|space|punct|blank|xdigit):\]/.exec(pat.slice(i));
      inBracket = true; out += c; if (m) { /* handled below via replace */ } continue;
    }
    if (c === '\\' && i + 1 < pat.length) {
      const n = pat[++i];
      if (!ere && '(){}|+?'.includes(n)) out += n; else if (n === '<' || n === '>') out += '\\b'; else out += '\\' + n;
      continue;
    }
    if (!ere && '(){}|+?'.includes(c)) { out += '\\' + c; continue; }
    out += c;
  }
  return out.replace(/\[:alpha:\]/g, 'a-zA-Z').replace(/\[:digit:\]/g, '0-9').replace(/\[:alnum:\]/g, 'a-zA-Z0-9').replace(/\[:upper:\]/g, 'A-Z').replace(/\[:lower:\]/g, 'a-z').replace(/\[:space:\]/g, '\\s').replace(/\[:punct:\]/g, '!-\\/:-@\\[-`{-~').replace(/\[:blank:\]/g, ' \\t').replace(/\[:xdigit:\]/g, '0-9a-fA-F');
}

// ------------------------------------------------------------------ grep
def(['grep', 'egrep', 'fgrep'], (ctx) => {
  const { opts, all, rest } = getopt(ctx, ctx.args, {
    flags: 'EFivnrRlLcwxoqshHaIPz', withArg: 'efmABC',
    long: { 'ignore-case': 'i', 'invert-match': 'v', 'line-number': 'n', recursive: 'r', 'files-with-matches': 'l', count: 'c', 'word-regexp': 'w', 'only-matching': 'o', quiet: 'q', silent: 'q', 'no-messages': 's', 'with-filename': 'H', 'no-filename': 'h', color: ['color', true], colour: ['color', true], include: ['include', true], exclude: ['exclude', true], 'exclude-dir': ['xdir', true], 'extended-regexp': 'E', 'fixed-strings': 'F', 'max-count': ['m', true], 'perl-regexp': 'P', text: 'a', 'files-without-match': 'L' },
  });
  const pats = [...(all.e || [])]; const operands = [...rest];
  if (!pats.length) { if (!operands.length) throw new CmdError('Usage: grep [OPTION]... PATTERNS [FILE]...\nTry \'grep --help\' for more information.', 2); pats.push(operands.shift()); }
  const ere = opts.E || opts.P || ctx.name === 'egrep'; const fixed = opts.F || ctx.name === 'fgrep';
  const source = pats.flatMap((p) => p.split('\n')).map((p) => toJsRegex(p, { ere, fixed })).map((s) => (opts.w ? `\\b(?:${s})\\b` : opts.x ? `^(?:${s})$` : s)).join('|');
  let re;
  try { re = new RegExp(source, opts.i ? 'gi' : 'g'); } catch { throw new CmdError('grep: Unmatched ( or \\(', 2); }
  const color = !!opts.color && opts.color !== 'never' && (opts.color === 'always' || ctx.tty);
  const recursive = opts.r || opts.R;
  const A = Number(opts.A ?? opts.C ?? 0); const B = Number(opts.B ?? opts.C ?? 0);
  const files = operands.length ? operands : recursive ? ['.'] : ['-'];
  const showName = opts.H || (!opts.h && (files.length > 1 || recursive));
  const inc = opts.include ? globToRegex(opts.include) : null; const exc = opts.exclude ? globToRegex(opts.exclude) : null; const xdir = opts.xdir ? globToRegex(opts.xdir) : null;
  let matchedAny = false; let code = 0; const max = opts.m ? Number(opts.m) : Infinity;
  const sepc = (s) => (color ? `\u001b[36m\u001b[K${s}\u001b[m\u001b[K` : s);
  const namec = (n) => (color ? `\u001b[35m\u001b[K${n}\u001b[m\u001b[K` : n);
  const hl = (line) => (color && !opts.v ? line.replace(re, (m) => (m ? `\u001b[01;31m\u001b[K${m}\u001b[m\u001b[K` : m)) : line);
  const scan = (text, label) => {
    if (/\u0000/.test(text) && !opts.a) { re.lastIndex = 0; if (re.test(text) !== !!opts.v && !opts.q && !opts.c && !opts.l) { ctx.out(`grep: ${label}: binary file matches\n`.replace('grep: ', 'Binary file ').replace(': binary file matches', ' matches')); matchedAny = true; } return; }
    const ls = text.split('\n'); if (ls[ls.length - 1] === '') ls.pop();
    let count = 0; let lastPrinted = -1;
    const prefix = (i, sep) => (showName ? namec(label) + sepc(sep) : '') + (opts.n ? (color ? `\u001b[32m\u001b[K${i + 1}\u001b[m\u001b[K` : String(i + 1)) + sepc(sep) : '');
    for (let i = 0; i < ls.length && count < max; i++) {
      re.lastIndex = 0;
      const hit = re.test(ls[i]); re.lastIndex = 0;
      if (hit !== !!opts.v) {
        count++; matchedAny = true;
        if (opts.q || opts.l || opts.L || opts.c) { if (opts.q || opts.l) break; continue; }
        for (let b = Math.max(lastPrinted + 1, i - B); b < i; b++) ctx.out(prefix(b, '-') + ls[b] + '\n');
        if (opts.o) { for (const m of ls[i].matchAll(re)) if (m[0]) ctx.out(prefix(i, ':') + (color ? `\u001b[01;31m\u001b[K${m[0]}\u001b[m\u001b[K` : m[0]) + '\n'); }
        else ctx.out(prefix(i, ':') + hl(ls[i]) + '\n');
        lastPrinted = i;
        for (let a = i + 1; a <= Math.min(ls.length - 1, i + A); a++) { re.lastIndex = 0; if (re.test(ls[a]) !== !!opts.v) break; ctx.out(prefix(a, '-') + ls[a] + '\n'); lastPrinted = a; }
      }
    }
    if (opts.c) ctx.out((showName ? namec(label) + sepc(':') : '') + count + '\n');
    if (opts.l && count) ctx.out(namec(label) + '\n');
    if (opts.L && !count) ctx.out(namec(label) + '\n');
  };
  const walk = (p, shown, top) => {
    let st; try { st = ctx.fs.stat(p); } catch (e) { if (e instanceof FsError) { if (!opts.s) ctx.err(`grep: ${shown}: ${e.text}\n`); code = 2; return; } throw e; }
    if (st.type === 'dir') {
      if (!recursive) { if (!opts.s) ctx.err(`grep: ${shown}: Is a directory\n`); return; }
      if (!top && xdir && xdir.test(posix.basename(p))) return;
      let names; try { names = ctx.fs.readdir(p); } catch (e) { if (e instanceof FsError) { if (!opts.s) ctx.err(`grep: ${shown}: ${e.text}\n`); code = 2; return; } throw e; }
      for (const n of names.sort()) { const q = posix.join(p, n); if (ctx.sys.vfs.lookup(q, { follow: false })?.t === 'l') continue; walk(q, shown === '.' && top && !operands.length ? n : `${shown.replace(/\/$/, '')}/${n}`, false); }
      return;
    }
    const base = posix.basename(p);
    if ((inc && !inc.test(base)) || (exc && exc.test(base))) return;
    try { scan(ctx.fs.readFile(p), shown); } catch (e) { if (e instanceof FsError) { if (!opts.s) ctx.err(`grep: ${shown}: ${e.text}\n`); code = 2; } else throw e; }
  };
  for (const f of files) { if (f === '-') scan(ctx.stdin, '(standard input)'); else walk(ctx.abs(f), f, true); }
  return code === 2 && !opts.q ? 2 : matchedAny ? 0 : 1;
});

// ------------------------------------------------------------------ sort / uniq / cut / tr / rev / nl
def('sort', (ctx) => {
  const { opts, all, rest } = getopt(ctx, ctx.args, { flags: 'nrufhVbcMdgs', withArg: 'kto', long: { reverse: 'r', unique: 'u', 'numeric-sort': 'n', 'field-separator': ['t', true], key: ['k', true] } });
  let ls = [];
  const code = eachInput(ctx, rest, (t) => ls.push(...lines(t)));
  const keys = (all.k || []).map((k) => { const m = /^(\d+)(?:\.\d+)?(?:,(\d+))?([a-zA-Z]*)/.exec(k); return { from: Number(m[1]), to: Number(m[2] || m[1]), n: /n/.test(m[3]), r: /r/.test(m[3]) }; });
  const fieldsOf = (l) => (opts.t ? l.split(opts.t) : l.trim().split(/\s+/));
  const keyOf = (l, k) => { const f = fieldsOf(l); return f.slice(k.from - 1, k.to).join(opts.t || ' '); };
  const num = (s) => { const m = /^\s*(-?\d+(?:\.\d+)?)/.exec(s); return m ? Number(m[1]) : 0; };
  const human = (s) => { const m = /^\s*([\d.]+)([KMGT]?)/.exec(s); return m ? Number(m[1]) * ({ '': 1, K: 1e3, M: 1e6, G: 1e9, T: 1e12 }[m[2]]) : 0; };
  const cmp = (a, b) => {
    if (keys.length) { for (const k of keys) { const x = keyOf(a, k); const y = keyOf(b, k); const d = k.n || opts.n ? num(x) - num(y) : opts.f ? x.toLowerCase().localeCompare(y.toLowerCase()) : x < y ? -1 : x > y ? 1 : 0; if (d) return k.r ? -d : d; } return 0; }
    if (opts.n) return num(a) - num(b);
    if (opts.h) return human(a) - human(b);
    if (opts.V) return a.localeCompare(b, undefined, { numeric: true });
    const x = opts.f ? a.toLowerCase() : a; const y = opts.f ? b.toLowerCase() : b;
    const kx = x.replace(/[^A-Za-z0-9]/g, '').toLowerCase(); const ky = y.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    return kx < ky ? -1 : kx > ky ? 1 : x < y ? 1 : x > y ? -1 : 0;
  };
  ls.sort(cmp); if (opts.r) ls.reverse();
  if (opts.u) ls = ls.filter((l, i) => i === 0 || cmp(ls[i - 1], l) !== 0);
  ctx.out(ls.map((l) => l + '\n').join(''));
  return code;
});
def('uniq', (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'cduiD', withArg: 'fsw' });
  const ls = []; eachInput(ctx, rest.slice(0, 1), (t) => ls.push(...lines(t)));
  const groups = [];
  for (const l of ls) { const last = groups[groups.length - 1]; const k = opts.i ? l.toLowerCase() : l; if (last && last.k === k) last.n++; else groups.push({ k, l, n: 1 }); }
  for (const g of groups) { if (opts.d && g.n < 2) continue; if (opts.u && g.n > 1) continue; ctx.out(`${opts.c ? String(g.n).padStart(7) + ' ' : ''}${g.l}\n`); }
});
def('cut', (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 's', withArg: 'dfcb', long: { delimiter: ['d', true], fields: ['f', true], characters: ['c', true], 'only-delimited': 's' } });
  const spec = opts.f ?? opts.c ?? opts.b; if (spec === undefined) throw new CmdError('cut: you must specify a list of bytes, characters, or fields', 1);
  const ranges = String(spec).split(',').map((r) => { const [a, b] = r.split('-'); return [a === '' ? 1 : Number(a), r.includes('-') ? (b === '' ? Infinity : Number(b)) : Number(a)]; });
  const inR = (i) => ranges.some(([a, b]) => i >= a && i <= b);
  const d = opts.d ?? '\t';
  return eachInput(ctx, rest, (t) => { for (const l of lines(t)) {
    if (opts.f !== undefined) { if (!l.includes(d)) { if (!opts.s) ctx.out(l + '\n'); continue; } ctx.out(l.split(d).filter((_, i) => inR(i + 1)).join(d) + '\n'); }
    else ctx.out([...l].filter((_, i) => inR(i + 1)).join('') + '\n');
  } });
});
function expandSet(s) {
  s = s.replace(/\[:upper:\]/g, 'A-Z').replace(/\[:lower:\]/g, 'a-z').replace(/\[:digit:\]/g, '0-9').replace(/\[:alpha:\]/g, 'A-Za-z').replace(/\[:alnum:\]/g, 'A-Za-z0-9').replace(/\[:space:\]/g, ' \t\n\r').replace(/\[:punct:\]/g, '!-/:-@[-`{-~');
  s = unescape(s); const out = [];
  for (let i = 0; i < s.length; i++) { if (s[i + 1] === '-' && i + 2 < s.length) { for (let c = s.charCodeAt(i); c <= s.charCodeAt(i + 2); c++) out.push(String.fromCharCode(c)); i += 2; } else out.push(s[i]); }
  return out;
}
def('tr', (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'dsc', long: { delete: 'd', 'squeeze-repeats': 's', complement: 'c' } });
  let from = expandSet(rest[0] ?? ''); const to = expandSet(rest[1] ?? '');
  let t = ctx.stdin; const set = new Set(from);
  const inSet = (ch) => (opts.c ? !set.has(ch) : set.has(ch));
  if (opts.d) t = [...t].filter((c) => !inSet(c)).join('');
  else if (to.length || !opts.s) t = [...t].map((c) => { if (!inSet(c)) return c; const i = from.indexOf(c); return to.length ? (opts.c ? to[to.length - 1] : to[Math.min(i, to.length - 1)]) : c; }).join('');
  if (opts.s) { const sq = new Set(to.length ? to : from); t = t.replace(/(.)\1+/gs, (m, c) => (sq.has(c) ? c : m)); }
  ctx.out(t);
});
def('rev', (ctx) => eachInput(ctx, ctx.args, (t) => lines(t).forEach((l) => ctx.out([...l].reverse().join('') + '\n'))));
def('nl', (ctx) => { let n = 0; eachInput(ctx, ctx.args.filter((a) => !a.startsWith('-')), (t) => lines(t).forEach((l) => ctx.out(l === '' ? '\n' : `${String(++n).padStart(6)}\t${l}\n`))); });
def('column', (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 't', withArg: 's' });
  const rows = []; eachInput(ctx, rest, (t) => rows.push(...lines(t).map((l) => (opts.s ? l.split(opts.s) : l.trim().split(/\s+/)))));
  if (!opts.t) { rows.forEach((r) => ctx.out(r.join(' ') + '\n')); return; }
  const w = []; rows.forEach((r) => r.forEach((c, i) => { w[i] = Math.max(w[i] || 0, c.length); }));
  rows.forEach((r) => ctx.out(r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(w[i] + 2))).join('') + '\n'));
});
def('seq', (ctx) => { const a = ctx.args.map(Number); const [s, st, e] = a.length === 1 ? [1, 1, a[0]] : a.length === 2 ? [a[0], 1, a[1]] : a; for (let i = s; st > 0 ? i <= e : i >= e; i += st) ctx.out(i + '\n'); });
def('expr', (ctx) => { const a = ctx.args; let r; if (a.length === 3 && /^[+\-*/%]$/.test(a[1]) || a[1] === '\\*') { const [x, op, y] = [Number(a[0]), a[1].replace('\\', ''), Number(a[2])]; r = { '+': x + y, '-': x - y, '*': x * y, '/': Math.trunc(x / y), '%': x % y }[op]; } else r = a.join(' '); ctx.out(r + '\n'); return r === 0 || r === '' ? 1 : 0; });
def('yes', (ctx) => { const s = ctx.args.join(' ') || 'y'; for (let i = 0; i < 20; i++) ctx.out(s + '\n'); });
def('diff', (ctx) => {
  const [a, b] = ctx.args.filter((x) => !x.startsWith('-'));
  const x = lines(ctx.fs.readFile(ctx.abs(a))); const y = lines(ctx.fs.readFile(ctx.abs(b)));
  if (x.join('\n') === y.join('\n')) return 0;
  x.forEach((l, i) => { if (y[i] !== l) ctx.out(`${i + 1}c${i + 1}\n< ${l}\n---\n> ${y[i] ?? ''}\n`); });
  return 1;
});

// ------------------------------------------------------------------ xargs
def('xargs', async (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: '0rtp', withArg: 'nIiLd', stopAtOperand: true });
  const items = opts[0] ? ctx.stdin.split('\0').filter(Boolean) : ctx.stdin.split(/\s+/).filter(Boolean);
  const cmd = rest.length ? rest : ['echo'];
  if (!items.length && opts.r) return 0;
  const run = (argv) => ctx.exec(argv, { out: { write: ctx.out }, err: { write: ctx.err } });
  let code = 0;
  if (opts.I || opts.i) { const ph = opts.I || '{}'; for (const it of items) code = (await run(cmd.map((c) => c.split(ph).join(it)))) || code; return code; }
  const n = opts.n ? Number(opts.n) : items.length || 1;
  for (let i = 0; i < Math.max(items.length, 1); i += n) code = (await run([...cmd, ...items.slice(i, i + n)])) || code;
  return code;
});

// ------------------------------------------------------------------ sed
function parseSed(script, ere) {
  const cmds = []; let i = 0; const n = script.length;
  const readUntil = (delim) => { let s = ''; while (i < n && script[i] !== delim) { if (script[i] === '\\' && i + 1 < n) { s += script[i] === '\\' && script[i + 1] === delim ? delim : script[i] + script[i + 1]; i += 2; } else s += script[i++]; } i++; return s; };
  while (i < n) {
    while (i < n && /[\s;]/.test(script[i])) i++;
    if (i >= n) break;
    const c = { a1: null, a2: null, neg: false };
    const addr = () => {
      if (script[i] === '$') { i++; return { last: true }; }
      if (/\d/.test(script[i])) { let s = ''; while (/\d/.test(script[i])) s += script[i++]; return { line: Number(s) }; }
      if (script[i] === '/') { i++; const re = readUntil('/'); let fl = ''; if (script[i] === 'I') { fl = 'i'; i++; } return { re: new RegExp(toJsRegex(re, { ere }), fl) }; }
      return null;
    };
    c.a1 = addr();
    if (c.a1 && script[i] === ',') { i++; c.a2 = addr(); }
    while (script[i] === ' ') i++;
    if (script[i] === '!') { c.neg = true; i++; }
    c.cmd = script[i++];
    if (c.cmd === 's') {
      const d = script[i++]; const pat = readUntil(d); const rep = readUntil(d); let flags = '';
      while (i < n && /[gpiIe0-9]/.test(script[i])) flags += script[i++];
      c.re = new RegExp(toJsRegex(pat, { ere }), (flags.includes('g') ? 'g' : '') + (/[iI]/.test(flags) ? 'i' : ''));
      c.rep = rep; c.p = flags.includes('p'); c.nth = Number((/\d+/.exec(flags) || [0])[0]);
    } else if (c.cmd === 'y') { const d = script[i++]; const a = readUntil(d); const b = readUntil(d); c.map = new Map([...a].map((ch, k) => [ch, b[k]])); }
    else if (['a', 'i', 'c'].includes(c.cmd)) { if (script[i] === '\\') i++; while (script[i] === ' ') i++; let t = ''; while (i < n && script[i] !== '\n') t += script[i++]; c.text = t; }
    cmds.push(c);
  }
  return cmds;
}
function runSed(text, cmds, { quiet }) {
  const ls = text.split('\n'); const trailing = ls[ls.length - 1] === ''; if (trailing) ls.pop();
  const out = []; const active = new Map();
  for (let ln = 0; ln < ls.length; ln++) {
    let line = ls[ln]; let deleted = false; let quit = false;
    const matchAddr = (a) => a.last ? ln === ls.length - 1 : a.line ? ln + 1 === a.line : a.re.test(line);
    for (const [ci, c] of cmds.entries()) {
      let sel = true;
      if (c.a1) {
        if (c.a2) {
          if (active.get(ci)) { sel = true; if (matchAddr(c.a2) && !c.a2.line) active.delete(ci); else if (c.a2.line && ln + 1 >= c.a2.line) active.delete(ci); else if (c.a2.last && ln === ls.length - 1) active.delete(ci); }
          else if (matchAddr(c.a1)) { sel = true; if (!(c.a2.line && ln + 1 >= c.a2.line)) active.set(ci, true); } else sel = false;
        } else sel = matchAddr(c.a1);
      }
      if (c.neg) sel = !sel;
      if (!sel) continue;
      switch (c.cmd) {
        case 's': {
          let k = 0;
          const rx = c.re.global ? c.re : new RegExp(c.re.source, c.re.flags + (c.nth ? 'g' : ''));
          const repl = (m, ...g) => { k++; if (c.nth && k !== c.nth && !c.re.global) return m; return c.rep.replace(/\\(\d)|&|\\n|\\t|\\(.)/g, (x, d, e) => (d !== undefined ? g[Number(d) - 1] ?? '' : x === '&' ? m : x === '\\n' ? '\n' : x === '\\t' ? '\t' : e)); };
          const before = line; line = line.replace(rx, repl);
          if (c.p && before !== line) out.push(line);
          break;
        }
        case 'd': deleted = true; break;
        case 'p': out.push(line); break;
        case 'q': quit = true; break;
        case 'y': line = [...line].map((ch) => c.map.get(ch) ?? ch).join(''); break;
        case 'a': out.push(null); c.after = c.text; break;
        case 'i': out.push(c.text); break;
        case 'c': line = c.text; break;
        default: break;
      }
      if (deleted) break;
    }
    if (!deleted && !quiet) out.push(line);
    for (const c of cmds) if (c.cmd === 'a' && c.after !== undefined) { out.push(c.after); c.after = undefined; }
    if (quit) break;
  }
  return out.filter((x) => x !== null).map((l) => l + '\n').join('');
}
def('sed', (ctx) => {
  const { opts, all, rest } = getopt(ctx, ctx.args, { flags: 'nEriszu', withArg: 'efl', long: { quiet: 'n', silent: 'n', 'regexp-extended': 'E', 'in-place': 'i', expression: ['e', true] } });
  const scripts = [...(all.e || [])]; const files = [...rest];
  if (!scripts.length) { if (!files.length) throw new CmdError("Usage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...", 1); scripts.push(files.shift()); }
  let cmds; try { cmds = parseSed(scripts.join('\n'), opts.E || opts.r); } catch { throw new CmdError('sed: -e expression #1, char 0: invalid command', 1); }
  if (opts.i) {
    let code = 0;
    for (const f of files) { try { const p = ctx.abs(f); const t = ctx.fs.readFile(p); ctx.fs.writeFile(p, runSed(t, cmds, { quiet: !!opts.n }), {}); } catch (e) { if (e instanceof FsError) { ctx.err(`sed: ${e.code === 'ENOENT' ? `can't read ${f}: No such file or directory` : `couldn't open temporary file ${posix.dirname(ctx.abs(f))}/sedXXXXXX: ${e.text}`}\n`); code = 4; } else throw e; } }
    return code;
  }
  return eachInput(ctx, files, (t) => ctx.out(runSed(t, cmds, { quiet: !!opts.n })));
});

// ------------------------------------------------------------------ awk (practical subset)
function awkTokens(src) {
  const toks = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"') { let s = ''; i++; while (i < src.length && src[i] !== '"') { if (src[i] === '\\') { s += unescape(src.slice(i, i + 2)); i += 2; } else s += src[i++]; } i++; toks.push({ t: 'str', v: s }); continue; }
    if (c === '/' && (!toks.length || ['op', 'punct'].includes(toks[toks.length - 1].t) && !/^[)\]]$/.test(toks[toks.length - 1].v))) { let s = ''; i++; while (i < src.length && src[i] !== '/') { if (src[i] === '\\' && src[i + 1] === '/') { s += '/'; i += 2; } else s += src[i++]; } i++; toks.push({ t: 're', v: s }); continue; }
    const num = /^\d+(\.\d+)?/.exec(src.slice(i)); if (num) { toks.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    const id = /^[A-Za-z_]\w*/.exec(src.slice(i)); if (id) { toks.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    const op = ['&&', '||', '==', '!=', '<=', '>=', '!~', '+=', '-=', '*=', '/=', '++', '--', '>>'].find((o) => src.startsWith(o, i));
    if (op) { toks.push({ t: 'op', v: op }); i += op.length; continue; }
    toks.push({ t: /[{}();,\[\]]/.test(c) ? 'punct' : 'op', v: c }); i++;
  }
  return toks;
}
function compileAwk(src) {
  const toks = awkTokens(src); let p = 0;
  const peek = () => toks[p]; const eat = (v) => { if (toks[p] && toks[p].v === v) { p++; return true; } return false; };
  const expr = (minPrec = 0) => {
    let left = unary();
    for (;;) {
      const t = peek(); if (!t) break;
      const bin = { '||': 1, '&&': 2, '~': 3, '!~': 3, '==': 4, '!=': 4, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 6, '-': 6, '*': 7, '/': 7, '%': 7 };
      if ((t.t === 'op') && bin[t.v] !== undefined && bin[t.v] >= minPrec && !(t.v === '>' && minPrec < 0)) {
        p++; const right = expr(bin[t.v] + 1); const l = left;
        left = ({ '||': (e) => truthy(l(e)) || truthy(right(e)), '&&': (e) => truthy(l(e)) && truthy(right(e)), '~': (e) => new RegExp(String(right(e))).test(String(l(e))), '!~': (e) => !new RegExp(String(right(e))).test(String(l(e))), '==': (e) => cmpv(l(e), right(e)) === 0, '!=': (e) => cmpv(l(e), right(e)) !== 0, '<': (e) => cmpv(l(e), right(e)) < 0, '<=': (e) => cmpv(l(e), right(e)) <= 0, '>': (e) => cmpv(l(e), right(e)) > 0, '>=': (e) => cmpv(l(e), right(e)) >= 0, '+': (e) => num(l(e)) + num(right(e)), '-': (e) => num(l(e)) - num(right(e)), '*': (e) => num(l(e)) * num(right(e)), '/': (e) => num(l(e)) / num(right(e)), '%': (e) => num(l(e)) % num(right(e)) })[t.v];
        continue;
      }
      // implicit concatenation
      if (minPrec <= 5 && (t.t === 'str' || t.t === 'num' || t.t === 'id' || (t.t === 'op' && t.v === '$') || (t.t === 'punct' && t.v === '('))) { const right = expr(6); const l = left; left = (e) => String(str(l(e))) + String(str(right(e))); continue; }
      break;
    }
    return left;
  };
  const truthy = (v) => (typeof v === 'number' ? v !== 0 : typeof v === 'boolean' ? v : v !== '' && v !== undefined);
  const num = (v) => (typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : parseFloat(v) || 0);
  const str = (v) => (typeof v === 'boolean' ? (v ? '1' : '0') : v === undefined ? '' : v);
  const cmpv = (a, b) => { const na = typeof a === 'number' || (a !== '' && !isNaN(a)); const nb = typeof b === 'number' || (b !== '' && !isNaN(b)); if (na && nb) return num(a) - num(b); const x = String(str(a)); const y = String(str(b)); return x < y ? -1 : x > y ? 1 : 0; };
  const unary = () => {
    const t = toks[p++];
    if (!t) return () => '';
    if (t.t === 'num') return () => t.v;
    if (t.t === 'str') return () => t.v;
    if (t.t === 're') return (e) => new RegExp(t.v).test(e.line);
    if (t.t === 'op' && t.v === '!') { const x = unary(); return (e) => !truthy(x(e)); }
    if (t.t === 'op' && t.v === '-') { const x = unary(); return (e) => -num(x(e)); }
    if (t.t === 'op' && t.v === '$') { const x = unary(); return (e) => e.field(num(x(e))); }
    if (t.t === 'punct' && t.v === '(') { const x = expr(); eat(')'); return x; }
    if (t.t === 'id') {
      if (peek() && peek().v === '(' && ['length', 'substr', 'tolower', 'toupper', 'index', 'sprintf', 'int', 'split', 'sqrt'].includes(t.v)) {
        p++; const args = []; if (!eat(')')) { do args.push(expr()); while (eat(',')); eat(')'); }
        return (e) => { const a = args.map((f) => f(e)); switch (t.v) { case 'length': return args.length ? String(str(a[0])).length : e.line.length; case 'substr': return String(str(a[0])).substr(num(a[1]) - 1, a[2] === undefined ? undefined : num(a[2])); case 'tolower': return String(str(a[0])).toLowerCase(); case 'toupper': return String(str(a[0])).toUpperCase(); case 'index': return String(str(a[0])).indexOf(String(str(a[1]))) + 1; case 'int': return Math.trunc(num(a[0])); case 'sqrt': return Math.sqrt(num(a[0])); case 'sprintf': return fmt(a); default: return 0; } };
      }
      if (peek() && (peek().v === '++' || peek().v === '--')) { const o = toks[p++].v; return (e) => { const v = num(e.vars[t.v]); e.vars[t.v] = o === '++' ? v + 1 : v - 1; return v; }; }
      if (peek() && peek().v === '[') { p++; const k = expr(); eat(']'); return (e) => (e.vars[t.v] || {})[str(k(e))] ?? ''; }
      return (e) => (t.v === 'NR' ? e.nr : t.v === 'NF' ? e.nf : e.vars[t.v] ?? '');
    }
    return () => '';
  };
  const fmt = (a) => { let i = 1; return String(a[0]).replace(/%(-?)(\d*)(?:\.(\d+))?([sdif%c])/g, (m, l, w, pr, t) => { if (t === '%') return '%'; let v = a[i++]; v = t === 'd' || t === 'i' ? String(Math.trunc(num(v))) : t === 'f' ? num(v).toFixed(pr === undefined ? 6 : Number(pr)) : String(str(v)); return l ? v.padEnd(Number(w || 0)) : v.padStart(Number(w || 0)); }); };
  const stmt = () => {
    const t = peek();
    if (t.t === 'punct' && t.v === '{') { p++; const body = block(); return body; }
    if (t.t === 'id' && (t.v === 'print' || t.v === 'printf')) {
      p++; const args = [];
      if (peek() && !(peek().t === 'punct' && (peek().v === ';' || peek().v === '}'))) { do { args.push(expr(5)); } while (eat(',')); }
      let redir = null; if (peek() && peek().v === '>') { p++; redir = expr(5); }
      return (e) => { const a = args.map((f) => f(e)); const s = t.v === 'printf' ? fmt(a) : (a.length ? a.map((x) => String(str(x))).join(e.vars.OFS ?? ' ') : e.line) + '\n'; e.write(s, redir ? redir(e) : null); };
    }
    if (t.t === 'id' && t.v === 'if') { p++; eat('('); const c = expr(); eat(')'); const a = stmt(); eat(';'); let b = null; if (peek() && peek().v === 'else') { p++; b = stmt(); } return (e) => (truthy(c(e)) ? a(e) : b && b(e)); }
    if (t.t === 'id' && t.v === 'next') { p++; return (e) => { e.next = true; }; }
    if (t.t === 'id' && t.v === 'exit') { p++; return (e) => { e.exit = true; }; }
    // assignment / increment
    if (t.t === 'id' && toks[p + 1] && ['=', '+=', '-=', '*=', '/=', '++', '--'].includes(toks[p + 1].v) ) {
      p += 2; const name = t.v; const op = toks[p - 1].v;
      if (op === '++' || op === '--') return (e) => { e.vars[name] = num(e.vars[name]) + (op === '++' ? 1 : -1); };
      const r = expr(); return (e) => { const v = r(e); e.vars[name] = op === '=' ? v : op === '+=' ? num(e.vars[name]) + num(v) : op === '-=' ? num(e.vars[name]) - num(v) : op === '*=' ? num(e.vars[name]) * num(v) : num(e.vars[name]) / num(v); };
    }
    if (t.t === 'id' && toks[p + 1] && toks[p + 1].v === '[') { p += 2; const k = expr(); eat(']'); const op = toks[p++].v; const r = op === '++' ? () => 1 : expr(); const name = t.v; return (e) => { const m = (e.vars[name] ||= {}); const key = str(k(e)); m[key] = op === '=' ? r(e) : num(m[key]) + num(r(e)); }; }
    if (t.t === 'id' && t.v === 'for') { /* for (k in arr) */ p++; eat('('); const v = toks[p++].v; p++; const arr = toks[p++].v; eat(')'); const body = stmt(); return (e) => { for (const k of Object.keys(e.vars[arr] || {})) { e.vars[v] = k; body(e); } }; }
    const x = expr(); return (e) => { x(e); };
  };
  const block = () => { const ss = []; while (p < toks.length && !(peek().v === '}')) { if (eat(';')) continue; ss.push(stmt()); } eat('}'); return (e) => { for (const s of ss) { s(e); if (e.next || e.exit) break; } }; };
  const rules = [];
  while (p < toks.length) {
    if (eat(';')) continue;
    let kind = 'main'; let pat = null;
    if (peek().t === 'id' && (peek().v === 'BEGIN' || peek().v === 'END')) kind = toks[p++].v.toLowerCase();
    else if (!(peek().t === 'punct' && peek().v === '{')) { const first = expr(); if (peek() && peek().v === ',') { p++; const second = expr(); let on = false; pat = (e) => { if (!on && truthy(first(e))) { on = true; } if (on) { if (truthy(second(e))) on = false; return true; } return false; }; } else pat = first; }
    let action = null;
    if (peek() && peek().v === '{') { p++; action = block(); }
    rules.push({ kind, pat, action });
  }
  return { rules, fmt };
}
def(['awk', 'mawk', 'gawk'], (ctx) => {
  const { opts, all, rest } = getopt(ctx, ctx.args, { withArg: 'Fvf', flags: '', long: { 'field-separator': ['F', true] } });
  const prog = rest.shift(); if (prog === undefined) throw new CmdError('usage: awk [-F value] [-v var=value] [prog | -f progfile] [file ...]', 2);
  let compiled; try { compiled = compileAwk(prog); } catch { throw new CmdError(`awk: syntax error in program`, 2); }
  const vars = { OFS: ' ' }; for (const v of all.v || []) { const [k, ...val] = v.split('='); vars[k] = val.join('='); }
  let fs = opts.F ?? ' '; if (fs === 't') fs = '\t'; if (opts.F !== undefined) vars.FS = fs;
  const sepRe = fs === ' ' ? /\s+/ : fs.length === 1 ? new RegExp(fs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : new RegExp(fs);
  let nr = 0; let line = ''; let fields = [];
  const e = { vars, get nr() { return nr; }, get nf() { return fields.length; }, get line() { return line; }, field: (n) => (n === 0 ? line : fields[n - 1] ?? ''), write: (s, to) => { if (to) { try { ctx.fs.writeFile(ctx.abs(String(to)), s, { append: true }); } catch { /* ignore */ } } else ctx.out(s); }, next: false, exit: false };
  const set = (l) => { line = l; fields = (fs === ' ' ? l.trim() : l) === '' ? [] : (fs === ' ' ? l.trim() : l).split(sepRe); };
  for (const r of compiled.rules) if (r.kind === 'begin') r.action?.(e);
  const code = eachInput(ctx, rest, (t) => {
    for (const l of lines(t)) {
      if (e.exit) return; nr++; set(l); e.next = false;
      for (const r of compiled.rules) { if (r.kind !== 'main') continue; if (!r.pat || (typeof r.pat(e) !== 'number' ? r.pat(e) : r.pat(e) !== 0)) { if (r.action) r.action(e); else ctx.out(line + '\n'); } if (e.next || e.exit) break; }
    }
  });
  for (const r of compiled.rules) if (r.kind === 'end') r.action?.(e);
  return code;
});
