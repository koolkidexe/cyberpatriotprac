// Helpers shared by command implementations.
import { CmdError } from '../../core/errors.js';
import { FsError } from '../../core/vfs.js';

/** Minimal getopt. flags: boolean short options; withArg: short options taking a value; long: {'name': key or [key, true=takes value]} */
export function getopt(ctx, args, { flags = '', withArg = '', long = {}, stopAtOperand = false, numeric = false } = {}) {
  const opts = {}; const all = {}; const rest = [];
  const set = (k, v) => { if (typeof v === 'boolean') opts[k] = (opts[k] || 0) + 1; else { opts[k] = v; (all[k] ||= []).push(v); } };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { rest.push(...args.slice(i + 1)); break; }
    if (a.startsWith('--') && a.length > 2) {
      const [name, val] = a.slice(2).split(/=(.*)/s);
      let spec = long[name];
      if (!spec) { const m = Object.keys(long).filter((k) => k.startsWith(name)); if (m.length === 1) spec = long[m[0]]; }
      if (!spec) throw new CmdError(`${ctx.name}: unrecognized option '--${name}'\nTry '${ctx.name} --help' for more information.`, 2);
      const [key, takes] = Array.isArray(spec) ? spec : [spec, false];
      if (takes) set(key, val ?? args[++i] ?? ''); else set(key, true);
      continue;
    }
    if (a.length > 1 && a[0] === '-' && !(numeric && /^-\d+$/.test(a))) {
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        if (withArg.includes(c)) { const v = a.slice(j + 1) || args[++i]; if (v === undefined) throw new CmdError(`${ctx.name}: option requires an argument -- '${c}'\nTry '${ctx.name} --help' for more information.`, 2); set(c, v); break; }
        if (flags.includes(c)) set(c, true);
        else throw new CmdError(`${ctx.name}: invalid option -- '${c}'\nTry '${ctx.name} --help' for more information.`, 2);
      }
      continue;
    }
    if (numeric && /^-\d+$/.test(a)) { opts.num = Number(a.slice(1)); continue; }
    rest.push(a);
    if (stopAtOperand) { rest.push(...args.slice(i + 1)); break; }
  }
  return { opts, all, rest };
}

export const errText = (e) => (e instanceof FsError ? e.text : e.message);

/** Print `name: path: reason` to stderr for an FsError (or rethrow). */
export function fsFail(ctx, path, e, verb = '') {
  if (e instanceof FsError) { ctx.err(`${ctx.name}: ${verb ? verb + ' ' : ''}${verb ? `'${path}'` : path}: ${e.text}\n`); return 1; }
  throw e;
}

export const quoteName = (n) => (/[\s'"$&;()<>|*?\\`!#~]/.test(n) ? `'${n.replace(/'/g, "'\\''")}'` : n);

/** Read files named in args (or stdin when none / "-"). Calls fn(text, label). Returns exit status. */
export function eachInput(ctx, files, fn) {
  let code = 0;
  if (!files.length) { fn(ctx.stdin, '-'); return 0; }
  for (const f of files) {
    if (f === '-') { fn(ctx.stdin, '-'); continue; }
    try {
      const p = ctx.abs(f);
      if (ctx.fs.isDir(p)) { ctx.err(`${ctx.name}: ${f}: Is a directory\n`); code = 1; continue; }
      fn(ctx.fs.readFile(p), f);
    } catch (e) {
      if (e instanceof FsError) { ctx.err(`${ctx.name}: ${f}: ${e.text}\n`); code = 1; } else throw e;
    }
  }
  return code;
}

export const isRoot = (ctx) => ctx.uid === 0;
export function needRoot(ctx, msg) {
  if (ctx.uid !== 0) throw new CmdError(msg ?? `${ctx.name}: Permission denied.`, 1);
}
export const lines = (t) => { const a = t.split('\n'); if (a[a.length - 1] === '') a.pop(); return a; };
export const padL = (s, n) => String(s).padStart(n);
export const padR = (s, n) => String(s).padEnd(n);
export const plural = (n, a, b) => (n === 1 ? a : b);
