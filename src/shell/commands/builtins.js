// Shell builtins: cd, echo, export, test, read, history, source, exit, type, ...
import { builtin } from '../registry.js';
import { REGISTRY } from '../registry.js';
import { ExitSignal, BreakSignal, ContinueSignal } from '../shell.js';
import { CmdError } from '../../core/errors.js';
import { FsError } from '../../core/vfs.js';
import * as users from '../../core/users.js';
import { posix } from '../../core/util.js';

const ESC = { n: '\n', t: '\t', r: '\r', e: '\u001b', a: '\u0007', '\\': '\\', b: '\b', f: '\f', v: '\v' };
export const unescape = (s) => s.replace(/\\(x[0-9a-fA-F]{1,2}|0[0-7]{0,3}|.)/g, (m, c) => (c[0] === 'x' ? String.fromCharCode(parseInt(c.slice(1), 16)) : c[0] === '0' ? String.fromCharCode(parseInt(c.slice(1) || '0', 8)) : ESC[c] ?? m));

builtin('echo', (ctx) => {
  let a = ctx.args; let nl = true; let esc = false;
  while (a[0] && /^-[neE]+$/.test(a[0])) { if (a[0].includes('n')) nl = false; if (a[0].includes('e')) esc = true; if (a[0].includes('E')) esc = false; a = a.slice(1); }
  let s = a.join(' ');
  if (esc) { const cut = s.indexOf('\\c'); if (cut >= 0) { s = s.slice(0, cut); nl = false; } s = unescape(s); }
  ctx.out(s + (nl ? '\n' : ''));
});

export function printf(fmt, args) {
  let ai = 0;
  const next = () => args[ai++] ?? '';
  const out = unescape(fmt).replace(/%(-?)(0?)(\d*)(?:\.(\d+))?([sdixXofc%b])/g, (m, left, zero, w, prec, t) => {
    if (t === '%') return '%';
    let v = next();
    if (t === 'd' || t === 'i') v = String(parseInt(v, 10) || 0);
    else if (t === 'x') v = (parseInt(v, 10) || 0).toString(16);
    else if (t === 'X') v = (parseInt(v, 10) || 0).toString(16).toUpperCase();
    else if (t === 'o') v = (parseInt(v, 10) || 0).toString(8);
    else if (t === 'f') v = (parseFloat(v) || 0).toFixed(prec === undefined ? 6 : Number(prec));
    else if (t === 'c') v = String(v)[0] ?? '';
    else if (t === 'b') v = unescape(String(v));
    else if (prec !== undefined) v = String(v).slice(0, Number(prec));
    const width = Number(w || 0);
    return left ? String(v).padEnd(width) : String(v).padStart(width, zero && t !== 's' ? '0' : ' ');
  });
  return { text: out, used: ai };
}
builtin('printf', (ctx) => {
  if (!ctx.args.length) throw new CmdError('printf: usage: printf [-v var] format [arguments]', 2);
  const [fmt, ...rest] = ctx.args;
  let { text, used } = printf(fmt, rest);
  let consumed = used;
  while (consumed < rest.length && used > 0) { const r = printf(fmt, rest.slice(consumed)); text += r.text; consumed += r.used; if (!r.used) break; }
  ctx.out(text);
});

builtin('pwd', (ctx) => { ctx.out(ctx.shell.cwd + '\n'); });
builtin('cd', (ctx) => {
  const sh = ctx.shell;
  let target = ctx.args[0];
  if (target === undefined || target === '~') target = sh.home();
  else if (target === '-') { target = sh.vars.get('OLDPWD'); ctx.out(target + '\n'); }
  const p = sh.abs(target);
  try {
    if (!sh.sys.vfs.exists(p)) { ctx.err(`bash: cd: ${ctx.args[0]}: No such file or directory\n`); return 1; }
    if (!ctx.fs.isDir(p)) { ctx.err(`bash: cd: ${ctx.args[0]}: Not a directory\n`); return 1; }
    ctx.fs.stat(p); ctx.fs.readdir(p);
  } catch (e) { if (e instanceof FsError) { ctx.err(`bash: cd: ${ctx.args[0]}: ${e.text}\n`); return 1; } throw e; }
  sh.vars.set('OLDPWD', sh.cwd);
  sh.cwd = sh.sys.vfs.realpath(p);
  sh.vars.set('PWD', sh.cwd);
});

