// Shell builtins: they need the Shell instance (ctx.sh) because they change shell state.
import { cmd, commands } from '../registry.js';
import { FsError } from '../../core/vfs.js';
import * as users from '../../core/users.js';
import { posix } from '../../core/util.js';

// ---------------------------------------------------------------- echo / printf
export function unescape(s, { stop = true } = {}) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\' || i === s.length - 1) { out += s[i]; continue; }
    const c = s[++i];
    switch (c) {
      case 'n': out += '\n'; break; case 't': out += '\t'; break; case 'r': out += '\r'; break; case 'a': out += '\u0007'; break;
      case 'b': out += '\b'; break; case 'f': out += '\f'; break; case 'v': out += '\v'; break; case 'e': case 'E': out += '\u001b'; break;
      case '\\': out += '\\'; break; case '"': out += '"'; break; case "'": out += "'"; break;
      case 'c': if (stop) return { text: out, stopped: true }; break;
      case 'x': { const m = /^[0-9a-fA-F]{1,2}/.exec(s.slice(i + 1)); if (m) { out += String.fromCharCode(parseInt(m[0], 16)); i += m[0].length; } else out += '\\x'; break; }
      case '0': { const m = /^[0-7]{0,3}/.exec(s.slice(i + 1)); out += String.fromCharCode(parseInt(m[0] || '0', 8)); i += m[0].length; break; }
      default: out += '\\' + c;
    }
  }
  return { text: out, stopped: false };
}

cmd('echo', (ctx) => {
  let nl = true; let esc = false; let i = 0;
  for (; i < ctx.args.length; i++) {
    const a = ctx.args[i];
    if (/^-[neE]+$/.test(a)) { if (a.includes('n')) nl = false; if (a.includes('e')) esc = true; if (a.includes('E')) esc = false; } else break;
  }
  let text = ctx.args.slice(i).join(' ');
  if (esc) { const r = unescape(text); text = r.text; if (r.stopped) nl = false; }
  ctx.out(text + (nl ? '\n' : ''));
  return 0;
}, { noHelp: true });

