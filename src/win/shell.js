// Simulated Windows PowerShell 5.1 and cmd.exe. createWinShell(sys, { user, io, elevated, mode }) returns an object
// with the same surface the terminal app expects from the Linux shell: prompt(), run(line), complete(), history.
// PowerShell supports pipelines of objects, variables, -Param value / -Switch / -Param:value, arrays (a,b), script
// blocks for Where-Object / ForEach-Object, (sub-expressions), default table/list formatting, and the cmdlets CyberPatriot
// players use. cmd.exe supports its built-ins, & and && chaining and | findstr. Native tools come from native.js.
import * as S from './state.js';
import { NATIVE } from './native.js';
import { winVer } from './image.js';
import { sha256hex, md5ish } from '../core/util.js';

const lc = (s) => String(s ?? '').toLowerCase();
const RED = '\x1b[91m'; const RST = '\x1b[0m'; const YEL = '\x1b[93m';
const ESC = { n: '\n', t: '\t', r: '', '`': '`', '"': '"', "'": "'", $: '$', 0: '\0' };

class PSError extends Error { constructor(msg, { id = 'CommandNotFoundException', cat = 'ObjectNotFound', target } = {}) { super(msg); this.fqid = id; this.cat = cat; this.target = target; } }

// ============================================================================ tokenizer
function tokenize(src) {
  const out = []; let i = 0;
  const isSpace = (c) => c === ' ' || c === '\t' || c === '\r';
  const balanced = (open, close) => { let depth = 0; const st = i; let q = null; for (; i < src.length; i++) { const c = src[i]; if (q) { if (c === q) q = null; continue; } if (c === '"' || c === "'") { q = c; continue; } if (c === open) depth++; else if (c === close) { depth--; if (depth === 0) { i++; return src.slice(st + 1, i - 1); } } } return src.slice(st + 1); };
  const member = () => { let m = ''; while (src[i] === '.' && /[A-Za-z_]/.test(src[i + 1] || '')) { i++; let w = ''; while (i < src.length && /[\w]/.test(src[i])) w += src[i++]; m += '.' + w; if (src[i] === '(' && src[i + 1] === ')') { i += 2; m += '()'; } } return m; };
  while (i < src.length) {
    const c = src[i];
    if (isSpace(c)) { i++; continue; }
    if (c === '#' ) break;
    if (c === '\n' || c === ';') { out.push({ t: 'op', v: ';' }); i++; continue; }
    if (c === '|' ) { if (src[i + 1] === '|') { out.push({ t: 'op', v: '||' }); i += 2; } else { out.push({ t: 'op', v: '|' }); i++; } continue; }
    if (c === '&' && src[i + 1] === '&') { out.push({ t: 'op', v: '&&' }); i += 2; continue; }
    if (c === ',') { out.push({ t: 'op', v: ',' }); i++; continue; }
    if (c === '>' ) { const app = src[i + 1] === '>'; i += app ? 2 : 1; out.push({ t: 'op', v: app ? '>>' : '>' }); continue; }
    if (c === '{') { out.push({ t: 'block', v: balanced('{', '}') }); continue; }
    if (c === '(') { const v = balanced('(', ')'); out.push({ t: 'paren', v, mem: member() }); continue; }
    if (c === '@' && src[i + 1] === '(') { i++; const v = balanced('(', ')'); out.push({ t: 'paren', v, mem: member(), arr: true }); continue; }
    if (c === "'") { let s = ''; i++; for (; i < src.length; i++) { if (src[i] === "'") { if (src[i + 1] === "'") { s += "'"; i++; continue; } i++; break; } s += src[i]; } out.push({ t: 'str', v: s }); continue; }
    if (c === '"') { let s = ''; i++; for (; i < src.length; i++) { if (src[i] === '`' && i + 1 < src.length) { s += '\u0001' + src[++i]; continue; } if (src[i] === '"') { if (src[i + 1] === '"') { s += '"'; i++; continue; } i++; break; } s += src[i]; } out.push({ t: 'estr', v: s }); continue; }
    if (c === '$' && /[\w:{?_]/.test(src[i + 1] || '')) {
      i++; let name = '';
      if (src[i] === '{') { name = balanced('{', '}'); } else { while (i < src.length && /[\w:?]/.test(src[i])) name += src[i++]; }
      out.push({ t: 'var', v: name, mem: member() }); continue;
    }
    if (c === '[' ) { // [Type]::Method(...) or [int]"5"
      const st = i; let depth = 0;
      for (; i < src.length; i++) { const ch = src[i]; if (ch === '(' || ch === '[') depth++; else if (ch === ')' || ch === ']') depth--; else if (depth === 0 && isSpace(ch)) break; else if (depth === 0 && (ch === '|' || ch === ';')) break; }
      out.push({ t: 'static', v: src.slice(st, i) }); continue;
    }
    let w = '';
    while (i < src.length && !isSpace(src[i]) && !'|;,{}()\n'.includes(src[i]) && !(src[i] === '&' && src[i + 1] === '&') && src[i] !== '>') {
      if (src[i] === '`' && i + 1 < src.length) { w += src[i + 1]; i += 2; continue; }
      if ((src[i] === '"' || src[i] === "'") && w.length) { const q = src[i]; i++; while (i < src.length && src[i] !== q) w += src[i++]; i++; continue; }
      w += src[i++];
    }
    if (/^-?\d+(\.\d+)?$/.test(w)) out.push({ t: 'num', v: Number(w) });
    else if (/^-?\d+(kb|mb|gb)$/i.test(w)) out.push({ t: 'num', v: parseInt(w, 10) * { kb: 1024, mb: 1048576, gb: 1073741824 }[w.slice(-2).toLowerCase()] });
    else out.push({ t: 'word', v: w });
  }
  return out;
}
const splitOn = (toks, ops) => { const parts = [[]]; const seps = []; for (const t of toks) { if (t.t === 'op' && ops.includes(t.v)) { parts.push([]); seps.push(t.v); } else parts[parts.length - 1].push(t); } return { parts, seps }; };

// ============================================================================ objects and formatting
const obj = (type, props) => Object.assign(Object.create(null), { __t: type }, props);
const VIEWS = {
  LocalUser: ['Name', 'Enabled', 'Description'], LocalGroup: ['Name', 'Description'], LocalGroupMember: ['ObjectClass', 'Name', 'PrincipalSource'],
  Service: ['Status', 'Name', 'DisplayName'], Process: ['Handles', 'NPM(K)', 'PM(K)', 'WS(K)', 'CPU(s)', 'Id', 'SI', 'ProcessName'],
  NetTCPConnection: ['LocalAddress', 'LocalPort', 'RemoteAddress', 'RemotePort', 'State', 'AppliedSetting', 'OwningProcess'],
  SmbShare: ['Name', 'ScopeName', 'Path', 'Description'], ScheduledTask: ['TaskPath', 'TaskName', 'State'], HotFix: ['Source', 'Description', 'HotFixID', 'InstalledBy', 'InstalledOn'],
  FileHash: ['Algorithm', 'Hash', 'Path'], WindowsFeature: ['Display Name', 'Name', 'Install State'], FeatureOperationResult: ['Success', 'Restart Needed', 'Exit Code', 'Feature Result'], WindowsUpdate: ['ComputerName', 'Status', 'KB', 'Size', 'Title'], FirewallRule: ['Name', 'DisplayName', 'Enabled', 'Direction', 'Action'],
  MatchInfo: null, Package: ['Name', 'Version', 'Source', 'ProviderName'],
};
const LISTS = new Set(['NetFirewallProfile', 'MpComputerStatus', 'MpPreference', 'WindowsOptionalFeature', 'ItemProperty', 'ComputerInfo', 'SmbServerConfiguration', 'Acl']);
const visibleKeys = (o) => Object.keys(o).filter((k) => !k.startsWith('__'));
const fmtVal = (v) => (v === true ? 'True' : v === false ? 'False' : v == null ? '' : Array.isArray(v) ? `{${v.join(', ')}}` : v instanceof Date ? fmtDate(v) : typeof v === 'object' ? (v.__t === 'SecureString' ? 'System.Security.SecureString' : String(v.Name ?? v.__t)) : String(v));
export const fmtDate = (d) => { const x = new Date(d); return `${x.getMonth() + 1}/${x.getDate()}/${x.getFullYear()} ${((x.getHours() + 11) % 12) + 1}:${String(x.getMinutes()).padStart(2, '0')}:${String(x.getSeconds()).padStart(2, '0')} ${x.getHours() < 12 ? 'AM' : 'PM'}`; };
function table(objs, cols, width = 120) {
  const w = cols.map((c) => Math.min(60, Math.max(c.length, ...objs.map((o) => fmtVal(o[c]).length))));
  const right = cols.map((c) => objs.every((o) => typeof o[c] === 'number'));
  const cell = (v, i) => { const s = fmtVal(v); const t = s.length > w[i] ? s.slice(0, w[i] - 3) + '...' : s; return right[i] ? t.padStart(w[i]) : t.padEnd(w[i]); };
  const line = (cells) => cells.join(' ').replace(/\s+$/, '').slice(0, width);
  return '\n' + [line(cols.map((c, i) => (right[i] ? c.padStart(w[i]) : c.padEnd(w[i])))), line(cols.map((c, i) => '-'.repeat(Math.max(c.length, Math.min(w[i], c.length + 0))).padEnd(w[i]).slice(0, w[i]).replace(/ /g, ' '))).replace(/-+/g, (m) => m), ...objs.map((o) => line(cols.map((c, i) => cell(o[c], i))))].join('\n') + '\n\n';
}
function list(objs, keys) {
  return '\n' + objs.map((o) => { const ks = keys || visibleKeys(o); const w = Math.max(...ks.map((k) => k.length)); return ks.map((k) => `${k.padEnd(w)} : ${fmtVal(o[k])}`).join('\n'); }).join('\n\n') + '\n\n';
}
export function formatOutput(items, width) {
  let text = '';
  let run = [];
  const flush = () => {
    if (!run.length) return;
    const t = run[0].__t;
    if (t === 'File' || t === 'Dir') { text += fileTable(run); }
    else if (t === 'MatchInfo') { text += '\n' + run.map((m) => `${m.Filename ? `${m.Path}:${m.LineNumber}:` : ''}${m.Line}`).join('\n') + '\n\n'; }
    else if (LISTS.has(t)) text += list(run);
    else if (VIEWS[t]) text += table(run, VIEWS[t], width);
    else if (run[0].__list) text += list(run, run[0].__cols);
    else { const ks = run[0].__cols || visibleKeys(run[0]); text += ks.length > 4 && !run[0].__cols ? list(run, ks) : table(run, ks, width); }
    run = [];
  };
  for (const it of items) {
    if (it == null) continue;
    if (typeof it !== 'object' || Array.isArray(it)) { flush(); text += (Array.isArray(it) ? it.map(fmtVal).join('\n') : fmtVal(it)) + '\n'; continue; }
    if (run.length && (run[0].__t !== it.__t || run[0].__dir !== it.__dir)) flush();
    run.push(it);
  }
  flush();
  return text;
}
function fileTable(run) {
  let text = '';
  const groups = [];
  for (const f of run) { if (!groups.length || groups[groups.length - 1].dir !== f.__dir) groups.push({ dir: f.__dir, items: [] }); groups[groups.length - 1].items.push(f); }
  for (const g of groups) {
    text += `\n\n    Directory: ${g.dir}\n\n\nMode                 LastWriteTime         Length Name\n----                 -------------         ------ ----\n`;
    for (const f of g.items) { const d = new Date(f.LastWriteTime); const dt = `${(d.getMonth() + 1).toString().padStart(2)}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}  ${String(((d.getHours() + 11) % 12) + 1).padStart(2)}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`; text += `${f.Mode.padEnd(14)}${dt.padStart(22)} ${f.__t === 'Dir' ? ''.padStart(14) : String(f.Length).padStart(14)} ${f.Name}\n`; }
  }
  return text + '\n';
}

// ============================================================================ the shell
export function createWinShell(sys, { user = 'student', io, elevated = false, mode = 'ps' } = {}) {
  const home = `/Users/${user}`;
  const WIN_VERSION = winVer(sys);
  const env = { USERPROFILE: `C:\\Users\\${user}`, USERNAME: user, COMPUTERNAME: sys.hostname, WINDIR: 'C:\\Windows', SYSTEMROOT: 'C:\\Windows', SYSTEMDRIVE: 'C:', HOMEDRIVE: 'C:', HOMEPATH: `\\Users\\${user}`, PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)', PROGRAMDATA: 'C:\\ProgramData', APPDATA: `C:\\Users\\${user}\\AppData\\Roaming`, LOCALAPPDATA: `C:\\Users\\${user}\\AppData\\Local`, TEMP: `C:\\Users\\${user}\\AppData\\Local\\Temp`, TMP: `C:\\Users\\${user}\\AppData\\Local\\Temp`, PUBLIC: 'C:\\Users\\Public', OS: 'Windows_NT', PATH: 'C:\\Windows\\system32;C:\\Windows;C:\\Windows\\System32\\Wbem;C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\', PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.JS;.MSC', PROCESSOR_ARCHITECTURE: 'AMD64', COMSPEC: 'C:\\Windows\\system32\\cmd.exe' };
  const sh = {
    sys, user, io, elevated, mode, cwd: sys.vfs.exists(home) ? (elevated && mode === 'cmd' ? '/Windows/System32' : home) : '/', env, history: [], vars: {}, lastExit: 0, status: 0,
    prompt() { return this.mode === 'cmd' ? `${S.toWin(this.cwd)}>` : `PS ${this.regCwd || S.toWin(this.cwd)}> `; },
    title() { return `${this.elevated ? 'Administrator: ' : ''}${this.mode === 'cmd' ? 'Command Prompt' : 'Windows PowerShell'}`; },
    async run(line) { this.history.push(line); if (this.history.length > 500) this.history.shift(); try { if (this.mode === 'cmd') await runCmd(line); else await runPS(line); } catch (e) { if (e && e.shellExit) throw e; reportError(e); } },
    complete(buf, pos) { return complete(buf, pos); },
  };
  if (elevated && mode === 'ps') sh.cwd = '/Windows/System32';
  sh.vars = { true: true, false: false, null: null, home: env.USERPROFILE, pshome: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0', host: 'ConsoleHost', pid: 7212, erroractionpreference: 'Continue', psversiontable: obj('PSVersionTable', { PSVersion: '5.1.22621.2506', PSEdition: 'Desktop', PSCompatibleVersions: '{1.0, 2.0, 3.0, 4.0...}', BuildVersion: `10.0.${WIN_VERSION.build}.2506`, CLRVersion: '4.0.30319.42000', WSManStackVersion: '3.0', PSRemotingProtocolVersion: '2.3', SerializationVersion: '1.1.0.1', __list: true }) };
  const out = (s) => io.write(String(s).replace(/\n/g, '\r\n').replace(/\r\r/g, '\r'));
  const write = (s) => io.write(s);
  void out;

  // ------------------------------------------------------------------------ file helpers
  const vp = (p) => S.resolve(sys, S.fromWin(p, sh.cwd, env));
  const fileCtx = {
    readFile: (p) => { const r = vp(p); return sys.vfs.isFile(r) ? sys.vfs.readFile(r) : null; },
    writeFile: (p, d) => { const r = vp(p); const dir = r.slice(0, r.lastIndexOf('/')) || '/'; if (!sys.vfs.isDir(dir)) throw new PSError(`Could not find a part of the path '${S.toWin(r)}'.`, { id: 'DirectoryNotFoundException' }); sys.vfs.writeFile(r, d, { mode: 0o666, uid: 0, gid: 0 }); },
    exists: (p) => sys.vfs.exists(vp(p)),
  };
  const isHidden = (p) => (sys.win.hidden || []).includes(lc(p)) || /\/(AppData|ProgramData|NTUSER\.DAT|\$Recycle\.Bin|System Volume Information)$/i.test(p);
  const needAdminPath = (p) => /^\/(Windows|Program Files|ProgramData)(\/|$)/i.test(p) && !sh.elevated;

  function nativeCtx(outBuf) {
    return { sys, user, elevated: sh.elevated, out: (s) => outBuf.push(...String(s).replace(/\n$/, '').split('\n')), err: (s) => errOut(String(s).replace(/\n+$/, '')), ...fileCtx };
  }
  const errOut = (s) => write(`${RED}${s}${RST}\n`);
  function reportError(e) {
    if (e instanceof PSError) {
      if (sh.mode === 'cmd') { errOut(e.message); return; }
      const nf = e.fqid === 'CommandNotFoundException';
      errOut(`${e.cmd ? `${e.cmd} : ` : ''}${e.message}\nAt line:1 char:1\n+ ${e.line || ''}\n+ ${'~'.repeat(Math.max(1, (e.cmd || '').length))}\n    + CategoryInfo          : ${e.cat}: (${e.target ?? ''}:${nf ? 'String' : 'String'}) [${nf ? '' : e.cmd || ''}], ${nf ? 'CommandNotFoundException' : e.fqid.split(',')[0] + 'Exception'}\n    + FullyQualifiedErrorId : ${e.fqid}${e.cmd && !nf && !e.fqid.includes(',') ? `,${e.cmd}` : ''}`);
      sh.lastExit = 1; return;
    }
    if (e instanceof S.WinError) { errOut(e.message); sh.lastExit = e.code || 1; return; }
    console.error(e); errOut(String(e?.message || e));
  }

  // ------------------------------------------------------------------------ cmd.exe
  function cmdSplit(line) {
    const args = []; let cur = ''; let q = false; let any = false;
    for (const c of line) { if (c === '"') { q = !q; cur += c; any = true; continue; } if (!q && (c === ' ' || c === '\t')) { if (any) { args.push(cur); cur = ''; any = false; } continue; } cur += c; any = true; }
    if (any) args.push(cur);
    return args.map((a) => a.replace(/^"(.*)"$/, '$1'));
  }
  async function runCmd(line) {
    const expanded = line.replace(/%([^%]+)%/g, (m, v) => env[v.toUpperCase()] ?? m);
    const chain = expanded.split(/\s*(&&|\|\||&)\s*/);
    for (let i = 0; i < chain.length; i += 2) {
      const sep = chain[i - 1];
      if (sep === '&&' && sh.lastExit !== 0) continue;
      if (sep === '||' && sh.lastExit === 0) continue;
      const [first, ...pipes] = chain[i].split(/\s*\|\s*/);
      let lines = await cmdOne(first.trim(), pipes.length > 0);
      for (const p of pipes) { const a = cmdSplit(p); const name = lc(a[0]); const pat = a.filter((x) => !x.startsWith('/')).slice(1).join(' ').replace(/^"|"$/g, ''); const ci = a.some((x) => lc(x) === '/i'); if (name === 'findstr' || name === 'find') { const re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), ci ? 'i' : ''); lines = (lines || []).filter((l) => re.test(l)); } else if (name === 'more' || name === 'sort') { if (name === 'sort') lines = (lines || []).slice().sort(); } }
      if (pipes.length && lines) write(lines.join('\n') + (lines.length ? '\n' : ''));
    }
  }
  async function cmdOne(text, capture) {
    if (!text) return [];
    let redirect = null;
    const rm = /\s(>>?)\s*("?)([^"]+)\2\s*$/.exec(text); if (rm) { redirect = { append: rm[1] === '>>', path: rm[3] }; text = text.slice(0, rm.index); }
    const a = cmdSplit(text); const name = lc(a[0]).replace(/\.exe$/, ''); const args = a.slice(1);
    const buf = [];
    const o = (s) => buf.push(...String(s).replace(/\n$/, '').split('\n'));
    const done = () => { if (redirect) { const prev = redirect.append ? fileCtx.readFile(redirect.path) || '' : ''; fileCtx.writeFile(redirect.path, prev + buf.join('\n') + '\n'); return []; } if (capture) return buf; if (buf.length) write(buf.join('\n') + '\n'); return []; };
    sh.lastExit = 0;
    if (/^[a-z]:$/i.test(name)) return done();
    switch (name) {
      case 'cls': io.clear(); return [];
      case 'exit': if (sh.nested === 'ps') { sh.mode = 'ps'; sh.nested = null; return []; } io.exit(); throw Object.assign(new Error('exit'), { shellExit: 0 });
      case 'echo': o(args.length ? text.slice(text.indexOf(a[0]) + a[0].length + 1) : 'ECHO is on.'); return done();
      case 'cd': case 'chdir': { if (!args.length) { o(S.toWin(sh.cwd)); return done(); } const p = vp(args.join(' ').replace(/^\/d\s+/i, '')); if (!sys.vfs.isDir(p)) { errOut('The system cannot find the path specified.'); sh.lastExit = 1; return []; } sh.cwd = p; return done(); }
      case 'dir': {
        const target = vp(args.filter((x) => !x.startsWith('/')).join(' ') || '.');
        if (!sys.vfs.exists(target)) { errOut('File Not Found'); sh.lastExit = 1; return []; }
        const showAll = args.some((x) => /^\/a/i.test(x)); const bare = args.some((x) => lc(x) === '/b'); const rec = args.some((x) => lc(x) === '/s');
        const walk = (dir) => {
          const names = sys.vfs.readdir(dir).filter((n) => showAll || !isHidden(dir === '/' ? `/${n}` : `${dir}/${n}`)).sort((x, y) => x.localeCompare(y));
          if (bare) { for (const n of names) o(rec ? S.toWin(dir === '/' ? `/${n}` : `${dir}/${n}`) : n); }
          else {
            o(` Directory of ${S.toWin(dir)}\n`);
            let files = 0; let dirs = 0; let bytes = 0;
            for (const n of names) { const p = dir === '/' ? `/${n}` : `${dir}/${n}`; const st = sys.vfs.stat(p); const d = new Date(st.mtime); const dt = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}  ${String(((d.getHours() + 11) % 12) + 1).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`; if (sys.vfs.isDir(p)) { dirs++; o(`${dt}    <DIR>          ${n}`); } else { files++; bytes += st.size; o(`${dt}    ${String(st.size.toLocaleString('en-US')).padStart(14)} ${n}`); } }
            o(`${String(files).padStart(16)} File(s) ${bytes.toLocaleString('en-US').padStart(14)} bytes\n${String(dirs).padStart(16)} Dir(s)  42,184,622,080 bytes free\n`);
          }
          if (rec) for (const n of names) { const p = dir === '/' ? `/${n}` : `${dir}/${n}`; if (sys.vfs.isDir(p) && !sys.vfs.lstat?.(p)?.target) walk(p); }
        };
        if (sys.vfs.isDir(target)) { if (!bare) o(` Volume in drive C has no label.\n Volume Serial Number is 4E21-9A7C\n`); walk(target); } else o(target.split('/').pop());
        return done();
      }
      case 'type': { const t = fileCtx.readFile(args.join(' ')); if (t == null) { errOut('The system cannot find the file specified.'); sh.lastExit = 1; return []; } o(t); return done(); }
      case 'del': case 'erase': { for (const f of args.filter((x) => !x.startsWith('/'))) { const p = vp(f); if (!sys.vfs.isFile(p)) { errOut(`Could Not Find ${S.toWin(p)}`); continue; } if (needAdminPath(p)) { errOut(`${S.toWin(p)}\nAccess is denied.`); continue; } sys.vfs.unlink(p); } return done(); }
      case 'mkdir': case 'md': { const p = vp(args.join(' ')); if (sys.vfs.exists(p)) { errOut(`A subdirectory or file ${args.join(' ')} already exists.`); return []; } sys.vfs.mkdir(p, { parents: true, mode: 0o777 }); return done(); }
      case 'rmdir': case 'rd': { const p = vp(args.filter((x) => !x.startsWith('/')).join(' ')); if (!sys.vfs.isDir(p)) { errOut('The system cannot find the file specified.'); return []; } if (args.some((x) => lc(x) === '/s')) sys.vfs.rmrf(p); else sys.vfs.rmdir(p); return done(); }
      case 'copy': { const [s1, d1] = args.filter((x) => !x.startsWith('/')); sys.vfs.copy(vp(s1), sys.vfs.isDir(vp(d1)) ? `${vp(d1)}/${vp(s1).split('/').pop()}` : vp(d1)); o('        1 file(s) copied.'); return done(); }
      case 'move': { const [s1, d1] = args.filter((x) => !x.startsWith('/')); sys.vfs.rename(vp(s1), sys.vfs.isDir(vp(d1)) ? `${vp(d1)}/${vp(s1).split('/').pop()}` : vp(d1)); o('        1 file(s) moved.'); return done(); }
      case 'ren': case 'rename': { const p = vp(args[0]); sys.vfs.rename(p, p.slice(0, p.lastIndexOf('/')) + '/' + args[1]); return done(); }
      case 'set': { if (!args.length) { for (const [k, v] of Object.entries(env)) o(`${k}=${v}`); return done(); } const m = /^([^=]+)=(.*)$/.exec(args.join(' ')); if (m) env[m[1].toUpperCase()] = m[2]; else for (const [k, v] of Object.entries(env)) if (k.startsWith(args[0].toUpperCase())) o(`${k}=${v}`); return done(); }
      case 'powershell': case 'pwsh': { if (args.length) { const i = args.findIndex((x) => /^-c(ommand)?$/i.test(x)); await runPS(args.slice(i >= 0 ? i + 1 : 0).join(' ')); return []; } sh.mode = 'ps'; sh.nested = 'cmd'; write('Windows PowerShell\nCopyright (C) Microsoft Corporation. All rights reserved.\n\n'); return []; }
      case 'cmd': sh.mode = 'cmd'; write(`Microsoft Windows [Version 10.0.${WIN_VERSION.build}.${WIN_VERSION.ubr}]\n(c) Microsoft Corporation. All rights reserved.\n\n`); return [];
      case 'title': return [];
      case 'help': o('For more information on a specific command, type HELP command-name\nCD, CLS, COPY, DEL, DIR, ECHO, EXIT, FINDSTR, MKDIR, MOVE, REN, RMDIR, SET, TYPE\nAlso available: net, sc, reg, netsh, auditpol, secedit, schtasks, wmic, winget, certutil, netstat, tasklist, taskkill, ipconfig, whoami, systeminfo'); return done();
      case 'findstr': case 'find': { const ci = args.some((x) => lc(x) === '/i'); const rest = args.filter((x) => !x.startsWith('/')); const [pat, ...files] = rest; const re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), ci ? 'i' : ''); for (const f of files) { const t = fileCtx.readFile(f); if (t != null) for (const l of t.split('\n')) if (re.test(l)) o(files.length > 1 ? `${f}:${l}` : l); } return done(); }
      case 'shutdown': if (args.some((x) => /^[/-][rs]$/i.test(x))) io.power?.(args.some((x) => /^[/-]r$/i.test(x)) ? 'reboot' : 'poweroff'); return [];
      default: break;
    }
    if (await launchApp(name, args)) return [];
    const fn = NATIVE[name];
    if (fn) { const c = nativeCtx(buf); sh.lastExit = await fn(c, args) ?? 0; return done(); }
    errOut(`'${a[0]}' is not recognized as an internal or external command,\noperable program or batch file.`); sh.lastExit = 9009; return [];
  }

  // GUI programs started from a prompt
  const LAUNCH = {
    servermanager: 'servermgr', 'fsmgmt.msc': 'shares',
    notepad: 'notepad', explorer: 'explorer', control: 'control', 'lusrmgr.msc': 'lusrmgr', 'services.msc': 'services', 'secpol.msc': 'secpol', 'gpedit.msc': 'gpedit', 'notepad++': 'notepadpp', wireshark: 'wireshark', 'ms-settings:': 'settings', 'compmgmt.msc': 'compmgmt', 'taskschd.msc': 'taskschd', 'eventvwr.msc': 'compmgmt', 'fsmgmt.msc': 'shares',
    taskmgr: 'taskmgr', regedit: 'regedit', 'firewall.cpl': 'firewall', 'appwiz.cpl': 'programs', 'sysdm.cpl': 'sysdm', 'wf.msc': 'firewall', 'ncpa.cpl': 'control', 'optionalfeatures': 'features', chrome: 'firefox', msedge: 'firefox', firefox: 'firefox', thunderbird: 'thunderbird', useraccountcontrolsettings: 'uacsettings', mmc: 'compmgmt', 'windowsdefender:': 'security', 'ms-settings:': 'settings', 'netplwiz': 'lusrmgr',
  };
  async function launchApp(name, args) {
    const key = lc(name).replace(/\.exe$/, '');
    let app = LAUNCH[key];
    if (key === 'start' && args.length) { const t = lc(args[0]); app = LAUNCH[t] || (t.startsWith('ms-settings:') ? 'settings' : t.startsWith('windowsdefender:') ? 'security' : null); if (!app && /^https?:/.test(t)) app = 'firefox'; }
    if (key === 'control' && args[0]) { const m = { userpasswords2: 'lusrmgr', 'admintools': 'control', 'firewall.cpl': 'firewall', 'appwiz.cpl': 'programs', 'sysdm.cpl': 'sysdm', 'system': 'sysdm', 'printers': 'control' }[lc(args[0])]; if (m) app = m; }
    if (!app) return false;
    io.launch(app, { args, user, elevated: sh.elevated, page: key.startsWith('ms-settings') ? key : lc(args[0] || '') });
    return true;
  }

  // ------------------------------------------------------------------------ PowerShell runtime
  function expandStr(s, scope) {
    return s.replace(/\$\(([^)]*)\)/g, (m, e) => fmtVal(evalSyncExpr(e, scope))).replace(/\$(\{[^}]+\}|[\w:]+)((?:\.\w+)*)/g, (m, v, mem) => { const val = getVar(v.replace(/^\{|\}$/g, ''), scope); return fmtVal(member(val, mem)); }).replace(/\u0001(.)/g, (m, c) => ESC[c] ?? c);
  }
  function getVar(name, scope = {}) {
    const n = lc(name);
    if (n.startsWith('env:')) return env[n.slice(4).toUpperCase()] ?? '';
    if (n === '_' || n === 'psitem') return scope._;
    if (n === 'pwd') return S.toWin(sh.cwd);
    if (n === 'lastexitcode') return sh.lastExit;
    if (n === '?') return sh.lastExit === 0;
    if (n in (scope.locals || {})) return scope.locals[n];
    return sh.vars[n];
  }
  function member(v, mem) {
    if (!mem) return v;
    for (const part of mem.split('.').filter(Boolean)) {
      if (v == null) return v;
      if (part === 'Count' || part === 'Length') { if (Array.isArray(v)) { v = v.length; continue; } if (typeof v === 'string') { v = v.length; continue; } }
      if (part === 'ToString()') { v = fmtVal(v); continue; }
      if (part === 'ToUpper()') { v = String(v).toUpperCase(); continue; }
      if (part === 'ToLower()') { v = String(v).toLowerCase(); continue; }
      if (part === 'Trim()') { v = String(v).trim(); continue; }
      if (Array.isArray(v)) { v = v.map((x) => (x && typeof x === 'object' ? x[Object.keys(x).find((k) => lc(k) === lc(part))] : undefined)); continue; }
      if (typeof v === 'object') { const k = Object.keys(v).find((kk) => lc(kk) === lc(part)); v = k ? v[k] : undefined; } else v = undefined;
    }
    return v;
  }
  function staticCall(text) {
    const m64 = /FromBase64String\((["'])([^"']*)\1\)/i.exec(text) || /FromBase64String\((\$\w+)\)/i.exec(text);
    if (m64) {
      const b = m64[2] !== undefined ? m64[2] : fmtVal(getVar(m64[1].slice(1)));
      let dec; try { dec = typeof atob === 'function' ? atob(b.trim()) : Buffer.from(b.trim(), 'base64').toString('binary'); } catch { throw new PSError('Exception calling "FromBase64String" with "1" argument(s): "The input is not a valid Base-64 string as it contains a non-base 64 character, more than two padding characters, or an illegal character among the padding characters. "', { id: 'FormatException', cat: 'NotSpecified' }); }
      if (/GetString/i.test(text)) return dec;
      return [...dec].map((c) => c.charCodeAt(0));
    }
    const mt = /ToBase64String\(\[[\w.]*Encoding\]::\w+\.GetBytes\((["'])(.*)\1\)\)/i.exec(text);
    if (mt) return typeof btoa === 'function' ? btoa(mt[2]) : Buffer.from(mt[2]).toString('base64');
    if (/^\[(Environment|System\.Environment)\]::MachineName/i.test(text)) return sys.hostname;
    if (/^\[(Environment|System\.Environment)\]::UserName/i.test(text)) return user;
    const cast = /^\[(int|string|bool)\](.*)$/i.exec(text); if (cast) { const v = cast[2].replace(/^["']|["']$/g, ''); return lc(cast[1]) === 'int' ? parseInt(v, 10) : lc(cast[1]) === 'bool' ? v === 'True' || v === '$true' : v; }
    throw new PSError(`Unable to find type ${text.split('::')[0]}.`, { id: 'TypeNotFound', cat: 'InvalidOperation' });
  }
  // value of one token
  async function tokVal(t, scope) {
    switch (t.t) {
      case 'str': return t.v;
      case 'estr': return expandStr(t.v, scope);
      case 'num': return t.v;
      case 'var': return member(getVar(t.v, scope), t.mem);
      case 'paren': { const r = await runStatements(t.v, scope, true); const v = r.length === 1 && !t.arr ? r[0] : r; return member(v, t.mem); }
      case 'block': return { __block: t.v };
      case 'static': return staticCall(t.v);
      default: return t.v;
    }
  }
  // expression evaluation (for $x = ..., Where-Object conditions, (a -eq b))
  const CMP = ['-eq', '-ne', '-gt', '-lt', '-ge', '-le', '-like', '-notlike', '-match', '-notmatch', '-contains', '-notcontains', '-in', '-notin', '-replace', '-join', '-split', '-and', '-or', '-not', '!', '+', '-', '*', '/', '-ceq', '-ieq', '-cne', '-cmatch', '-imatch', '-is'];
  const isOp = (t) => t.t === 'word' && CMP.includes(lc(t.v));
  async function evalExpr(toks, scope) {
    // split by -and / -or (left to right), handle -not, then binary operators left to right
    const orParts = splitOnWord(toks, '-or');
    if (orParts.length > 1) { for (const p of orParts) if (truthy(await evalExpr(p, scope))) return true; return false; }
    const andParts = splitOnWord(toks, '-and');
    if (andParts.length > 1) { for (const p of andParts) if (!truthy(await evalExpr(p, scope))) return false; return true; }
    if (toks.length && toks[0].t === 'word' && (lc(toks[0].v) === '-not' || toks[0].v === '!')) return !truthy(await evalExpr(toks.slice(1), scope));
    let i = 0;
    const operand = async () => {
      const vals = [await tokVal(toks[i++], scope)];
      while (toks[i] && toks[i].t === 'op' && toks[i].v === ',') { i++; vals.push(await tokVal(toks[i++], scope)); }
      return vals.length > 1 ? vals : vals[0];
    };
    let v = await operand();
    while (i < toks.length) {
      const op = toks[i++]; if (!op || !isOp(op)) break;
      const rhs = i < toks.length ? await operand() : undefined;
      v = binop(lc(op.v), v, rhs);
    }
    return v;
  }
  const splitOnWord = (toks, w) => { const parts = [[]]; for (const t of toks) { if (t.t === 'word' && lc(t.v) === w) parts.push([]); else parts[parts.length - 1].push(t); } return parts; };
  const truthy = (v) => !(v === false || v == null || v === 0 || v === '' || (Array.isArray(v) && !v.length));
  const wild = (p) => new RegExp('^' + String(p).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
  function binop(op, a, b) {
    const eq = (x, y) => (typeof x === 'string' || typeof y === 'string' ? lc(fmtVal(x)) === lc(fmtVal(y)) : x == y); // eslint-disable-line eqeqeq
    if (Array.isArray(a) && ['-eq', '-ne', '-like', '-match', '-notlike', '-notmatch'].includes(op)) return a.filter((x) => binop(op, x, b));
    switch (op) {
      case '-eq': case '-ieq': return eq(a, b);
      case '-ceq': return a === b;
      case '-ne': case '-cne': return !eq(a, b);
      case '-gt': return a > b; case '-lt': return a < b; case '-ge': return a >= b; case '-le': return a <= b;
      case '-like': return wild(b).test(fmtVal(a)); case '-notlike': return !wild(b).test(fmtVal(a));
      case '-match': case '-imatch': return new RegExp(b, 'i').test(fmtVal(a)); case '-cmatch': return new RegExp(b).test(fmtVal(a)); case '-notmatch': return !new RegExp(b, 'i').test(fmtVal(a));
      case '-contains': return [].concat(a).some((x) => eq(x, b)); case '-notcontains': return ![].concat(a).some((x) => eq(x, b));
      case '-in': return [].concat(b).some((x) => eq(x, a)); case '-notin': return ![].concat(b).some((x) => eq(x, a));
      case '-replace': { const [pat, rep = ''] = [].concat(b); const f = (s) => fmtVal(s).replace(new RegExp(pat, 'gi'), rep.replace(/\$(\d)/g, '$$$1')); return Array.isArray(a) ? a.map(f) : f(a); }
      case '-join': return [].concat(a).map(fmtVal).join(b ?? '');
      case '-split': return fmtVal(a).split(new RegExp(b ?? '\\s+'));
      case '+': return Array.isArray(a) ? a.concat(b) : typeof a === 'number' && typeof b === 'number' ? a + b : fmtVal(a) + fmtVal(b);
      case '-': return a - b; case '*': return typeof a === 'string' ? a.repeat(b) : a * b; case '/': return a / b;
      default: return a;
    }
  }
  function evalSyncExpr(text, scope) { const t = tokenize(text); if (t.length === 1 && t[0].t === 'var') return member(getVar(t[0].v, scope), t[0].mem); return text; }

  // statements / pipelines
  async function runPS(line) { const res = await runStatements(line, {}, false); void res; }
  async function runStatements(text, scope, capture) {
    const toks = tokenize(text);
    const { parts } = splitOn(toks, [';', '&&', '||']);
    const results = [];
    for (const st of parts) {
      if (!st.length) continue;
      let r;
      try { r = await runStatement(st, scope); } catch (e) { if (e && e.shellExit) throw e; if (capture) throw e; reportError(e); continue; }
      if (r.redirect) { const txt = r.items.map((x) => (typeof x === 'object' && x ? formatOutput([x]) : fmtVal(x))).join('\n') + '\n'; const prev = r.redirect.append ? fileCtx.readFile(r.redirect.path) || '' : ''; fileCtx.writeFile(r.redirect.path, prev + txt); continue; }
      if (capture) results.push(...r.items);
      else if (r.items.length) write(formatOutput(r.items, io.cols || 120).replace(/^\n+/, r.items.every((x) => typeof x !== 'object') ? '' : '\n'));
    }
    return results;
  }
  async function runStatement(st, scope) {
    let redirect = null;
    const ri = st.findIndex((t) => t.t === 'op' && (t.v === '>' || t.v === '>>'));
    if (ri >= 0) { const pt = st[ri + 1]; redirect = { append: st[ri].v === '>>', path: pt ? await tokVal(pt, scope) : '' }; st = st.slice(0, ri); }
    // assignment
    if (st.length >= 3 && st[0].t === 'var' && st[1].t === 'word' && ['=', '+='].includes(st[1].v)) {
      const items = await runPipeline(st.slice(2), scope);
      const v = items.length === 1 ? items[0] : items;
      const n = lc(st[0].v);
      if (n.startsWith('env:')) env[n.slice(4).toUpperCase()] = fmtVal(v); else if (st[1].v === '+=') sh.vars[n] = binop('+', sh.vars[n], v); else sh.vars[n] = v;
      return { items: [] };
    }
    const items = await runPipeline(st, scope);
    return { items, redirect };
  }
  async function runPipeline(toks, scope) {
    const { parts } = splitOn(toks, ['|']);
    let input = null;
    for (let k = 0; k < parts.length; k++) {
      const seg = parts[k];
      if (!seg.length) throw new PSError('An empty pipe element is not allowed.', { id: 'EmptyPipeElement', cat: 'ParserError' });
      const head = seg[0];
      if (head.t !== 'word' || /^-?\d/.test(head.v) || (head.t === 'word' && isOp(head) && head.v !== '!') || ['&', '.'].includes(head.v)) {
        if (head.t === 'word' && (head.v === '&' || head.v === '.')) { input = await runCommand(fmtVal(await tokVal(seg[1], scope)), seg.slice(2), input, scope); continue; }
        if (k > 0) throw new PSError('Expressions are only allowed as the first element of a pipeline.', { id: 'ExpressionsMustBeFirstInPipeline', cat: 'ParserError' });
        const v = await evalExpr(seg, scope);
        input = Array.isArray(v) ? v : [v];
        continue;
      }
      input = await runCommand(head.v, seg.slice(1), input, scope);
    }
    return (input || []).filter((x) => x !== undefined);
  }
  // parse -Param value / -Switch / positional
  async function parseArgs(toks, scope, switches = []) {
    const named = {}; const pos = [];
    const sw = new Set(switches.map(lc));
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.t === 'word' && /^-[A-Za-z][\w-]*(:.*)?$/.test(t.v) && !CMP.includes(lc(t.v))) {
        const m = /^-([\w-]+)(?::(.*))?$/.exec(t.v);
        const key = lc(m[1]);
        if (m[2] !== undefined) {
          named[key] = m[2] === '' && toks[i + 1] ? await tokVal(toks[++i], scope) : m[2].startsWith('$') ? getVar(m[2].slice(1), scope) : m[2];
          continue;
        }
        const next = toks[i + 1];
        const nextIsParam = !next || (next.t === 'word' && /^-[A-Za-z]/.test(next.v));
        if (sw.has(key) || nextIsParam) { named[key] = true; continue; }
        i++;
        let v = await tokVal(next, scope);
        const arr = [v];
        while (toks[i + 1] && toks[i + 1].t === 'op' && toks[i + 1].v === ',') { i += 2; arr.push(await tokVal(toks[i], scope)); }
        named[key] = arr.length > 1 ? arr : v;
        continue;
      }
      let v = await tokVal(t, scope);
      const arr = [v];
      while (toks[i + 1] && toks[i + 1].t === 'op' && toks[i + 1].v === ',') { i += 2; arr.push(await tokVal(toks[i], scope)); }
      pos.push(arr.length > 1 ? arr : v);
    }
    return { named, pos, get(...names) { for (const n of names) if (lc(n) in named) return named[lc(n)]; for (const n of names) { const hit = Object.keys(named).find((k) => k.length >= 3 && !FULL_PARAMS.has(k) && lc(n).startsWith(k)); if (hit) return named[hit]; } return undefined; } };
  }
  const FULL_PARAMS = new Set(['password', 'name', 'path', 'value', 'type', 'force', 'filter', 'member', 'group', 'id', 'all', 'online', 'status', 'state', 'enabled', 'description', 'fullname', 'recurse', 'first', 'last', 'raw', 'confirm', 'property']);
  const bool = (v) => v === true || v === 1 || (typeof v === 'string' && ['true', '$true', '1'].includes(lc(v)));

  async function runCommand(name, argToks, input, scope) {
    const key = lc(name);
    const cmd = CMDLETS[ALIASES[key] || key];
    if (cmd) {
      const a = await parseArgs(argToks, scope, cmd.sw || []);
      const ctx = { input: input || [], scope, a, name: cmd.name || name };
      try { const r = await cmd.fn(ctx); return r == null ? [] : Array.isArray(r) ? r : [r]; } catch (e) { if (e instanceof PSError) { e.cmd = e.cmd || cmd.name || name; e.line = `${name} ${argToks.map((t) => (t.t === 'str' ? `'${t.v}'` : t.t === 'estr' ? `"${t.v}"` : t.t === 'var' ? `$${t.v}` : t.v)).join(' ')}`.trim(); } throw e; }
    }
    // native exe / GUI programs
    const raw = [];
    for (const t of argToks) raw.push(t.t === 'var' || t.t === 'paren' ? fmtVal(await tokVal(t, scope)) : t.t === 'estr' ? expandStr(t.v, scope) : t.t === 'op' ? t.v : String(t.v));
    const exe = key.replace(/\.exe$/, '');
    if (exe === 'cmd' && !raw.length) { sh.mode = 'cmd'; sh.nested = 'ps'; write(`Microsoft Windows [Version 10.0.${WIN_VERSION.build}.${WIN_VERSION.ubr}]\n(c) Microsoft Corporation. All rights reserved.\n\n`); return []; }
    if (exe === 'cmd' && /^\/c$/i.test(raw[0] || '')) { await runCmd(raw.slice(1).join(' ')); return []; }
    if ((exe === 'powershell' || exe === 'pwsh') && raw.length) { const i = raw.findIndex((x) => /^-c(ommand)?$/i.test(x)); await runPS(raw.slice(i >= 0 ? i + 1 : 0).join(' ')); return []; }
    if (exe === 'powershell' || exe === 'pwsh') { write('Windows PowerShell\nCopyright (C) Microsoft Corporation. All rights reserved.\n\n'); return []; }
    if (exe === 'shutdown') { if (raw.some((x) => /^[/-][rs]$/i.test(x))) io.power?.(raw.some((x) => /^[/-]r$/i.test(x)) ? 'reboot' : 'poweroff'); return []; }
    if (await launchApp(exe, raw)) return [];
    const fn = NATIVE[exe];
    if (fn && (!ALIASES[key] || key.endsWith('.exe'))) {
      const buf = []; const c = nativeCtx(buf);
      // PowerShell passes '/v' etc. as-is; it also passes quoted args already unquoted
      sh.lastExit = await fn(c, raw) ?? 0;
      return buf;
    }
    if (/\.(ps1|bat|cmd)$/i.test(key)) {
      const t = fileCtx.readFile(name); if (t == null) throw new PSError(`The term '${name}' is not recognized as the name of a cmdlet, function, script file, or operable program.`);
      if (/\.ps1$/i.test(key)) throw new PSError(`File ${S.toWin(vp(name))} cannot be loaded because running scripts is disabled on this system. For more information, see about_Execution_Policies at https:/go.microsoft.com/fwlink/?LinkID=135170.`, { id: 'UnauthorizedAccess', cat: 'SecurityError' });
      for (const l of t.split('\n')) if (l.trim() && !/^@?echo off|^rem /i.test(l.trim())) await runCmd(l.trim());
      return [];
    }
    const nf = new PSError(`The term '${name}' is not recognized as the name of a cmdlet, function, script file, or operable program. Check the spelling of the name, or if a path was included, verify that the path is correct and try again.`, { id: 'CommandNotFoundException' });
    Object.assign(nf, { cmd: name, target: name, line: [name, ...raw].join(' ') });
    throw nf;
  }

  // ------------------------------------------------------------------------ objects for the state
  const userObj = (u) => obj('LocalUser', { Name: u.name, FullName: u.full, Description: u.desc, Enabled: u.enabled, SID: S.sidOf(sys, u), PasswordLastSet: u.hash || u.pwSet ? new Date(u.pwSet) : null, PasswordExpires: u.neverExpires || sys.win.policy.maxAge === 0 ? null : new Date(u.pwSet + sys.win.policy.maxAge * 86400000), PasswordChangeableDate: new Date(u.pwSet + sys.win.policy.minAge * 86400000), PasswordRequired: !!u.hash || u.rid === 500, UserMayChangePassword: !u.cannotChange, PasswordNeverExpires: !!u.neverExpires, AccountExpires: null, LastLogon: u.lastLogon ? new Date(u.lastLogon) : null, PrincipalSource: 'Local', ObjectClass: 'User' });
  const groupObj = (g) => obj('LocalGroup', { Name: g.name, Description: g.desc, SID: `S-1-5-32-${g.rid}`, PrincipalSource: 'Local', ObjectClass: 'Group' });
  const svcObj = (s) => obj('Service', { Status: s.status, Name: s.name, DisplayName: s.display, StartType: s.startType.replace(' (Delayed Start)', ''), ServiceName: s.name, CanStop: s.status === 'Running' && !s.critical, ServiceType: 'Win32ShareProcess' });
  const procObj = (p) => obj('Process', { Handles: 200 + (p.pid % 900), 'NPM(K)': 12 + (p.pid % 40), 'PM(K)': p.rss || 4000, 'WS(K)': (p.rss || 4000) + 2000, 'CPU(s)': +(p.cpu || 0.1).toFixed(2), Id: p.pid, SI: p.user === 'student' ? 1 : 0, ProcessName: p.comm.replace(/\.exe$/i, ''), Path: p.cmd.split(' ')[0].replace(/"/g, ''), UserName: p.user });
  const requireAdmin = (what = 'Access denied') => { if (!sh.elevated) throw new PSError(what, { id: 'AccessDenied', cat: 'PermissionDenied' }); };
  const wrapErr = (fn, target) => { try { return fn(); } catch (e) { if (e instanceof S.WinError) throw new PSError(e.message, { id: 'Microsoft.PowerShell.Commands.' + (e.code === 2221 ? 'UserNotFound' : 'GenericError'), cat: 'ObjectNotFound', target }); throw e; } };
  const names = (v) => [].concat(v ?? []).flatMap((x) => (x && typeof x === 'object' ? [x.Name ?? x.name] : [x])).filter((x) => x != null).map(String);
  const pwOf = (v) => (v && v.__t === 'SecureString' ? v.value : v == null ? undefined : String(v));
  async function confirm(ctx, action, target) {
    if (ctx.a.get('confirm') === false || lc(ctx.a.get('confirm')) === '$false' || lc(ctx.a.get('confirm')) === 'false' || ctx.a.get('force')) return true;
    const ans = await io.readLine(`\nConfirm\nAre you sure you want to perform this action?\nPerforming the operation "${action}" on target "${target}".\n[Y] Yes  [A] Yes to All  [N] No  [L] No to All  [S] Suspend  [?] Help (default is "Y"): `);
    return ans == null ? false : /^(y|a|)$/i.test(ans.trim());
  }
  function itemsAt(p, { recurse, filter, force, include, fileOnly, dirOnly, depth = 99 } = {}) {
    const res = [];
    const pat = filter ? wild(filter) : include ? wild([].concat(include)[0]) : null;
    const visit = (dir, d) => {
      let ns; try { ns = sys.vfs.readdir(dir); } catch { return; }
      for (const n of ns.sort((a, b) => a.localeCompare(b))) {
        const full = dir === '/' ? `/${n}` : `${dir}/${n}`;
        if (!force && isHidden(full)) continue;
        const isD = sys.vfs.isDir(full);
        if ((!pat || pat.test(n)) && !(fileOnly && isD) && !(dirOnly && !isD)) res.push(fileObj(full));
        if (recurse && isD && d < depth && !sys.vfs.lstat?.(full)?.target) visit(full, d + 1);
      }
    };
    if (sys.vfs.isDir(p)) visit(p, 0); else if (sys.vfs.exists(p)) res.push(fileObj(p));
    return res;
  }
  function fileObj(p) {
    const st = sys.vfs.stat(p); const isD = sys.vfs.isDir(p); const n = p.split('/').pop() || 'C:\\';
    const hidden = isHidden(p);
    return obj(isD ? 'Dir' : 'File', { Mode: `${isD ? 'd' : '-'}${isD ? '-' : 'a'}${/^\/Windows\//i.test(p) ? 'r' : '-'}${hidden ? 'h' : '-'}${/^\/Windows\//i.test(p) && isD ? 's' : '-'}-`, LastWriteTime: new Date(st.mtime), Length: isD ? null : st.size, Name: n, FullName: S.toWin(p), Extension: isD ? '' : (/(\.[^.]+)$/.exec(n) || ['', ''])[1], DirectoryName: S.toWin(p.slice(0, p.lastIndexOf('/')) || '/'), __dir: S.toWin(p.slice(0, p.lastIndexOf('/')) || '/'), __path: p, PSIsContainer: isD });
  }
  const pathArg = (ctx, ...keys) => { const v = ctx.a.get(...keys, 'path', 'literalpath') ?? ctx.a.pos[0] ?? ctx.input.map((x) => x?.FullName ?? x?.__path ?? x).filter(Boolean)[0]; return v; };
  const regPathOf = (p) => { const s = String(p); if (/^(HK\w+:|Registry::|HKEY_)/i.test(s)) return S.regKey(s.replace(/^(HK\w\w?\w?):\\?/i, '$1\\')); if (sh.regCwd && !/^[a-z]:/i.test(s)) return S.regKey(sh.regCwd.replace(':', '') + (s && s !== '.' ? '\\' + s : '')); return null; };
  const propObj = (key) => { const n = S.regFind(sys, key); const o = obj('ItemProperty', {}); for (const [k, v] of Object.entries(n.values)) o[k] = v.data; const ps = key.replace(/^HKLM/, 'HKEY_LOCAL_MACHINE').replace(/^HKCU/, 'HKEY_CURRENT_USER'); Object.assign(o, { PSPath: `Microsoft.PowerShell.Core\\Registry::${ps}`, PSParentPath: `Microsoft.PowerShell.Core\\Registry::${ps.slice(0, ps.lastIndexOf('\\'))}`, PSChildName: key.split('\\').pop(), PSDrive: key.slice(0, 4), PSProvider: 'Microsoft.PowerShell.Core\\Registry' }); return o; };

  const CMDLETS = {
    // ------------------------------------------------ accounts
    'get-localuser': { name: 'Get-LocalUser', fn(ctx) { const n = ctx.a.get('name') ?? ctx.a.pos[0]; if (n == null) return S.listUsers(sys).map(userObj); const res = []; for (const x of names(n)) { const m = /[*?]/.test(x) ? S.listUsers(sys).filter((u) => wild(x).test(u.name)) : [S.getUser(sys, x)].filter(Boolean); if (!m.length) throw new PSError(`User ${x} was not found.`, { id: 'UserNotFound,Microsoft.PowerShell.Commands.GetLocalUserCommand', target: x }); res.push(...m.map(userObj)); } return res; } },
    'new-localuser': { name: 'New-LocalUser', sw: ['nopassword', 'passwordneverexpires', 'usermaynotchangepassword', 'disabled', 'accountneverexpires'], async fn(ctx) {
      requireAdmin(); const n = ctx.a.get('name') ?? ctx.a.pos[0];
      let pw = pwOf(ctx.a.get('password'));
      if (pw === undefined && !ctx.a.get('nopassword')) { pw = await io.readLine(`\ncmdlet New-LocalUser at command pipeline position 1\nSupply values for the following parameters:\nPassword: `, { secret: true }); if (pw == null) return null; }
      wrapErr(() => { const u = S.addUser(sys, { name: n, full: ctx.a.get('fullname') || '', desc: ctx.a.get('description') || '', groups: [], neverExpires: !!ctx.a.get('passwordneverexpires'), enabled: !ctx.a.get('disabled') }); if (pw) S.setPassword(sys, n, pw); void u; }, n);
      return userObj(S.getUser(sys, n));
    } },
    'remove-localuser': { name: 'Remove-LocalUser', fn(ctx) { requireAdmin(); for (const n of names(ctx.a.get('name') ?? ctx.a.pos[0] ?? ctx.input)) wrapErr(() => S.removeUser(sys, n), n); } },
    'set-localuser': { name: 'Set-LocalUser', fn(ctx) {
      requireAdmin();
      for (const n of names(ctx.a.get('name') ?? ctx.a.pos[0] ?? ctx.input)) wrapErr(() => {
        if (!S.getUser(sys, n)) throw new S.WinError(`User ${n} was not found.`, 2221);
        const pw = pwOf(ctx.a.get('password')); if (pw !== undefined) S.setPassword(sys, n, pw);
        const f = {}; const pne = ctx.a.get('passwordneverexpires'); if (pne !== undefined) f.neverExpires = bool(pne);
        const umc = ctx.a.get('usermaychangepassword'); if (umc !== undefined) f.cannotChange = !bool(umc);
        if (ctx.a.get('description') !== undefined) f.desc = String(ctx.a.get('description')); if (ctx.a.get('fullname') !== undefined) f.full = String(ctx.a.get('fullname'));
        if (Object.keys(f).length) S.setUserFlags(sys, n, f);
      }, n);
    } },
    'enable-localuser': { name: 'Enable-LocalUser', fn(ctx) { requireAdmin(); for (const n of names(ctx.a.get('name') ?? ctx.a.pos[0] ?? ctx.input)) wrapErr(() => S.setUserFlags(sys, n, { enabled: true }), n); } },
    'disable-localuser': { name: 'Disable-LocalUser', fn(ctx) { requireAdmin(); for (const n of names(ctx.a.get('name') ?? ctx.a.pos[0] ?? ctx.input)) wrapErr(() => S.setUserFlags(sys, n, { enabled: false }), n); } },
    'rename-localuser': { name: 'Rename-LocalUser', fn(ctx) { requireAdmin(); const n = names(ctx.a.get('name') ?? ctx.a.pos[0] ?? ctx.input)[0]; wrapErr(() => S.renameUser(sys, n, ctx.a.get('newname') ?? ctx.a.pos[1]), n); } },
    'get-localgroup': { name: 'Get-LocalGroup', fn(ctx) { const n = ctx.a.get('name') ?? ctx.a.pos[0]; if (n == null) return S.listGroups(sys).map(groupObj); const g = S.getGroup(sys, names(n)[0]); if (!g) throw new PSError(`Group ${n} was not found.`, { id: 'GroupNotFound,Microsoft.PowerShell.Commands.GetLocalGroupCommand', target: n }); return groupObj(g); } },
    'new-localgroup': { name: 'New-LocalGroup', fn(ctx) { requireAdmin(); const n = ctx.a.get('name') ?? ctx.a.pos[0]; wrapErr(() => S.addGroup(sys, n, ctx.a.get('description') || ''), n); return groupObj(S.getGroup(sys, n)); } },
    'remove-localgroup': { name: 'Remove-LocalGroup', fn(ctx) { requireAdmin(); for (const n of names(ctx.a.get('name') ?? ctx.a.pos[0] ?? ctx.input)) wrapErr(() => S.removeGroup(sys, n), n); } },
    'get-localgroupmember': { name: 'Get-LocalGroupMember', fn(ctx) { const n = names(ctx.a.get('group', 'name') ?? ctx.a.pos[0] ?? ctx.input)[0]; const g = S.getGroup(sys, n); if (!g) throw new PSError(`Group ${n} was not found.`, { id: 'GroupNotFound', target: n }); return g.members.map((m) => obj('LocalGroupMember', { ObjectClass: S.getUser(sys, m) ? 'User' : 'Group', Name: S.getUser(sys, m) ? `${sys.hostname}\\${m}` : m, PrincipalSource: S.getUser(sys, m) ? 'Local' : 'Unknown', SID: S.getUser(sys, m) ? S.sidOf(sys, S.getUser(sys, m)) : '' })); } },
    'add-localgroupmember': { name: 'Add-LocalGroupMember', fn(ctx) { requireAdmin(); const g = names(ctx.a.get('group', 'name') ?? ctx.a.pos[0])[0]; for (const m of names(ctx.a.get('member') ?? ctx.a.pos[1] ?? ctx.input).map((x) => x.replace(/^.*\\/, ''))) wrapErr(() => { try { S.addMember(sys, g, m); } catch (e) { if (e.code === 1378) throw new S.WinError(`${sys.hostname}\\${m} is already a member of group ${g}.`, 1378); throw e; } }, m); } },
    'remove-localgroupmember': { name: 'Remove-LocalGroupMember', fn(ctx) { requireAdmin(); const g = names(ctx.a.get('group', 'name') ?? ctx.a.pos[0])[0]; for (const m of names(ctx.a.get('member') ?? ctx.a.pos[1] ?? ctx.input).map((x) => x.replace(/^.*\\/, ''))) wrapErr(() => { try { S.removeMember(sys, g, m); } catch (e) { if (e.code === 1377) throw new S.WinError(`Member ${m} was not found in group ${g}.`, 1377); throw e; } }, m); } },
    'convertto-securestring': { name: 'ConvertTo-SecureString', sw: ['asplaintext', 'force'], fn(ctx) { const s = ctx.a.get('string') ?? ctx.a.pos[0] ?? ctx.input[0]; if (!ctx.a.get('asplaintext')) throw new PSError('Input string was not in a correct format.', { id: 'ImportSecureString_InvalidArgument', cat: 'InvalidArgument' }); return obj('SecureString', { value: String(s), Length: String(s).length }); } },
    'read-host': { name: 'Read-Host', sw: ['assecurestring'], async fn(ctx) { const p = ctx.a.get('prompt') ?? ctx.a.pos[0]; const v = await io.readLine(p ? `${p}: ` : '', { secret: !!ctx.a.get('assecurestring') }); return ctx.a.get('assecurestring') ? obj('SecureString', { value: v ?? '' }) : v ?? ''; } },

    // ------------------------------------------------ services and processes
    'get-service': { name: 'Get-Service', fn(ctx) { const n = ctx.a.get('name') ?? ctx.a.pos[0]; const dn = ctx.a.get('displayname'); let list = S.listServices(sys); if (n != null) { const ns = names(n); list = list.filter((s) => ns.some((x) => wild(x).test(s.name))); if (!list.length) throw new PSError(`Cannot find any service with service name '${ns[0]}'.`, { id: 'NoServiceFoundForGivenName,Microsoft.PowerShell.Commands.GetServiceCommand', target: ns[0] }); } if (dn != null) list = list.filter((s) => wild(dn).test(s.display)); return list.slice().sort((a, b) => lc(a.name).localeCompare(lc(b.name))).map(svcObj); } },
    'stop-service': { name: 'Stop-Service', sw: ['force', 'passthru', 'nowait'], fn(ctx) { requireAdmin(`Service '${names(ctx.a.get('name') ?? ctx.a.pos[0] ?? ctx.input)[0]}' cannot be stopped due to the following error: Cannot open ${names(ctx.a.get('name') ?? ctx.a.pos[0] ?? ctx.input)[0]} service on computer '.'.`); for (const n of names(ctx.a.get('name') ?? ctx.a.pos[0] ?? ctx.input)) { const s = S.getService(sys, n); if (!s) throw new PSError(`Cannot find any service with service name '${n}'.`, { id: 'NoServiceFoundForGivenName', target: n }); write(`${YEL}WARNING: Waiting for service '${s.display} (${s.name})' to stop...${RST}\n`); wrapErr(() => S.stopService(sys, s.name), n); } } },
    'start-service': { name: 'Start-Service', fn(ctx) { requireAdmin(); for (const n of names(ctx.a.get('name') ?? ctx.a.pos[0] ?? ctx.input)) { const s = S.getService(sys, n); if (!s) throw new PSError(`Cannot find any service with service name '${n}'.`, { id: 'NoServiceFoundForGivenName', target: n }); if (s.startType === 'Disabled') throw new PSError(`Service '${s.display} (${s.name})' cannot be started due to the following error: Cannot start service ${s.name} on computer '.'.`, { id: 'CouldNotStartService,Microsoft.PowerShell.Commands.StartServiceCommand', cat: 'OpenError' }); S.startService(sys, s.name); } } },
    'restart-service': { name: 'Restart-Service', sw: ['force'], fn(ctx) { requireAdmin(); for (const n of names(ctx.a.get('name') ?? ctx.a.pos[0] ?? ctx.input)) { const s = S.getService(sys, n); if (!s) throw new PSError(`Cannot find any service with service name '${n}'.`, { target: n }); wrapErr(() => { S.stopService(sys, s.name); S.startService(sys, s.name); }, n); } } },
    'set-service': { name: 'Set-Service', fn(ctx) {
      requireAdmin(`Service '${names(ctx.a.get('name') ?? ctx.a.pos[0] ?? ctx.input)[0]}' cannot be configured due to the following error: Access is denied`);
      for (const n of names(ctx.a.get('name') ?? ctx.a.pos[0] ?? ctx.input)) {
        const s = S.getService(sys, n); if (!s) throw new PSError(`Service ${n} was not found on computer '.'.`, { id: 'InvalidOperationException', target: n });
        const st = ctx.a.get('startuptype'); if (st != null) wrapErr(() => S.setStartType(sys, s.name, st), n);
        const status = ctx.a.get('status'); if (status != null) wrapErr(() => (lc(status) === 'stopped' ? S.stopService(sys, s.name) : S.startService(sys, s.name)), n);
      }
    } },
    'get-process': { name: 'Get-Process', sw: ['includeusername'], fn(ctx) { const n = ctx.a.get('name') ?? ctx.a.pos[0]; const id = ctx.a.get('id'); let list = sys.processes; if (id != null) list = list.filter((p) => [].concat(id).map(Number).includes(p.pid)); if (n != null) { const ns = names(n); list = list.filter((p) => ns.some((x) => wild(x).test(p.comm.replace(/\.exe$/i, '')))); if (!list.length) throw new PSError(`Cannot find a process with the name "${ns[0]}". Verify the process name and call the cmdlet again.`, { id: 'NoProcessFoundForGivenName,Microsoft.PowerShell.Commands.GetProcessCommand', target: ns[0] }); } return list.slice().sort((a, b) => lc(a.comm).localeCompare(lc(b.comm))).map(procObj); } },
    'stop-process': { name: 'Stop-Process', sw: ['force', 'passthru'], fn(ctx) {
      const ids = [].concat(ctx.a.get('id') ?? []).map(Number); const ns = names(ctx.a.get('name') ?? []);
      let targets = ctx.input.filter((x) => x && x.__t === 'Process').map((x) => sys.findProc(x.Id)).filter(Boolean);
      if (ctx.a.pos[0] != null && !ids.length) ids.push(...[].concat(ctx.a.pos[0]).map(Number));
      targets.push(...sys.processes.filter((p) => ids.includes(p.pid) || ns.some((x) => wild(x).test(p.comm.replace(/\.exe$/i, '')))));
      if (!targets.length) throw new PSError(`Cannot find a process with the process identifier ${ids[0] ?? ns[0]}.`, { id: 'NoProcessFoundForGivenId,Microsoft.PowerShell.Commands.StopProcessCommand', target: String(ids[0] ?? ns[0]) });
      for (const p of [...new Set(targets)]) { if (p.user !== user && !sh.elevated) throw new PSError(`Cannot stop process "${p.comm.replace(/\.exe$/i, '')} (${p.pid})" because of the following error: Access is denied`, { id: 'CouldNotStopProcess,Microsoft.PowerShell.Commands.StopProcessCommand', cat: 'CloseError' }); if (['System', 'csrss.exe', 'wininit.exe', 'lsass.exe', 'smss.exe', 'services.exe'].includes(p.comm)) throw new PSError(`Cannot stop process "${p.comm.replace(/\.exe$/i, '')} (${p.pid})" because of the following error: Access is denied`, { cat: 'CloseError' }); sys.killProc(p.pid); }
    } },
    'get-nettcpconnection': { name: 'Get-NetTCPConnection', fn(ctx) { const st = ctx.a.get('state'); const lp = ctx.a.get('localport'); let socks = sys.sockets().filter((s) => s.proto.startsWith('tcp')); if (lp != null) socks = socks.filter((s) => [].concat(lp).map(Number).includes(s.port)); if (st && lc(st) !== 'listen') socks = []; if (lp != null && !socks.length) throw new PSError('No MSFT_NetTCPConnection objects found with property \'LocalPort\' equal to \'' + lp + '\'.  Verify the value of the property and retry.', { id: 'CmdletizationQuery_NotFound_LocalPort,Get-NetTCPConnection', target: String(lp) }); return socks.map((s) => obj('NetTCPConnection', { LocalAddress: s.addr === '*' ? '::' : s.addr, LocalPort: s.port, RemoteAddress: s.addr === '*' ? '::' : '0.0.0.0', RemotePort: 0, State: 'Listen', AppliedSetting: '', OwningProcess: s.pid })); } },

    // ------------------------------------------------ firewall, smb, features, defender, updates
    'get-netfirewallprofile': { name: 'Get-NetFirewallProfile', fn(ctx) { const n = names(ctx.a.get('name', 'profile') ?? ctx.a.pos[0] ?? []); return Object.entries(sys.win.firewall).filter(([k]) => !n.length || n.some((x) => lc(x) === lc(k))).map(([k, v]) => obj('NetFirewallProfile', { Name: k, Enabled: v.enabled, DefaultInboundAction: 'NotConfigured', DefaultOutboundAction: 'NotConfigured', AllowInboundRules: 'NotConfigured', AllowLocalFirewallRules: 'NotConfigured', AllowUnicastResponseToMulticast: 'NotConfigured', NotifyOnListen: 'True', LogFileName: '%systemroot%\\system32\\LogFiles\\Firewall\\pfirewall.log', LogMaxSizeKilobytes: 4096, LogAllowed: 'False', LogBlocked: 'False' })); } },
    'set-netfirewallprofile': { name: 'Set-NetFirewallProfile', sw: ['all'], fn(ctx) { requireAdmin('Access is denied.'); const en = ctx.a.get('enabled'); if (en === undefined) return; const which = ctx.a.get('all') ? ['Domain', 'Private', 'Public'] : names(ctx.a.get('profile', 'name') ?? ctx.a.pos[0] ?? ctx.input).flatMap((x) => x.split(',')).map((x) => x.trim()); wrapErr(() => S.setFirewall(sys, which.length ? which : ['Domain', 'Private', 'Public'], bool(en)), which.join(',')); } },
    'get-netfirewallrule': { name: 'Get-NetFirewallRule', fn(ctx) { const dn = ctx.a.get('displayname', 'name') ?? ctx.a.pos[0]; return sys.win.fwRules.filter((r) => dn == null || wild(dn).test(r.name)).map((r) => obj('FirewallRule', { Name: r.id || r.name, DisplayName: r.name, Enabled: r.enabled, Direction: r.dir, Action: r.action, LocalPort: r.port })); } },
    'remove-netfirewallrule': { name: 'Remove-NetFirewallRule', fn(ctx) { requireAdmin(); const ns = names(ctx.a.get('displayname', 'name') ?? ctx.a.pos[0] ?? ctx.input.map((x) => x.DisplayName)); const before = sys.win.fwRules.length; sys.win.fwRules = sys.win.fwRules.filter((r) => !ns.some((n) => lc(n) === lc(r.name) || lc(n) === lc(r.id))); if (before === sys.win.fwRules.length) throw new PSError(`No MSFT_NetFirewallRule objects found with property 'DisplayName' equal to '${ns[0]}'.`, { target: ns[0] }); sys.touch('win'); } },
    'disable-netfirewallrule': { name: 'Disable-NetFirewallRule', fn(ctx) { requireAdmin(); const ns = names(ctx.a.get('displayname', 'name') ?? ctx.a.pos[0] ?? ctx.input.map((x) => x.DisplayName)); for (const r of sys.win.fwRules) if (ns.some((n) => lc(n) === lc(r.name))) r.enabled = false; sys.touch('win'); } },
    'get-smbshare': { name: 'Get-SmbShare', fn(ctx) { const n = ctx.a.get('name') ?? ctx.a.pos[0]; return S.listShares(sys).filter((s) => n == null || wild(n).test(s.name)).map((s) => obj('SmbShare', { Name: s.name, ScopeName: '*', Path: s.path, Description: s.desc })); } },
    'remove-smbshare': { name: 'Remove-SmbShare', sw: ['force'], async fn(ctx) { requireAdmin(); for (const n of names(ctx.a.get('name') ?? ctx.a.pos[0] ?? ctx.input)) { if (!(await confirm(ctx, 'Remove-Share', `*,${n}`))) continue; wrapErr(() => S.removeShare(sys, n), n); } } },
    'new-smbshare': { name: 'New-SmbShare', fn(ctx) { requireAdmin(); const n = ctx.a.get('name') ?? ctx.a.pos[0]; const p = ctx.a.get('path') ?? ctx.a.pos[1]; wrapErr(() => S.addShare(sys, n, p, ctx.a.get('description') || ''), n); return obj('SmbShare', { Name: n, ScopeName: '*', Path: p, Description: ctx.a.get('description') || '' }); } },
    'get-smbserverconfiguration': { name: 'Get-SmbServerConfiguration', fn() { return obj('SmbServerConfiguration', { EnableSMB1Protocol: S.smb1On(sys), EnableSMB2Protocol: true, EncryptData: false, RejectUnencryptedAccess: true, RequireSecuritySignature: false, AutoShareWorkstation: true }); } },
    'set-smbserverconfiguration': { name: 'Set-SmbServerConfiguration', sw: ['force'], async fn(ctx) { requireAdmin(); const v = ctx.a.get('enablesmb1protocol'); if (v === undefined) return; if (!ctx.a.get('force') && !(await confirm(ctx, 'Modify', 'SMB Server Configuration'))) return; S.setFeature(sys, 'SMB1Protocol', bool(v)); } },
    'get-windowsoptionalfeature': { name: 'Get-WindowsOptionalFeature', sw: ['online'], fn(ctx) { if (!sh.elevated) throw new PSError('The requested operation requires elevation.', { id: 'Microsoft.Dism.Commands.GetWindowsOptionalFeatureCommand', cat: 'NotSpecified' }); const n = ctx.a.get('featurename'); return Object.entries(sys.win.features).filter(([k]) => n == null || wild(n).test(k)).map(([k, f]) => obj('WindowsOptionalFeature', { FeatureName: k, DisplayName: f.display, Description: f.display, RestartRequired: 'Possible', State: f.state })); } },
    'disable-windowsoptionalfeature': { name: 'Disable-WindowsOptionalFeature', sw: ['online', 'norestart', 'remove'], async fn(ctx) { if (!sh.elevated) throw new PSError('The requested operation requires elevation.', { cat: 'NotSpecified' }); const n = ctx.a.get('featurename'); wrapErr(() => S.setFeature(sys, n, false), n); if (!ctx.a.get('norestart')) { const a = await io.readLine('Do you want to restart the computer to complete this operation now?\n[Y] Yes  [N] No  [?] Help (default is "Y"): '); if (a != null && /^y?$/i.test(a.trim())) io.power?.('reboot'); } return obj('ImageObject', { Path: '', Online: true, RestartNeeded: true, __list: true }); } },
    'enable-windowsoptionalfeature': { name: 'Enable-WindowsOptionalFeature', sw: ['online', 'norestart', 'all'], fn(ctx) { if (!sh.elevated) throw new PSError('The requested operation requires elevation.', { cat: 'NotSpecified' }); const n = ctx.a.get('featurename'); wrapErr(() => S.setFeature(sys, n, true), n); return obj('ImageObject', { Path: '', Online: true, RestartNeeded: true, __list: true }); } },
    'get-mpcomputerstatus': { name: 'Get-MpComputerStatus', fn() { const d = sys.win.defender; return obj('MpComputerStatus', { AMEngineVersion: '1.1.23110.2', AMProductVersion: '4.18.23110.3', AMRunningMode: 'Normal', AMServiceEnabled: true, AntispywareEnabled: true, AntivirusEnabled: true, BehaviorMonitorEnabled: d.realtime, IoavProtectionEnabled: d.realtime, IsTamperProtected: d.tamper, NISEnabled: true, OnAccessProtectionEnabled: S.realtimeOn(sys), RealTimeProtectionEnabled: S.realtimeOn(sys), AntivirusSignatureLastUpdated: fmtDate(sys.now() - 86400000 * 9) }); } },
    'get-mppreference': { name: 'Get-MpPreference', fn() { const d = sys.win.defender; return obj('MpPreference', { DisableRealtimeMonitoring: !d.realtime, DisableBehaviorMonitoring: false, DisableIOAVProtection: false, MAPSReporting: d.cloud ? 2 : 0, SubmitSamplesConsent: d.sampleSubmission ? 1 : 2, PUAProtection: d.pua ? 1 : 0, EnableNetworkProtection: 0 }); } },
    'set-mppreference': { name: 'Set-MpPreference', fn(ctx) { if (!sh.elevated) throw new PSError('You don\'t have enough permissions to perform the requested operation.', { id: 'HRESULT 0x80070005,Set-MpPreference', cat: 'PermissionDenied' }); const d = {}; const r = ctx.a.get('disablerealtimemonitoring'); if (r !== undefined) d.realtime = !bool(r); const m = ctx.a.get('mapsreporting'); if (m !== undefined) d.cloud = Number(m) !== 0 && lc(m) !== 'disabled'; const p = ctx.a.get('puaprotection'); if (p !== undefined) d.pua = Number(p) === 1 || lc(p) === 'enabled'; if (sys.win.defender.tamper && r !== undefined && bool(r)) { write(`${YEL}WARNING: Tamper protection is on, so this change was blocked.${RST}\n`); return; } S.setDefender(sys, d); } },
    'get-hotfix': { name: 'Get-HotFix', fn() { return [...sys.win.installedUpdates, ...sys.win.updates.filter((u) => u.installed).map((u) => u.kb)].map((kb) => obj('HotFix', { Source: sys.hostname, Description: 'Security Update', HotFixID: kb, InstalledBy: 'NT AUTHORITY\\SYSTEM', InstalledOn: '11/14/2023 12:00:00 AM' })); } },
    'get-windowsupdate': { name: 'Get-WindowsUpdate', fn() { return S.pendingUpdates(sys).map((u) => obj('WindowsUpdate', { ComputerName: sys.hostname, Status: '-------', KB: u.kb, Size: `${u.size}MB`, Title: u.title })); } },
    'install-windowsupdate': { name: 'Install-WindowsUpdate', sw: ['acceptall', 'autoreboot', 'ignorereboot', 'microsoftupdate'], async fn(ctx) { requireAdmin('Access is denied. (Exception from HRESULT: 0x80070005 (E_ACCESSDENIED))'); const list = S.pendingUpdates(sys); if (!list.length) return null; if (!ctx.a.get('acceptall')) { const ans = await io.readLine(`Confirm\nAre you sure you want to perform this action?\nPerforming the operation "(${new Date(sys.now()).toLocaleString()}) ${list[0].title}" on target "${sys.hostname}".\n[Y] Yes  [A] Yes to All  [N] No  [L] No to All  [S] Suspend  [?] Help (default is "Y"): `); if (ans == null || /^n|^l/i.test(ans.trim())) return null; } S.installUpdates(sys); if (ctx.a.get('autoreboot')) io.power?.('reboot'); else write('Reboot is required to finish installing updates. Run Restart-Computer.\n'); return list.map((u) => obj('WindowsUpdate', { ComputerName: sys.hostname, Status: 'ADI----', KB: u.kb, Size: `${u.size}MB`, Title: u.title })); } },
    'get-package': { name: 'Get-Package', fn(ctx) { const n = ctx.a.get('name') ?? ctx.a.pos[0]; return S.listPrograms(sys).filter((p) => n == null || wild(n).test(p.name)).map((p) => obj('Package', { Name: p.name, Version: p.version, Source: p.dir ? S.toWin(p.dir) : '', ProviderName: 'Programs' })); } },
    'uninstall-package': { name: 'Uninstall-Package', sw: ['force'], fn(ctx) { requireAdmin(); for (const n of names(ctx.a.get('name') ?? ctx.a.pos[0] ?? ctx.input)) wrapErr(() => S.uninstallProgram(sys, n), n); } },

    // ------------------------------------------------ scheduled tasks
    'get-scheduledtask': { name: 'Get-ScheduledTask', fn(ctx) { const n = ctx.a.get('taskname') ?? ctx.a.pos[0]; const tp = ctx.a.get('taskpath'); let list = S.listTasks(sys); if (n != null) { list = list.filter((t) => wild(n).test(t.name)); if (!list.length) throw new PSError(`No MSFT_ScheduledTask objects found with property 'TaskName' equal to '${n}'.  Verify the value of the property and retry.`, { id: 'CmdletizationQuery_NotFound_TaskName,Get-ScheduledTask', target: n }); } if (tp != null) list = list.filter((t) => wild(tp).test(t.path)); return list.map((t) => obj('ScheduledTask', { TaskPath: t.path, TaskName: t.name, State: t.enabled ? 'Ready' : 'Disabled', Author: t.author, Description: t.desc, Actions: t.action, Triggers: t.trigger })); } },
    'unregister-scheduledtask': { name: 'Unregister-ScheduledTask', async fn(ctx) { requireAdmin('Access is denied.'); for (const n of names(ctx.a.get('taskname') ?? ctx.a.pos[0] ?? ctx.input.map((x) => x.TaskName))) { const t = S.getTask(sys, n); if (!t) throw new PSError(`No MSFT_ScheduledTask objects found with property 'TaskName' equal to '${n}'.`, { target: n }); if (!(await confirm(ctx, 'Delete', `${t.path}${t.name}`))) continue; S.removeTask(sys, n); } } },
    'disable-scheduledtask': { name: 'Disable-ScheduledTask', fn(ctx) { requireAdmin('Access is denied.'); for (const n of names(ctx.a.get('taskname') ?? ctx.a.pos[0] ?? ctx.input.map((x) => x.TaskName))) wrapErr(() => S.setTaskEnabled(sys, n, false), n); } },
    'enable-scheduledtask': { name: 'Enable-ScheduledTask', fn(ctx) { requireAdmin('Access is denied.'); for (const n of names(ctx.a.get('taskname') ?? ctx.a.pos[0] ?? ctx.input.map((x) => x.TaskName))) wrapErr(() => S.setTaskEnabled(sys, n, true), n); } },

    // ------------------------------------------------ files and registry provider
    'get-childitem': { name: 'Get-ChildItem', sw: ['recurse', 'force', 'file', 'directory', 'name', 'hidden'], fn(ctx) {
      const p0 = ctx.a.get('path', 'literalpath') ?? ctx.a.pos[0] ?? '.';
      const rk = regPathOf(p0);
      if (rk) { if (!S.regFind(sys, rk)) throw new PSError(`Cannot find path '${p0}' because it does not exist.`, { id: 'PathNotFound,Microsoft.PowerShell.Commands.GetChildItemCommand', target: p0 }); return S.regSubkeys(sys, rk).map((k) => { const n = S.regFind(sys, `${rk}\\${k}`); return obj('RegKey', { Name: `${S.HIVE_LONG[rk.slice(0, 4)] || rk.slice(0, 4)}${rk.slice(4)}\\${k}`, Property: Object.keys(n.values).map((v) => `${v} : ${n.values[v].data}`).join('\n') }); }); }
      const p = vp(p0);
      if (!sys.vfs.exists(p)) throw new PSError(`Cannot find path '${S.toWin(p)}' because it does not exist.`, { id: 'PathNotFound,Microsoft.PowerShell.Commands.GetChildItemCommand', target: S.toWin(p) });
      let res = itemsAt(p, { recurse: !!ctx.a.get('recurse'), filter: ctx.a.get('filter') ?? ctx.a.pos[1], force: !!ctx.a.get('force') || !!ctx.a.get('hidden'), include: ctx.a.get('include'), fileOnly: !!ctx.a.get('file'), dirOnly: !!ctx.a.get('directory'), depth: ctx.a.get('depth') ?? 99 });
      if (ctx.a.get('hidden')) res = res.filter((f) => f.Mode.includes('h'));
      return ctx.a.get('name') ? res.map((f) => f.Name) : res;
    } },
    'get-item': { name: 'Get-Item', sw: ['force'], fn(ctx) { const p0 = pathArg(ctx); const rk = regPathOf(p0); if (rk) { if (!S.regFind(sys, rk)) throw new PSError(`Cannot find path '${p0}' because it does not exist.`, { id: 'PathNotFound', target: p0 }); return propObj(S.regFind(sys, rk).path); } const p = vp(p0); if (!sys.vfs.exists(p)) throw new PSError(`Cannot find path '${S.toWin(p)}' because it does not exist.`, { id: 'PathNotFound,Microsoft.PowerShell.Commands.GetItemCommand', target: S.toWin(p) }); return fileObj(p); } },
    'set-location': { name: 'Set-Location', fn(ctx) { const p0 = String(ctx.a.get('path') ?? ctx.a.pos[0] ?? '~'); const rk = regPathOf(p0); if (rk) { if (!S.regFind(sys, rk)) throw new PSError(`Cannot find path '${p0}' because it does not exist.`, { id: 'PathNotFound', target: p0 }); sh.regCwd = S.regFind(sys, rk).path.replace(/^(HK\w+)/, '$1:'); return; } if (/^[a-z]:\\?$/i.test(p0) || !sh.regCwd || /^[a-z]:/i.test(p0)) sh.regCwd = null; const p = vp(p0); if (!sys.vfs.isDir(p)) throw new PSError(`Cannot find path '${S.toWin(p)}' because it does not exist.`, { id: 'PathNotFound,Microsoft.PowerShell.Commands.SetLocationCommand', target: S.toWin(p) }); sh.cwd = p; sh.regCwd = null; } },
    'get-location': { name: 'Get-Location', fn() { return obj('PathInfo', { Path: sh.regCwd || S.toWin(sh.cwd) }); } },
    'get-content': { name: 'Get-Content', sw: ['raw'], fn(ctx) { const p = vp(pathArg(ctx)); if (!sys.vfs.isFile(p)) throw new PSError(`Cannot find path '${S.toWin(p)}' because it does not exist.`, { id: 'PathNotFound,Microsoft.PowerShell.Commands.GetContentCommand', target: S.toWin(p) }); if (/^\/Windows\/System32\/config\//i.test(p)) throw new PSError(`The process cannot access the file '${S.toWin(p)}' because it is being used by another process.`, { id: 'GetContentReaderIOError', cat: 'ReadError' }); const t = sys.vfs.readFile(p); if (ctx.a.get('raw')) return t; const ls = t.replace(/\n$/, '').split('\n'); const first = ctx.a.get('totalcount', 'first', 'head'); const tail = ctx.a.get('tail', 'last'); return first != null ? ls.slice(0, Number(first)) : tail != null ? ls.slice(-Number(tail)) : ls; } },
    'set-content': { name: 'Set-Content', fn(ctx) { const p0 = pathArg(ctx); const p = vp(p0); if (needAdminPath(p)) throw new PSError(`Access to the path '${S.toWin(p)}' is denied.`, { id: 'System.UnauthorizedAccessException,Microsoft.PowerShell.Commands.SetContentCommand', cat: 'PermissionDenied' }); const v = ctx.a.get('value') ?? (ctx.a.pos.length > 1 ? ctx.a.pos[1] : ctx.input); fileCtx.writeFile(p0, [].concat(v).map(fmtVal).join('\n') + '\n'); } },
    'add-content': { name: 'Add-Content', fn(ctx) { const p0 = pathArg(ctx); const p = vp(p0); if (needAdminPath(p)) throw new PSError(`Access to the path '${S.toWin(p)}' is denied.`, { cat: 'PermissionDenied' }); const v = ctx.a.get('value') ?? (ctx.a.pos.length > 1 ? ctx.a.pos[1] : ctx.input); const prev = sys.vfs.isFile(p) ? sys.vfs.readFile(p) : ''; fileCtx.writeFile(p0, prev + (prev && !prev.endsWith('\n') ? '\n' : '') + [].concat(v).map(fmtVal).join('\n') + '\n'); } },
    'out-file': { name: 'Out-File', sw: ['append', 'force'], fn(ctx) { const p0 = ctx.a.get('filepath', 'path') ?? ctx.a.pos[0]; const txt = formatOutput(ctx.input).replace(/^\n+/, ''); const prev = ctx.a.get('append') ? fileCtx.readFile(p0) || '' : ''; fileCtx.writeFile(p0, prev + txt); } },
    'remove-item': { name: 'Remove-Item', sw: ['recurse', 'force'], async fn(ctx) {
      const targets = ctx.a.get('path', 'literalpath') ?? ctx.a.pos[0] ?? ctx.input.map((x) => x?.FullName ?? x);
      for (const p0 of [].concat(targets)) {
        const rk = regPathOf(p0);
        if (rk) { requireAdmin(`Requested registry access is not allowed.`); wrapErr(() => S.regDeleteKey(sys, rk), p0); continue; }
        const p = vp(p0);
        if (!sys.vfs.exists(p)) throw new PSError(`Cannot find path '${S.toWin(p)}' because it does not exist.`, { id: 'PathNotFound,Microsoft.PowerShell.Commands.RemoveItemCommand', target: S.toWin(p) });
        if (needAdminPath(p)) throw new PSError(`Cannot remove item ${S.toWin(p)}: Access to the path '${S.toWin(p)}' is denied.`, { id: 'RemoveFileSystemItemUnAuthorizedAccess,Microsoft.PowerShell.Commands.RemoveItemCommand', cat: 'PermissionDenied' });
        if (sys.vfs.isDir(p)) {
          if (sys.vfs.readdir(p).length && !ctx.a.get('recurse')) { const a = await io.readLine(`\nConfirm\nThe item at ${S.toWin(p)} has children and the Recurse parameter was not specified. If you continue, all children will be removed with the item. Are you sure you want to continue?\n[Y] Yes  [A] Yes to All  [N] No  [L] No to All  [S] Suspend  [?] Help (default is "Y"): `); if (a == null || /^n|^l/i.test(a.trim())) continue; }
          sys.vfs.rmrf(p);
        } else sys.vfs.unlink(p);
        if (sys.win.hidden) sys.win.hidden = sys.win.hidden.filter((h) => !h.startsWith(lc(p)));
      }
    } },
    'new-item': { name: 'New-Item', sw: ['force'], fn(ctx) {
      const p0 = ctx.a.get('path') ?? ctx.a.pos[0]; const nm = ctx.a.get('name'); const full = nm ? `${p0}\\${nm}` : p0;
      const rk = regPathOf(full); if (rk) { if (/^HKLM/.test(rk)) requireAdmin('Requested registry access is not allowed.'); S.regEnsure(sys, rk); sys.touch('win'); return propObj(rk); }
      const p = vp(full); if (needAdminPath(p)) throw new PSError(`Access to the path '${S.toWin(p)}' is denied.`, { cat: 'PermissionDenied' });
      if (sys.vfs.exists(p) && !ctx.a.get('force')) throw new PSError(`The file '${S.toWin(p)}' already exists.`, { id: 'NewItemIOError,Microsoft.PowerShell.Commands.NewItemCommand', cat: 'WriteError' });
      const t = lc(ctx.a.get('itemtype') ?? 'file');
      if (t === 'directory' || t === 'folder') sys.vfs.mkdir(p, { parents: true, mode: 0o777 }); else fileCtx.writeFile(full, ctx.a.get('value') != null ? String(ctx.a.get('value')) : '');
      return fileObj(p);
    } },
    'copy-item': { name: 'Copy-Item', sw: ['recurse', 'force'], fn(ctx) { const s1 = vp(ctx.a.get('path') ?? ctx.a.pos[0]); let d1 = vp(ctx.a.get('destination') ?? ctx.a.pos[1]); if (sys.vfs.isDir(d1)) d1 = `${d1}/${s1.split('/').pop()}`; sys.vfs.copy(s1, d1, { recursive: true }); } },
    'move-item': { name: 'Move-Item', sw: ['force'], fn(ctx) { const s1 = vp(ctx.a.get('path') ?? ctx.a.pos[0]); let d1 = vp(ctx.a.get('destination') ?? ctx.a.pos[1]); if (sys.vfs.isDir(d1)) d1 = `${d1}/${s1.split('/').pop()}`; sys.vfs.rename(s1, d1); } },
    'rename-item': { name: 'Rename-Item', fn(ctx) { const s1 = vp(ctx.a.get('path') ?? ctx.a.pos[0]); const nn = ctx.a.get('newname') ?? ctx.a.pos[1]; sys.vfs.rename(s1, `${s1.slice(0, s1.lastIndexOf('/'))}/${nn}`); } },
    'test-path': { name: 'Test-Path', fn(ctx) { const p0 = pathArg(ctx); const rk = regPathOf(p0); if (rk) return !!S.regFind(sys, rk); return sys.vfs.exists(vp(p0)); } },
    'get-filehash': { name: 'Get-FileHash', fn(ctx) { const p0 = pathArg(ctx); const p = vp(p0); if (!sys.vfs.isFile(p)) throw new PSError(`Cannot find path '${S.toWin(p)}' because it does not exist.`, { id: 'FileNotFound,Microsoft.PowerShell.Commands.GetFileHashCommand', target: S.toWin(p) }); const alg = String(ctx.a.get('algorithm') ?? 'SHA256').toUpperCase(); const t = sys.vfs.readFile(p); const hash = (alg === 'MD5' ? md5ish(t) : alg === 'SHA1' ? sha256hex('sha1:' + t).slice(0, 40) : sha256hex(t)).toUpperCase(); return obj('FileHash', { Algorithm: alg, Hash: hash, Path: S.toWin(p) }); } },
    'select-string': { name: 'Select-String', sw: ['simplematch', 'casesensitive'], fn(ctx) { const pat = String(ctx.a.get('pattern') ?? ctx.a.pos[0]); const re = ctx.a.get('simplematch') ? new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : new RegExp(pat, ctx.a.get('casesensitive') ? '' : 'i'); const path = ctx.a.get('path') ?? ctx.a.pos[1]; const res = []; if (path != null) { for (const p0 of [].concat(path)) { const files = /[*?]/.test(p0) ? itemsAt(vp(p0.replace(/[\\/][^\\/]*$/, '') || '.'), { filter: p0.split(/[\\/]/).pop(), fileOnly: true }).map((f) => f.__path) : [vp(p0)]; for (const f of files) { if (!sys.vfs.isFile(f)) continue; sys.vfs.readFile(f).split('\n').forEach((l, i) => { if (re.test(l)) res.push(obj('MatchInfo', { Path: S.toWin(f), Filename: f.split('/').pop(), LineNumber: i + 1, Line: l })); }); } } } else for (const x of ctx.input) { const l = typeof x === 'object' && x ? formatOutput([x]).trim() : fmtVal(x); for (const ll of l.split('\n')) if (re.test(ll)) res.push(obj('MatchInfo', { Line: ll })); } return res; } },
    'get-itemproperty': { name: 'Get-ItemProperty', fn(ctx) { const p0 = pathArg(ctx); const rk = regPathOf(p0); if (!rk) { const p = vp(p0); if (!sys.vfs.exists(p)) throw new PSError(`Cannot find path '${S.toWin(p)}' because it does not exist.`, { id: 'PathNotFound', target: S.toWin(p) }); return fileObj(p); } const n = S.regFind(sys, rk); if (!n) throw new PSError(`Cannot find path '${p0}' because it does not exist.`, { id: 'PathNotFound,Microsoft.PowerShell.Commands.GetItemPropertyCommand', target: p0 }); const name = ctx.a.get('name') ?? ctx.a.pos[1]; const o = propObj(n.path); if (name != null) { const vn = Object.keys(n.values).find((v) => lc(v) === lc(name)); if (!vn) throw new PSError(`Property ${name} does not exist at path ${p0}.`, { id: 'System.Management.Automation.PSArgumentException,Microsoft.PowerShell.Commands.GetItemPropertyCommand', cat: 'InvalidArgument', target: p0 }); const r = obj('ItemProperty', { [vn]: n.values[vn].data }); for (const k of ['PSPath', 'PSParentPath', 'PSChildName', 'PSDrive', 'PSProvider']) r[k] = o[k]; return r; } return o; } },
    'get-itempropertyvalue': { name: 'Get-ItemPropertyValue', fn(ctx) { const rk = regPathOf(pathArg(ctx)); const name = ctx.a.get('name') ?? ctx.a.pos[1]; const v = S.regGet(sys, rk, name); if (v === undefined) throw new PSError(`Property ${name} does not exist at path ${pathArg(ctx)}.`, { cat: 'InvalidArgument' }); return v; } },
    'set-itemproperty': { name: 'Set-ItemProperty', sw: ['force'], fn(ctx) { const p0 = pathArg(ctx); const rk = regPathOf(p0); if (!rk) throw new PSError('Cannot use interface. The IPropertyCmdletProvider interface is not supported by this provider.', { cat: 'NotImplemented' }); if (/^HKLM/.test(rk)) requireAdmin(`Requested registry access is not allowed.`); if (!S.regFind(sys, rk)) throw new PSError(`Cannot find path '${p0}' because it does not exist.`, { id: 'PathNotFound,Microsoft.PowerShell.Commands.SetItemPropertyCommand', target: p0 }); const name = ctx.a.get('name') ?? ctx.a.pos[1]; const val = ctx.a.get('value') ?? ctx.a.pos[2]; const t = ctx.a.get('type', 'propertytype'); const existing = S.regFind(sys, rk).values[Object.keys(S.regFind(sys, rk).values).find((v) => lc(v) === lc(name))]; const type = t ? ({ dword: 'REG_DWORD', string: 'REG_SZ', expandstring: 'REG_EXPAND_SZ', qword: 'REG_QWORD', multistring: 'REG_MULTI_SZ', binary: 'REG_BINARY' }[lc(t)] || 'REG_SZ') : existing?.type || (typeof val === 'number' ? 'REG_DWORD' : 'REG_SZ'); S.regSet(sys, rk, name, type === 'REG_DWORD' ? Number(val) : val, type); } },
    'remove-itemproperty': { name: 'Remove-ItemProperty', sw: ['force'], fn(ctx) { const p0 = pathArg(ctx); const rk = regPathOf(p0); if (/^HKLM/.test(rk || '')) requireAdmin('Requested registry access is not allowed.'); for (const n of names(ctx.a.get('name') ?? ctx.a.pos[1])) { try { S.regDeleteValue(sys, rk, n); } catch { throw new PSError(`Property ${n} does not exist at path ${p0}.`, { cat: 'InvalidArgument', target: n }); } } } },

    // ------------------------------------------------ pipeline utilities
    'where-object': { name: 'Where-Object', async fn(ctx) {
      const blk = ctx.a.pos.find((x) => x && x.__block);
      if (blk) { const toks = tokenize(blk.__block); const res = []; for (const it of ctx.input) if (truthy(await evalExpr(toks, { _: it }))) res.push(it); return res; }
      const prop = ctx.a.get('property') ?? ctx.a.pos[0];
      const opKey = Object.keys(ctx.a.named).find((k) => CMP.includes('-' + k));
      const val = ctx.a.get('value') ?? (opKey ? ctx.a.named[opKey] : ctx.a.pos[1]);
      return ctx.input.filter((it) => { const v = member(it, '.' + prop); return opKey ? truthy(binop('-' + opKey, v, val === true ? (ctx.a.pos[1] ?? true) : val)) : truthy(v); });
    } },
    'foreach-object': { name: 'ForEach-Object', async fn(ctx) {
      const blk = ctx.a.pos.find((x) => x && x.__block); const mem = ctx.a.get('membername') ?? (typeof ctx.a.pos[0] === 'string' ? ctx.a.pos[0] : null);
      const res = [];
      for (const it of ctx.input) { if (blk) res.push(...await runStatements(blk.__block, { _: it }, true)); else if (mem) res.push(member(it, '.' + mem)); }
      return res;
    } },
    'select-object': { name: 'Select-Object', sw: ['unique'], fn(ctx) {
      let items = ctx.input;
      const first = ctx.a.get('first'); const last = ctx.a.get('last'); const skip = ctx.a.get('skip'); const exp = ctx.a.get('expandproperty');
      if (skip != null) items = items.slice(Number(skip));
      if (first != null) items = items.slice(0, Number(first)); if (last != null) items = items.slice(-Number(last));
      if (exp != null) return items.flatMap((it) => { const v = member(it, '.' + exp); return Array.isArray(v) ? v : [v]; });
      let props = ctx.a.get('property') ?? ctx.a.pos[0];
      if (props == null) return items;
      props = [].concat(props).map(String);
      if (props.length === 1 && props[0] === '*') return items.map((it) => Object.assign(obj('Selected', {}), Object.fromEntries(visibleKeys(it).map((k) => [k, it[k]])), { __list: true }));
      const res = items.map((it) => { const o = obj('Selected', {}); for (const p of props) { const k = typeof it === 'object' && it ? visibleKeys(it).find((x) => lc(x) === lc(p)) || p : p; o[k] = typeof it === 'object' && it ? it[k] : undefined; } o.__cols = Object.keys(o).filter((k) => !k.startsWith('__')); return o; });
      return ctx.a.get('unique') ? res.filter((o, i) => res.findIndex((x) => JSON.stringify(x) === JSON.stringify(o)) === i) : res;
    } },
    'sort-object': { name: 'Sort-Object', sw: ['descending', 'unique'], fn(ctx) { const p = ctx.a.get('property') ?? ctx.a.pos[0]; const r = ctx.input.slice().sort((a, b) => { const x = p ? member(a, '.' + p) : a; const y = p ? member(b, '.' + p) : b; return x > y ? 1 : x < y ? -1 : 0; }); return ctx.a.get('descending') ? r.reverse() : r; } },
    'measure-object': { name: 'Measure-Object', sw: ['sum', 'line', 'word', 'character'], fn(ctx) { return obj('GenericMeasureInfo', { Count: ctx.input.length, Average: '', Sum: '', Maximum: '', Minimum: '', Property: '', __list: true }); } },
    'format-table': { name: 'Format-Table', sw: ['autosize', 'wrap'], fn(ctx) { const props = ctx.a.get('property') ?? ctx.a.pos[0]; if (!ctx.input.length) return []; const cols = props ? [].concat(props).map(String) : (VIEWS[ctx.input[0].__t] || ctx.input[0].__cols || visibleKeys(ctx.input[0])); return [table(ctx.input.map((x) => (typeof x === 'object' ? x : { Value: x })), cols).replace(/^\n/, '').replace(/\n$/, '')]; } },
    'format-list': { name: 'Format-List', fn(ctx) { const props = ctx.a.get('property') ?? ctx.a.pos[0]; const keys = props && String(props) !== '*' ? [].concat(props).map(String) : null; return [list(ctx.input.filter((x) => typeof x === 'object'), keys ? null : undefined).replace(/^\n/, '').replace(/\n$/, '')].map((t) => (keys ? list(ctx.input.map((it) => Object.fromEntries(keys.map((k) => [visibleKeys(it).find((x) => lc(x) === lc(k)) || k, it[visibleKeys(it).find((x) => lc(x) === lc(k))]]))), null).replace(/^\n/, '').replace(/\n$/, '') : t)); } },
    'out-string': { name: 'Out-String', fn(ctx) { return formatOutput(ctx.input); } },
    'out-host': { name: 'Out-Host', fn(ctx) { return ctx.input; } },
    'out-null': { name: 'Out-Null', fn() { return []; } },
    'write-output': { name: 'Write-Output', fn(ctx) { return ctx.a.pos.flat(); } },
    'write-host': { name: 'Write-Host', sw: ['nonewline'], fn(ctx) { write(ctx.a.pos.map(fmtVal).join(' ') + (ctx.a.get('nonewline') ? '' : '\n')); } },
    'clear-host': { name: 'Clear-Host', fn() { io.clear(); } },
    'get-history': { name: 'Get-History', fn() { return sh.history.map((c, i) => obj('HistoryInfo', { Id: i + 1, CommandLine: c })); } },
    'get-command': { name: 'Get-Command', fn(ctx) { const n = ctx.a.get('name') ?? ctx.a.pos[0]; const all = Object.values(CMDLETS).map((c) => c.name); return all.filter((c) => !n || wild(n).test(c)).sort().map((c) => obj('CommandInfo', { CommandType: 'Cmdlet', Name: c, Version: '1.0.0.0', Source: /LocalUser|LocalGroup/.test(c) ? 'Microsoft.PowerShell.LocalAccounts' : /Smb/.test(c) ? 'SmbShare' : /NetFirewall|NetTCP/.test(c) ? 'NetSecurity' : /ScheduledTask/.test(c) ? 'ScheduledTasks' : /Mp/.test(c) ? 'Defender' : 'Microsoft.PowerShell.Management' })); } },
    'get-help': { name: 'Get-Help', fn(ctx) { const n = ctx.a.pos[0]; const c = n && CMDLETS[ALIASES[lc(n)] || lc(n)]; return c ? `\nNAME\n    ${c.name}\n\nSYNTAX\n    ${c.name} [-Name <string[]>] [<CommonParameters>]\n\nREMARKS\n    Get-Help cannot find the Help files for this cmdlet on this computer. It is displaying only partial help.\n` : 'Get-Help: use Get-Command to list the commands this simulator supports.'; } },
    'get-computerinfo': { name: 'Get-ComputerInfo', fn() { return obj('ComputerInfo', { WindowsBuildLabEx: `${WIN_VERSION.build}.1.amd64fre.ni_release.220506-1250`, WindowsCurrentVersion: '6.3', WindowsEditionId: WIN_VERSION.edition, WindowsProductName: 'Windows 10 Pro', WindowsVersion: '2009', OsName: `Microsoft ${WIN_VERSION.product}`, OsVersion: `10.0.${WIN_VERSION.build}`, OsBuildNumber: WIN_VERSION.build, CsName: sys.hostname, CsDomain: 'WORKGROUP', CsPartOfDomain: false, OsArchitecture: '64-bit' }); } },
    'start-process': { name: 'Start-Process', sw: ['wait', 'nonewwindow'], async fn(ctx) { const fp = String(ctx.a.get('filepath') ?? ctx.a.pos[0]); const verb = ctx.a.get('verb'); const args = [].concat(ctx.a.get('argumentlist') ?? []).map(String); if (lc(verb) === 'runas') { io.launch('elevate', { target: fp, args }); return; } if (!(await launchApp(lc(fp).replace(/\.exe$/, ''), args))) { if (/^(powershell|cmd)$/i.test(lc(fp).replace(/\.exe$/, ''))) io.launch('terminal', { mode: lc(fp).startsWith('cmd') ? 'cmd' : 'ps', elevated: sh.elevated }); else throw new PSError(`This command cannot be run due to the error: The system cannot find the file specified.`, { id: 'InvalidOperationException,Microsoft.PowerShell.Commands.StartProcessCommand', cat: 'InvalidOperation' }); } } },
    'restart-computer': { name: 'Restart-Computer', sw: ['force'], fn() { requireAdmin('Failed to restart the computer with the following error message: Access is denied.'); io.power?.('reboot'); } },
    'stop-computer': { name: 'Stop-Computer', sw: ['force'], fn() { io.power?.('poweroff'); } },
    'exit': { name: 'exit', fn() { if (sh.nested === 'cmd') { sh.mode = 'cmd'; sh.nested = null; return; } io.exit(); throw Object.assign(new Error('exit'), { shellExit: 0 }); } },
    'get-acl': { name: 'Get-Acl', fn(ctx) { const p = vp(pathArg(ctx)); if (!sys.vfs.exists(p)) throw new PSError(`Cannot find path '${S.toWin(p)}' because it does not exist.`, { id: 'PathNotFound', target: S.toWin(p) }); const own = (sys.win.owners || {})[lc(p)] || (/^\/Users\/([^/]+)/.exec(p)?.[1] ? `${sys.hostname}\\${/^\/Users\/([^/]+)/.exec(p)[1]}` : 'NT SERVICE\\TrustedInstaller'); return obj('Acl', { Path: `Microsoft.PowerShell.Core\\FileSystem::${S.toWin(p)}`, Owner: own, Group: own, Access: 'NT AUTHORITY\\SYSTEM Allow  FullControl\n         BUILTIN\\Administrators Allow  FullControl' }); } },
  };
  // Windows Server only: roles and features (Get-/Install-/Uninstall-WindowsFeature), mapped onto the optional-feature model
  if (WIN_VERSION.server) {
    const SF = [['File and Storage Services', 'FileAndStorage-Services', null], ['    File Server', 'FS-FileServer', null], ['    SMB 1.0/CIFS File Sharing Support', 'FS-SMB1', 'SMB1Protocol'], ['Web Server (IIS)', 'Web-Server', 'IIS-WebServerRole'], ['    FTP Server', 'Web-Ftp-Server', 'IIS-FTPServer'],
      ['Telnet Client', 'Telnet-Client', 'TelnetClient'], ['TFTP Client', 'TFTP-Client', 'TFTP'], ['Windows PowerShell 2.0 Engine', 'PowerShell-V2', 'MicrosoftWindowsPowerShellV2Root'], ['Microsoft Defender Antivirus', 'Windows-Defender', null], ['Hyper-V', 'Hyper-V', 'Microsoft-Hyper-V-All']];
    const stOf = (f) => (f[2] == null ? true : S.featureState(sys, f[2])?.state === 'Enabled');
    const find = (ctx) => { const n = ctx.a.get('name') ?? ctx.a.pos[0]; const hit = names(n).map((x) => SF.filter((f) => wild(x).test(f[1]))).flat(); if (n != null && !hit.length) throw new PSError(`ArgumentNotValid: The role, role service, or feature name is not valid: '${n}'. The name was not found.`, { id: 'NameDoesNotExist', cat: 'InvalidArgument', target: n }); return n == null ? SF : hit; };
    const change = (ctx, on) => { requireAdmin(); const fs = find(ctx); const done = []; for (const f of fs) { if (f[2] && stOf(f) !== on) { wrapErr(() => S.setFeature(sys, f[2], on), f[1]); done.push(f[0].trim()); } } return obj('FeatureOperationResult', { Success: true, 'Restart Needed': done.length ? 'Maybe' : 'No', 'Exit Code': done.length ? 'Success' : 'NoChangeNeeded', 'Feature Result': `{${done.join(', ')}}` }); };
    Object.assign(CMDLETS, {
      'get-windowsfeature': { name: 'Get-WindowsFeature', fn(ctx) { return find(ctx).map((f) => obj('WindowsFeature', { 'Display Name': `[${stOf(f) ? 'X' : ' '}] ${f[0]}`, Name: f[1], 'Install State': stOf(f) ? 'Installed' : 'Available' })); } },
      'install-windowsfeature': { name: 'Install-WindowsFeature', sw: ['includemanagementtools', 'restart', 'includeallsubfeature'], fn(ctx) { return change(ctx, true); } },
      'uninstall-windowsfeature': { name: 'Uninstall-WindowsFeature', sw: ['remove', 'restart', 'includemanagementtools'], fn(ctx) { return change(ctx, false); } },
    });
    CMDLETS['add-windowsfeature'] = CMDLETS['install-windowsfeature']; CMDLETS['remove-windowsfeature'] = CMDLETS['uninstall-windowsfeature'];
  }
  const ALIASES = {
    ls: 'get-childitem', dir: 'get-childitem', gci: 'get-childitem', cd: 'set-location', chdir: 'set-location', sl: 'set-location', pwd: 'get-location', gl: 'get-location',
    cat: 'get-content', type: 'get-content', gc: 'get-content', rm: 'remove-item', del: 'remove-item', erase: 'remove-item', rd: 'remove-item', rmdir: 'remove-item', ri: 'remove-item',
    mkdir: 'new-item', md: 'new-item', ni: 'new-item', cp: 'copy-item', copy: 'copy-item', cpi: 'copy-item', mv: 'move-item', move: 'move-item', mi: 'move-item', ren: 'rename-item', rni: 'rename-item',
    echo: 'write-output', write: 'write-output', cls: 'clear-host', clear: 'clear-host', h: 'get-history', history: 'get-history', gsv: 'get-service', ps: 'get-process', gps: 'get-process', kill: 'stop-process', spps: 'stop-process',
    where: 'where-object', '?': 'where-object', foreach: 'foreach-object', '%': 'foreach-object', select: 'select-object', sort: 'sort-object', measure: 'measure-object', ft: 'format-table', fl: 'format-list',
    gp: 'get-itemproperty', sp: 'set-itemproperty', gi: 'get-item', sc: 'set-content', ac: 'add-content', sls: 'select-string', start: 'start-process', saps: 'start-process', gcm: 'get-command', help: 'get-help', man: 'get-help', sasv: 'start-service', spsv: 'stop-service',
  };
  // mkdir/md alias defaults to a directory
  const _ni = CMDLETS['new-item'].fn;
  CMDLETS.mkdir = { name: 'mkdir', fn(ctx) { ctx.a.named.itemtype = 'Directory'; return _ni(ctx); } };
  ALIASES.mkdir = 'mkdir'; ALIASES.md = 'mkdir';

  function complete(buf, pos) {
    const before = buf.slice(0, pos);
    const m = /(\S*)$/.exec(before); const word = m[1]; const start = pos - word.length;
    const isFirst = !/\S\s/.test(before.slice(0, start).replace(/[|;]\s*$/, '')) || /[|;]\s*$/.test(before.slice(0, start));
    let cands = [];
    if (isFirst && sh.mode === 'ps' && !/[\\/:.]/.test(word)) cands = [...Object.values(CMDLETS).map((c) => c.name), ...Object.keys(NATIVE).map((n) => n + '.exe')].filter((c) => lc(c).startsWith(lc(word)));
    else if (word.startsWith('-')) cands = [];
    else {
      const dirPart = word.includes('\\') ? word.slice(0, word.lastIndexOf('\\') + 1) : '';
      const base = word.slice(dirPart.length).replace(/^["']/, '');
      const dir = vp(dirPart || '.');
      try { cands = sys.vfs.readdir(dir).filter((n) => lc(n).startsWith(lc(base))).sort().map((n) => { const full = dirPart + n + (sys.vfs.isDir(dir === '/' ? `/${n}` : `${dir}/${n}`) ? '\\' : ''); return /\s/.test(full) ? `'${full.replace(/\\$/, '')}'` : (sh.mode === 'ps' && !dirPart ? '.\\' : '') + full; }); } catch { cands = []; }
    }
    return { start, candidates: cands, escaped: cands, single: cands.length === 1 && !cands[0].endsWith('\\') };
  }

  return sh;
}
