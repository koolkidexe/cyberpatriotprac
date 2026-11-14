// Command registry and shared option parsing for the simulated command set.
export const commands = new Map();

/** Register a command (or several names for the same function). meta: { pkg, usage, sbin, noHelp } */
export function cmd(names, fn, meta = {}) {
  const list = Array.isArray(names) ? names : [names];
  for (const n of list) commands.set(n, { name: n, fn, ...meta });
}

/**
 * Parse GNU-style options.
 * spec: { bool: 'abc' (flags), val: 'nf' (flags taking a value), long: { name: 'a' | {key, val, optional} }, num: true, stopAtFirst: true }
 */
export function parseOpts(args, spec = {}) {
  const bool = new Set(spec.bool || '');
  const val = new Set(spec.val || '');
  const long = spec.long || {};
  const o = {};
  const rest = [];
  let err = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { rest.push(...args.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const k = eq < 0 ? a.slice(2) : a.slice(2, eq);
      const v = eq < 0 ? undefined : a.slice(eq + 1);
      let d = long[k];
      if (!d) {
        const cand = Object.keys(long).filter((x) => x.startsWith(k));
        if (cand.length === 1) d = long[cand[0]];
      }
      if (!d) { err = `unrecognized option '--${k}'`; break; }
      const key = typeof d === 'string' ? d : d.key;
      if (typeof d === 'object' && d.val) {
        if (v !== undefined) o[key] = v;
        else if (d.optional) o[key] = true;
        else if (i + 1 < args.length) o[key] = args[++i];
        else { err = `option '--${k}' requires an argument`; break; }
      } else o[key] = true;
      continue;
    }
    if (a.length > 1 && a[0] === '-') {
      if (spec.num && /^-\d+$/.test(a)) { o.num = a.slice(1); continue; }
      let bad = false;
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        if (bool.has(c)) o[c] = true;
        else if (val.has(c)) {
          const rem = a.slice(j + 1);
          if (rem !== '') o[c] = rem;
          else if (i + 1 < args.length) o[c] = args[++i];
          else { err = `option requires an argument -- '${c}'`; bad = true; }
          break;
        } else { err = `invalid option -- '${c}'`; bad = true; break; }
      }
      if (bad) break;
      continue;
    }
    if (spec.stopAtFirst) { rest.push(...args.slice(i)); break; }
    rest.push(a);
  }
  return { o, rest, err };
}

/** Print the standard bad-option message; returns exit status 2. */
export function usageError(ctx, err) {
  ctx.err(`${ctx.name}: ${err}\nTry '${ctx.name} --help' for more information.\n`);
  return 2;
}