export function formatPrintf(fmt, args) {
  let out = '';
  let ai = 0;
  const next = () => (ai < args.length ? args[ai++] : '');
  const pass = () => {
    for (let i = 0; i < fmt.length; i++) {
      const c = fmt[i];
      if (c === '\\') { const mm = /^\\(?:x[0-9a-fA-F]{1,2}|0[0-7]{0,3}|.)/s.exec(fmt.slice(i)); const e = unescape(mm[0], { stop: false }); out += e.text; i += mm[0].length - 1; continue; }
      if (c !== '%') { out += c; continue; }
      const m = /^%([-+ 0#]*)(\d+)?(?:\.(\d+))?([sdiouxXcfeEgG%b])/.exec(fmt.slice(i));
      if (!m) { out += c; continue; }
      i += m[0].length - 1;
      const [, flags, width, prec, conv] = m;
      let v;
      if (conv === '%') { out += '%'; continue; }
      const a = next();
      if (conv === 's') { v = String(a); if (prec != null) v = v.slice(0, Number(prec)); }
      else if (conv === 'b') v = unescape(String(a)).text;
      else if (conv === 'c') v = String(a)[0] ?? '';
      else if ('di'.includes(conv)) v = String(Math.trunc(Number(a) || 0));
      else if (conv === 'u') v = String(Math.abs(Math.trunc(Number(a) || 0)));
      else if (conv === 'o') v = (Math.trunc(Number(a) || 0)).toString(8);
      else if (conv === 'x') v = (Math.trunc(Number(a) || 0)).toString(16);
      else if (conv === 'X') v = (Math.trunc(Number(a) || 0)).toString(16).toUpperCase();
      else v = (Number(a) || 0).toFixed(prec != null ? Number(prec) : 6);
      if (flags.includes('+') && 'dif'.includes(conv) && Number(a) >= 0) v = '+' + v;
      if (width) {
        const w = Number(width);
        if (flags.includes('-')) v = v.padEnd(w);
        else if (flags.includes('0') && conv !== 's') v = v.padStart(w, '0');
        else v = v.padStart(w);
      }
      out += v;
    }
  };
  pass();
  while (ai < args.length && /%[^%]/.test(fmt)) { const before = ai; pass(); if (ai === before) break; }
  return out;
}
cmd('printf', (ctx) => { if (!ctx.args.length) return ctx.fail('usage: printf format [arguments]', 2); ctx.out(formatPrintf(ctx.args[0], ctx.args.slice(1))); return 0; }, { noHelp: true });

// ---------------------------------------------------------------- test / [
function testExpr(ctx, a) {
  const fs = ctx.fs;
  const file = (p) => { try { return fs.lookup(ctx.resolve(p)); } catch { return null; } };
  const unary = (op, v) => {
    switch (op) {
      case '-z': return v === ''; case '-n': return v !== '';
      case '-e': return !!file(v); case '-f': return file(v)?.t === 'f'; case '-d': return file(v)?.t === 'd';
      case '-L': case '-h': { try { return fs.lstat(ctx.resolve(v)).type === 'link'; } catch { return false; } }
      case '-s': { const n = file(v); return !!n && ctx.sys.vfs.sizeOf(n) > 0; }
      case '-r': try { fs.readFile(ctx.resolve(v)); return true; } catch (e) { return file(v)?.t === 'd' && !(e instanceof FsError && e.code === 'EACCES'); }
      case '-w': { const n = file(v); return !!n && (ctx.isRoot || ((n.mode >> (n.uid === ctx.cred.uid ? 6 : ctx.cred.gids.includes(n.gid) ? 3 : 0)) & 2) !== 0); }
      case '-x': { const n = file(v); return !!n && (n.mode & (ctx.isRoot ? 0o111 : (1 << (n.uid === ctx.cred.uid ? 6 : ctx.cred.gids.includes(n.gid) ? 3 : 0)))) !== 0; }
      default: return false;
    }
  };
  let i = 0;
  const parsePrimary = () => {
    const t = a[i];
    if (t === '!') { i++; return !parsePrimary(); }
    if (t === '(') { i++; const r = parseOr(); i++; return r; }
    if (['-z', '-n', '-e', '-f', '-d', '-L', '-h', '-s', '-r', '-w', '-x'].includes(t) && a.length - i >= 2) { const r = unary(t, a[i + 1]); i += 2; return r; }
    if (i + 2 < a.length + 0 && ['=', '==', '!=', '-eq', '-ne', '-lt', '-le', '-gt', '-ge'].includes(a[i + 1])) {
      const l = a[i]; const op = a[i + 1]; const r = a[i + 2]; i += 3;
      const nl = Number(l); const nr = Number(r);
      switch (op) { case '=': case '==': return l === r; case '!=': return l !== r; case '-eq': return nl === nr; case '-ne': return nl !== nr; case '-lt': return nl < nr; case '-le': return nl <= nr; case '-gt': return nl > nr; default: return nl >= nr; }
    }
    i++;
    return t !== undefined && t !== '';
  };
  const parseAnd = () => { let r = parsePrimary(); while (a[i] === '-a') { i++; const x = parsePrimary(); r = r && x; } return r; };
  const parseOr = () => { let r = parseAnd(); while (a[i] === '-o') { i++; const x = parseAnd(); r = r || x; } return r; };
  return parseOr();
}
cmd(['test', '['], (ctx) => {
  let a = ctx.args;
  if (ctx.name === '[') { if (a[a.length - 1] !== ']') return ctx.fail("missing ']'", 2); a = a.slice(0, -1); }
  return a.length === 0 ? 1 : testExpr(ctx, a) ? 0 : 1;
}, { noHelp: true });

cmd(['true', ':'], () => 0, { noHelp: true });
cmd('false', () => 1, { noHelp: true });

// ---------------------------------------------------------------- navigation / environment
cmd('cd', (ctx) => {
  const sh = ctx.sh;
  let target = ctx.args.filter((a) => !a.startsWith('-') || a === '-')[0];
  if (target === undefined || target === '~') target = ctx.env.HOME;
  else if (target === '-') { target = sh.env.OLDPWD; if (!target) { ctx.err('bash: cd: OLDPWD not set\n'); return 1; } ctx.out(target + '\n'); }
  else if (target.startsWith('~')) { const m = /^~([^/]*)(\/.*)?$/.exec(target); const h = m[1] ? users.getUser(ctx.sys, m[1])?.home : ctx.env.HOME; if (h) target = h + (m[2] || ''); }
  const path = ctx.resolve(target);
  try {
    const node = ctx.fs.lookup(path);
    if (!node) { ctx.err(`bash: cd: ${ctx.args[0] ?? target}: No such file or directory\n`); return 1; }
    if (node.t !== 'd') { ctx.err(`bash: cd: ${ctx.args[0] ?? target}: Not a directory\n`); return 1; }
    if (!ctx.isRoot) { const shift = node.uid === ctx.cred.uid ? 6 : ctx.cred.gids.includes(node.gid) ? 3 : 0; if (!((node.mode >> shift) & 1)) { ctx.err(`bash: cd: ${ctx.args[0] ?? target}: Permission denied\n`); return 1; } }
  } catch (e) { if (e instanceof FsError) { ctx.err(`bash: cd: ${ctx.args[0] ?? target}: ${e.text}\n`); return 1; } throw e; }
  sh.setCwd(path);
  return 0;
}, { noHelp: true });

cmd('pwd', (ctx) => { ctx.out(ctx.cwd + '\n'); return 0; }, { noHelp: true });

cmd(['exit', 'logout'], (ctx) => {
  const sh = ctx.sh;
  if (sh.popFrame()) { ctx.out('exit\n'); return 0; }
  sh.saveHistory();
  ctx.term.exit();
  return 0;
}, { noHelp: true });

cmd('export', (ctx) => {
  const sh = ctx.sh;
  if (!ctx.args.length || ctx.args[0] === '-p') { for (const k of Object.keys(sh.env).sort()) ctx.out(`declare -x ${k}="${sh.env[k]}"\n`); return 0; }
  for (const a of ctx.args) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:=(.*))?$/s.exec(a);
    if (!m) { ctx.err(`bash: export: \`${a}': not a valid identifier\n`); return 1; }
    if (m[2] !== undefined) sh.setVar(m[1], m[2], true);
    else if (sh.vars.has(m[1])) { sh.env[m[1]] = sh.vars.get(m[1]); sh.vars.delete(m[1]); }
  }
  return 0;
}, { noHelp: true });