builtin('export', (ctx) => {
  if (!ctx.args.length || ctx.args[0] === '-p') { for (const [k, v] of Object.entries(ctx.shell.env).sort()) ctx.out(`declare -x ${k}="${v}"\n`); return; }
  for (const a of ctx.args) { const m = /^([A-Za-z_]\w*)(?:=(.*))?$/s.exec(a); if (!m) { ctx.err(`bash: export: \`${a}': not a valid identifier\n`); return 1; } if (m[2] !== undefined) ctx.shell.setVar(m[1], m[2], true); else ctx.shell.exported.add(m[1]); }
});
builtin('unset', (ctx) => { for (const a of ctx.args) { ctx.shell.vars.delete(a); ctx.shell.exported.delete(a); } });
builtin(['set', 'shopt', 'ulimit', 'trap', 'disown', 'bg', 'fg', 'hash', 'umask', 'local', 'declare', 'typeset', 'readonly', 'wait', 'enable', 'complete', 'bind', 'stty'], (ctx) => {
  if (ctx.name === 'umask') ctx.out('0022\n');
  if (ctx.name === 'declare' || ctx.name === 'local' || ctx.name === 'readonly') for (const a of ctx.args) { const m = /^([A-Za-z_]\w*)=(.*)$/s.exec(a); if (m) ctx.shell.setVar(m[1], m[2]); }
});
builtin('jobs', () => 0);
builtin(':', () => 0);
builtin('true', () => 0);
builtin('false', () => 1);
builtin('shift', (ctx) => { ctx.shell.positional = ctx.shell.positional.slice(Number(ctx.args[0] || 1)); });
builtin('break', (ctx) => { throw new BreakSignal(Number(ctx.args[0] || 1)); });
builtin('continue', (ctx) => { throw new ContinueSignal(Number(ctx.args[0] || 1)); });
builtin('return', (ctx) => { throw new ExitSignal(Number(ctx.args[0] ?? ctx.shell.lastStatus)); });
builtin(['exit', 'logout'], (ctx) => {
  const code = Number(ctx.args[0] ?? ctx.shell.lastStatus) || 0;
  if (ctx.shell.frames.length) { ctx.shell.popUser(); ctx.out('exit\n'); return code; }
  throw new ExitSignal(code);
});

builtin('alias', (ctx) => {
  if (!ctx.args.length) { for (const [k, v] of [...ctx.shell.aliases].sort()) ctx.out(`alias ${k}='${v}'\n`); return; }
  for (const a of ctx.args) {
    const m = /^([^=]+)=(.*)$/s.exec(a);
    if (m) ctx.shell.aliases.set(m[1], m[2]);
    else if (ctx.shell.aliases.has(a)) ctx.out(`alias ${a}='${ctx.shell.aliases.get(a)}'\n`);
    else { ctx.err(`bash: alias: ${a}: not found\n`); return 1; }
  }
});
builtin('unalias', (ctx) => { if (ctx.args[0] === '-a') ctx.shell.aliases.clear(); else for (const a of ctx.args) ctx.shell.aliases.delete(a); });

builtin('history', (ctx) => {
  if (ctx.args[0] === '-c') { ctx.shell.history.length = 0; return; }
  const h = ctx.shell.history; const n = ctx.args[0] && /^\d+$/.test(ctx.args[0]) ? Number(ctx.args[0]) : h.length;
  h.forEach((l, i) => { if (i >= h.length - n) ctx.out(`${String(i + 1).padStart(5)}  ${l}\n`); });
});