cmd('unset', (ctx) => { for (const a of ctx.args) { if (a.startsWith('-')) continue; ctx.sh.vars.delete(a); delete ctx.sh.env[a]; } return 0; }, { noHelp: true });

cmd(['env', 'printenv'], async (ctx) => {
  if (ctx.name === 'printenv') {
    if (!ctx.args.length) { for (const k of Object.keys(ctx.env)) ctx.out(`${k}=${ctx.env[k]}\n`); return 0; }
    let rc = 0; for (const k of ctx.args) { if (k in ctx.env) ctx.out(ctx.env[k] + '\n'); else rc = 1; } return rc;
  }
  const rest = [...ctx.args]; const add = {};
  while (rest.length && /^[A-Za-z_]\w*=/.test(rest[0])) { const [k, ...v] = rest.shift().split('='); add[k] = v.join('='); }
  if (!rest.length) { for (const k of Object.keys({ ...ctx.env, ...add })) ctx.out(`${k}=${({ ...ctx.env, ...add })[k]}\n`); return 0; }
  return ctx.exec(rest, ctx.stdio, { env: add });
}, { noHelp: true });

cmd('alias', (ctx) => {
  const sh = ctx.sh;
  if (!ctx.args.length) { for (const [k, v] of [...sh.aliases].sort()) ctx.out(`alias ${k}='${v}'\n`); return 0; }
  let rc = 0;
  for (const a of ctx.args) {
    const m = /^([^=]+)=(.*)$/s.exec(a);
    if (m) sh.aliases.set(m[1], m[2]);
    else if (sh.aliases.has(a)) ctx.out(`alias ${a}='${sh.aliases.get(a)}'\n`);
    else { ctx.err(`bash: alias: ${a}: not found\n`); rc = 1; }
  }
  return rc;
}, { noHelp: true });
cmd('unalias', (ctx) => { for (const a of ctx.args) { if (a === '-a') ctx.sh.aliases.clear(); else if (!ctx.sh.aliases.delete(a)) { ctx.err(`bash: unalias: ${a}: not found\n`); return 1; } } return 0; }, { noHelp: true });

cmd('history', (ctx) => {
  const sh = ctx.sh;
  if (ctx.args[0] === '-c') { sh.history = []; return 0; }
  if (ctx.args[0] === '-w') { sh.saveHistory(); return 0; }
  const n = ctx.args[0] && /^\d+$/.test(ctx.args[0]) ? Number(ctx.args[0]) : sh.history.length;
  const start = Math.max(0, sh.history.length - n);
  const w = String(sh.history.length).length + 1;
  sh.history.slice(start).forEach((l, i) => ctx.out(`${String(start + i + 1).padStart(Math.max(w, 5))}  ${l}\n`));
  return 0;
}, { noHelp: true });

cmd(['source', '.'], async (ctx) => {
  if (!ctx.args.length) return ctx.fail('filename argument required', 2);
  let text;
  try { text = ctx.fs.readFile(ctx.resolve(ctx.args[0])); } catch (e) { if (e instanceof FsError) { ctx.err(`bash: ${ctx.args[0]}: ${e.text}\n`); return 1; } throw e; }
  if (/\.bashrc$/.test(ctx.args[0])) ctx.sh.loadAliases();
  await ctx.sh.runText(text, ctx.stdio);
  return ctx.sh.status;
}, { noHelp: true });

cmd(['bash', 'sh', 'dash'], async (ctx) => {
  const args = [...ctx.args];
  let command = null;
  while (args[0] && args[0].startsWith('-')) { const a = args.shift(); if (a === '-c') { command = args.shift(); break; } if (a === '--version') { ctx.out('GNU bash, version 5.1.16(1)-release (x86_64-pc-linux-gnu)\n'); return 0; } }
  const asUser = ctx.user !== ctx.sh.user ? ctx.user : undefined;
  if (command != null) {
    ctx.sh.positional.push({ name: args[0] ?? ctx.name, args: args.slice(1) });
    try { return await ctx.sh.runScriptAs(command, ctx.stdio, asUser); } finally { ctx.sh.positional.pop(); }
  }
  if (args.length) {
    let text;
    try { text = ctx.fs.readFile(ctx.resolve(args[0])); } catch (e) { if (e instanceof FsError) { ctx.err(`${ctx.name}: ${args[0]}: ${e.text}\n`); return 127; } throw e; }
    return ctx.sh.runScript(text, args[0], args.slice(1), ctx.stdio, { asUser });
  }
  if (ctx.stdin) return ctx.sh.runScriptAs(ctx.readAll(), ctx.stdio, asUser);
  // interactive sub-shell
  ctx.sh.pushFrame(ctx.user, { cwd: ctx.cwd, keepEnv: ctx.env });
  return 0;
}, { noHelp: true });

cmd('read', async (ctx) => {
  const { sh } = ctx;
  const args = [...ctx.args];
  let prompt = ''; let silent = false; const names = [];
  while (args.length) {
    const a = args.shift();
    if (a === '-p') prompt = args.shift() ?? ''; else if (a === '-s') silent = true; else if (a === '-r') continue; else names.push(a);
  }
  let line = ctx.stdin ? ctx.readLine() : await sh.io.readLine(prompt, { echo: !silent });
  if (line == null) return 1;
  if (!names.length) names.push('REPLY');
  const words = names.length === 1 ? [line] : line.split(/\s+/).filter(Boolean);
  names.forEach((n, i) => sh.setVar(n, i === names.length - 1 && names.length > 1 ? words.slice(i).join(' ') : (words[i] ?? '')));
  return 0;
}, { noHelp: true });