builtin(['source', '.'], async (ctx) => {
  if (!ctx.args[0]) { ctx.err('bash: source: filename argument required\n'); return 2; }
  const p = ctx.abs(ctx.args[0]);
  let text;
  try { text = ctx.fs.readFile(p); } catch (e) { ctx.err(`bash: ${ctx.args[0]}: ${e instanceof FsError ? e.text : e.message}\n`); return 1; }
  if (/\.bashrc$/.test(p)) { ctx.shell.loadAliases(); return 0; }
  return ctx.run(text.replace(/^#!.*\n/, ''));
});

builtin(['bash', 'sh', 'dash'], async (ctx) => {
  const a = [...ctx.args];
  while (a[0] && /^-[a-zA-Z]+$/.test(a[0]) && a[0] !== '-c') a.shift();
  if (a[0] === '-c') {
    const sh = ctx.shell; const saved = sh.positional;
    sh.positional = a.slice(2);
    try { return await ctx.run(a[1] ?? ''); } finally { sh.positional = saved; }
  }
  if (!a.length) return ctx.run(ctx.stdin);
  let text;
  try { text = ctx.fs.readFile(ctx.abs(a[0])); } catch (e) { ctx.err(`${ctx.name}: ${a[0]}: ${e instanceof FsError ? e.text : e.message}\n`); return 127; }
  return ctx.shell.runScript(text, a, { stdin: ctx.stdin, out: { write: ctx.out }, err: { write: ctx.err } });
});

builtin('eval', (ctx) => ctx.run(ctx.args.join(' ')));
builtin('exec', async (ctx) => (ctx.args.length ? ctx.exec(ctx.args) : 0));
builtin('command', async (ctx) => {
  const a = [...ctx.args];
  if (a[0] === '-v' || a[0] === '-V') { for (const n of a.slice(1)) { const r = whatIs(ctx, n); if (r) ctx.out(r.path ? r.path + '\n' : n + '\n'); else return 1; } return 0; }
  return a.length ? ctx.exec(a) : 0;
});
builtin('builtin', async (ctx) => ctx.exec(ctx.args));
builtin('sleep', () => 0);

builtin('read', async (ctx) => {
  const a = [...ctx.args]; let prompt = ''; let silent = false; let raw = false;
  while (a[0]?.startsWith('-')) { const o = a.shift(); if (o === '-p') prompt = a.shift() ?? ''; else if (o === '-s') silent = true; else if (o === '-r') raw = true; }
  void raw;
  let line;
  if (ctx.stdin) { const i = ctx.stdin.indexOf('\n'); line = i < 0 ? ctx.stdin : ctx.stdin.slice(0, i); }
  else line = await ctx.io.prompt(prompt, { silent });
  if (line === null || line === undefined) return 1;
  const names = a.length ? a : ['REPLY'];
  const parts = line.split(/\s+/).filter(Boolean);
  names.forEach((n, i) => ctx.shell.setVar(n, i === names.length - 1 ? parts.slice(i).join(' ') : parts[i] ?? ''));
});

function whatIs(ctx, n) {
  if (ctx.shell.aliases.has(n)) return { text: `${n} is aliased to \`${ctx.shell.aliases.get(n)}'`, alias: true };
  if (REGISTRY.builtins[n] && !['sleep', 'true', 'false', 'echo', 'printf', 'bash', 'sh', 'dash'].includes(n)) return { text: `${n} is a shell builtin` };
  const c = REGISTRY.commands[n];
  if (c) {
    if (c.bin && !ctx.sys.vfs.exists(c.bin)) return null;
    const p = c.bin ? c.bin.replace(/^\/usr\/s?bin\//, (m) => m).replace(/^\/bin\//, '/usr/bin/') : `/usr/bin/${n}`;
    return { text: `${n} is ${p}`, path: p };
  }
  if (REGISTRY.builtins[n]) { const p = `/usr/bin/${n}`; return { text: `${n} is ${p}`, path: p }; }
  const f = ctx.shell.findInPath(n);
  return f ? { text: `${n} is ${f}`, path: f } : null;
}
builtin('type', (ctx) => { let code = 0; for (const n of ctx.args.filter((a) => !a.startsWith('-'))) { const r = whatIs(ctx, n); if (r) ctx.out(r.text + '\n'); else { ctx.err(`bash: type: ${n}: not found\n`); code = 1; } } return code; });
builtin('which', (ctx) => { let code = 0; for (const n of ctx.args.filter((a) => !a.startsWith('-'))) { const r = whatIs(ctx, n); if (r && r.path) ctx.out(r.path + '\n'); else code = 1; } return code; });
builtin('whereis', (ctx) => { for (const n of ctx.args) { const r = whatIs(ctx, n); ctx.out(`${n}:${r?.path ? ' ' + r.path : ''}\n`); } });

// ---- test / [
function evalTest(ctx, a) {
  if (!a.length) return false;
  if (a[0] === '!') return !evalTest(ctx, a.slice(1));
  const oi = a.indexOf('-o'); if (oi > 0) return evalTest(ctx, a.slice(0, oi)) || evalTest(ctx, a.slice(oi + 1));
  const ai = a.indexOf('-a'); if (ai > 0) return evalTest(ctx, a.slice(0, ai)) && evalTest(ctx, a.slice(ai + 1));
  if (a.length === 1) return a[0] !== '';
  if (a.length === 2) {
    const [op, v] = a; const p = () => ctx.abs(v); const v2 = ctx.sys.vfs; const o = { cred: ctx.cred };
    const st = () => { try { return v2.stat(p(), o); } catch { return null; } };
    switch (op) {
      case '-n': return v !== ''; case '-z': return v === '';
      case '-e': return v2.exists(p(), o); case '-f': return v2.isFile(p(), o); case '-d': return v2.isDir(p(), o);
      case '-L': case '-h': return v2.isLink(p()); case '-s': { const s = st(); return !!s && s.size > 0; }
      case '-r': case '-w': case '-x': { const s = st(); if (!s) return false; if (ctx.uid === 0) return op !== '-x' || (s.mode & 0o111) !== 0 || s.type === 'dir'; const sh = s.uid === ctx.uid ? 6 : ctx.cred.gids.includes(s.gid) ? 3 : 0; return ((s.mode >> sh) & { '-r': 4, '-w': 2, '-x': 1 }[op]) !== 0; }
      default: return false;
    }
  }
  if (a.length === 3) {
    const [l, op, r] = a; const nl = Number(l); const nr = Number(r);
    switch (op) {
      case '=': case '==': return l === r; case '!=': return l !== r;
      case '-eq': return nl === nr; case '-ne': return nl !== nr; case '-lt': return nl < nr; case '-le': return nl <= nr; case '-gt': return nl > nr; case '-ge': return nl >= nr;
      case '<': return l < r; case '>': return l > r;
      default: return false;
    }
  }
  return false;
}
builtin('test', (ctx) => (evalTest(ctx, ctx.args) ? 0 : 1));
builtin('[', (ctx) => { const a = [...ctx.args]; if (a.pop() !== ']') { ctx.err('bash: [: missing `]\'\n'); return 2; } return evalTest(ctx, a) ? 0 : 1; });
builtin('[[', (ctx) => { const a = [...ctx.args]; if (a[a.length - 1] === ']]') a.pop(); return evalTest(ctx, a.filter((x) => x !== '&&')) ? 0 : 1; });

builtin('clear', (ctx) => { ctx.io.clear?.(); });
builtin('reset', (ctx) => { ctx.io.clear?.(); });
builtin('env', (ctx) => {
  const a = [...ctx.args]; const extra = [];
  while (a[0] && /^\w+=/.test(a[0])) extra.push(a.shift());
  if (a.length) return ctx.exec(a);
  for (const [k, v] of Object.entries(ctx.shell.env)) ctx.out(`${k}=${v}\n`);
});
builtin('printenv', (ctx) => { if (!ctx.args.length) { for (const [k, v] of Object.entries(ctx.shell.env)) ctx.out(`${k}=${v}\n`); return; } let c = 0; for (const n of ctx.args) { if (n in ctx.shell.env) ctx.out(ctx.shell.env[n] + '\n'); else c = 1; } return c; });
builtin('whoami', (ctx) => { ctx.out(ctx.user + '\n'); });
builtin('dirs', (ctx) => ctx.out(ctx.shell.cwd.replace(ctx.shell.home(), '~') + '\n'));
builtin('basename', (ctx) => { const a = ctx.args.filter((x) => !x.startsWith('-')); let b = posix.basename(a[0] ?? ''); if (a[1] && b.endsWith(a[1])) b = b.slice(0, -a[1].length); ctx.out(b + '\n'); });
builtin('dirname', (ctx) => { for (const a of ctx.args) ctx.out(posix.dirname(a) + '\n'); });
builtin('realpath', (ctx) => { for (const a of ctx.args.filter((x) => !x.startsWith('-'))) { try { ctx.out(ctx.sys.vfs.realpath(ctx.abs(a)) + '\n'); } catch { ctx.err(`realpath: ${a}: No such file or directory\n`); return 1; } } });
builtin('readlink', (ctx) => { const a = ctx.args.filter((x) => !x.startsWith('-')); const f = ctx.args.includes('-f'); for (const x of a) { try { ctx.out((f ? ctx.sys.vfs.realpath(ctx.abs(x)) : ctx.sys.vfs.readlink(ctx.abs(x))) + '\n'); } catch { return 1; } } });
void users;