cmd('shift', (ctx) => { const f = ctx.sh.positional[ctx.sh.positional.length - 1]; if (f) f.args.shift(); return 0; }, { noHelp: true });
cmd(['set', 'shopt', 'umask', 'ulimit', 'hash', 'trap', 'wait', 'bg', 'fg', 'disown', 'builtin'], (ctx) => { if (ctx.name === 'umask') ctx.out('0022\n'); return 0; }, { noHelp: true });
cmd('jobs', () => 0, { noHelp: true });
cmd('eval', async (ctx) => { await ctx.sh.runText(ctx.args.join(' '), ctx.stdio); return ctx.sh.status; }, { noHelp: true });
cmd('exec', async (ctx) => (ctx.args.length ? ctx.exec(ctx.args) : 0), { noHelp: true });

cmd(['type', 'command'], (ctx) => {
  const sh = ctx.sh;
  const args = ctx.args.filter((a) => !a.startsWith('-'));
  const vOnly = ctx.name === 'command';
  if (vOnly && !ctx.args.includes('-v') && !ctx.args.includes('-V')) return ctx.exec(args, ctx.stdio);
  let rc = 0;
  for (const n of args) {
    if (sh.aliases.has(n)) { ctx.out(vOnly ? `alias ${n}='${sh.aliases.get(n)}'\n` : `${n} is aliased to \`${sh.aliases.get(n)}'\n`); continue; }
    if (['cd', 'exit', 'export', 'alias', 'history', 'source', 'type', 'read', 'echo', 'pwd', 'test', 'unset', 'set', 'eval', 'exec', 'shift', 'umask'].includes(n)) { ctx.out(vOnly ? `${n}\n` : `${n} is a shell builtin\n`); continue; }
    const p = whichPath(ctx, n);
    if (p) ctx.out(vOnly ? `${p}\n` : `${n} is ${p}\n`);
    else { if (!vOnly) ctx.err(`bash: type: ${n}: not found\n`); rc = 1; }
  }
  return rc;
}, { noHelp: true });

export function whichPath(ctx, name) {
  const def = commands.get(name);
  if (def && ctx.sh.available(def)) {
    for (const d of (ctx.env.PATH || '').split(':')) if (ctx.sys.vfs.exists(`${d}/${name}`)) return `${d}/${name}`;
    return `/usr/bin/${name}`;
  }
  for (const d of (ctx.env.PATH || '').split(':')) { const p = `${d}/${name}`; if (ctx.sys.vfs.isFile(p)) return p; }
  return null;
}

cmd('which', (ctx) => {
  let rc = 0;
  for (const n of ctx.args.filter((a) => !a.startsWith('-'))) { const p = whichPath(ctx, n); if (p) ctx.out(p + '\n'); else rc = 1; }
  return rc;
});
cmd('whereis', (ctx) => { for (const n of ctx.args) { const p = whichPath(ctx, n); ctx.out(`${n}:${p ? ' ' + p : ''}\n`); } return 0; });

cmd('clear', (ctx) => { ctx.term.clear(); return 0; }, { noHelp: true });
cmd('reset', (ctx) => { ctx.term.clear(); return 0; }, { noHelp: true });
cmd('sleep', async (ctx) => {
  if (!ctx.args.length) return ctx.fail('missing operand', 1);
  const m = /^(\d*\.?\d+)([smhd]?)$/.exec(ctx.args[0]);
  if (!m) return ctx.fail(`invalid time interval '${ctx.args[0]}'`, 1);
  await ctx.sleep(Number(m[1]) * { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2]] * 1000);
  return 0;
}, { noHelp: true });

void posix;
