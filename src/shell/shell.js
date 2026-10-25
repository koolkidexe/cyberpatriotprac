// The simulated bash. One Shell per terminal window. A "frame" is a login/su/sudo -i level
// (user, cwd, environment); `exit` pops a frame and closes the terminal when none are left.
import { posix, globToRegex } from '../core/util.js';
import * as users from '../core/users.js';
import * as pk from '../core/packages.js';
import { FsView, FsError } from '../core/vfs.js';
import { CmdError } from '../core/errors.js';
import { PACKAGES } from '../images/catalog.js';
import { parse, ParseError } from './parser.js';
import { commands } from './registry.js';

const PATH_DIRS = ['/usr/local/sbin', '/usr/local/bin', '/usr/sbin', '/usr/bin', '/sbin', '/bin', '/usr/games', '/usr/local/games'];
export const DEFAULT_PATH = PATH_DIRS.join(':');
const ROOT_CRED = { name: 'root', uid: 0, gid: 0, gids: [0] };
const MAGIC = /(?<!\\)[*?[]/;

export function nullIo() {
  return { write() {}, async readLine() { return null; }, async editor() {}, launch() {}, clear() {}, exit() {}, cols: 80, rows: 24 };
}

let binMap = null;
function packageForCommand(name) {
  if (!binMap) {
    binMap = new Map();
    for (const d of Object.values(PACKAGES)) for (const b of d.bins || []) { const n = b.split('/').pop(); if (!binMap.has(n)) binMap.set(n, d.name); }
  }
  return binMap.get(name) || (PACKAGES[name] ? name : null);
}

export class Shell {
  constructor(sys, { user = 'student', io = nullIo(), login = true } = {}) {
    this.sys = sys;
    this.io = io;
    this.history = [];
    this.aliases = new Map();
    this.vars = new Map();
    this.frames = [];
    this.status = 0;
    this.abort = false;
    this.positional = [];
    this.pid = sys.nextPid++;
    this.depth = 0;
    this.pushFrame(user, { login });
    this.loadAliases();
    this.loadHistory();
  }

  // ---------------------------------------------------------------- frames / environment
  get frame() { return this.frames[this.frames.length - 1]; }
  get user() { return this.frame.user; }
  get cwd() { return this.frame.cwd; }
  set cwd(v) { this.frame.cwd = v; }
  get env() { return this.frame.env; }

  credOf(user) { return user === 'root' ? ROOT_CRED : users.credFor(this.sys, user); }

  pushFrame(user, { cwd, login = false, keepEnv = null } = {}) {
    const u = users.getUser(this.sys, user);
    const home = u?.home || '/';
    const env = {
      USER: user, LOGNAME: user, HOME: home, SHELL: u?.shell || '/bin/bash', PATH: DEFAULT_PATH, LANG: 'en_US.UTF-8', TERM: 'xterm-256color',
      DISPLAY: ':0', XDG_SESSION_TYPE: 'x11', DESKTOP_SESSION: 'cinnamon', XDG_CURRENT_DESKTOP: 'X-Cinnamon', HOSTNAME: this.sys.hostname,
      ...(keepEnv || {}),
    };
    if (keepEnv) { env.USER = user; env.LOGNAME = user; env.HOME = home; }
    const fr = { user, cwd: cwd ?? (this.sys.vfs.isDir(home) ? home : '/'), env, login };
    env.PWD = fr.cwd;
    this.frames.push(fr);
    return fr;
  }
  popFrame() { if (this.frames.length > 1) { this.frames.pop(); return true; } return false; }

  fsFor(user) { return new FsView(this.sys.vfs, this.credOf(user)); }
  resolve(p, cwd = this.cwd) { return posix.normalize(p, cwd); }

  setCwd(path) {
    const old = this.cwd;
    this.frame.cwd = path;
    this.env.OLDPWD = old;
    this.env.PWD = path;
  }

  getVar(name) {
    if (this.vars.has(name)) return this.vars.get(name);
    switch (name) {
      case '?': return String(this.status);
      case '$': return String(this.pid);
      case '#': return String(this.positional.length ? this.positional[this.positional.length - 1].args.length : 0);
      case 'UID': case 'EUID': return String(this.credOf(this.user).uid);
      case 'RANDOM': return String(Math.floor(Math.random() * 32768));
      case 'PWD': return this.cwd;
      case '0': return this.positional.length ? this.positional[this.positional.length - 1].name : 'bash';
      case 'HOSTNAME': return this.sys.hostname;
      case '@': case '*': return this.positional.length ? this.positional[this.positional.length - 1].args.join(' ') : '';
      default: break;
    }
    if (/^\d+$/.test(name) && this.positional.length) return this.positional[this.positional.length - 1].args[Number(name) - 1] ?? '';
    return this.env[name] ?? '';
  }

  setVar(name, value, exported = false) {
    if (exported || name in this.env) { this.env[name] = value; this.vars.delete(name); } else this.vars.set(name, value);
  }

  // ---------------------------------------------------------------- startup files
  loadAliases() {
    this.aliases.clear();
    this.aliases.set('ls', 'ls --color=auto'); this.aliases.set('grep', 'grep --color=auto'); this.aliases.set('fgrep', 'fgrep --color=auto'); this.aliases.set('egrep', 'egrep --color=auto');
    const files = ['/etc/bash.bashrc', `${this.frame.env.HOME}/.bashrc`];
    for (const f of files) {
      try {
        for (const l of this.sys.vfs.readFile(f).split('\n')) {
          const m = /^\s*alias\s+([\w.-]+)=(?:'([^']*)'|"([^"]*)"|(\S+))/.exec(l);
          if (m) this.aliases.set(m[1], m[2] ?? m[3] ?? m[4]);
        }
      } catch { /* unreadable rc files are ignored */ }
    }
  }
  loadHistory() {
    try { this.history = this.sys.vfs.readFile(`${this.frame.env.HOME}/.bash_history`).split('\n').filter(Boolean); } catch { this.history = []; }
    this.histStart = this.history.length;
  }
  saveHistory() {
    const u = users.getUser(this.sys, this.frames[0].user);
    if (!u) return;
    try {
      const path = `${u.home}/.bash_history`;
      this.sys.vfs.writeFile(path, this.history.join('\n') + (this.history.length ? '\n' : ''), { uid: u.uid, gid: u.gid, mode: 0o600 });
    } catch { /* ignore */ }
  }

  // ---------------------------------------------------------------- prompt
  prompt() {
    const home = this.env.HOME;
    let p = this.cwd;
    if (home && home !== '/' && (p === home || p.startsWith(home + '/'))) p = '~' + p.slice(home.length);
    const sym = this.credOf(this.user).uid === 0 ? '#' : '$';
    return `\u001b[01;32m${this.user}@${this.sys.hostname}\u001b[00m:\u001b[01;34m${p}\u001b[00m${sym} `;
  }
  promptPlain() { return this.prompt().replace(/\u001b\[[0-9;]*m/g, ''); }

  // ---------------------------------------------------------------- history expansion
  expandHistory(line) {
    if (!line.includes('!')) return line;
    let out = '';
    let changed = false;
    let sq = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === "'") sq = !sq;
      if (c === '!' && !sq && i + 1 < line.length && !/[\s=(]/.test(line[i + 1])) {
        const rest = line.slice(i + 1);
        let m;
        const h = this.history;
        if (rest[0] === '!') { if (!h.length) throw new CmdError('bash: !!: event not found'); out += h[h.length - 1]; i += 1; changed = true; continue; }
        if (rest[0] === '$') { const last = (h[h.length - 1] || '').split(/\s+/).pop(); out += last; i += 1; changed = true; continue; }
        if ((m = /^-(\d+)/.exec(rest))) { const e = h[h.length - Number(m[1])]; if (!e) throw new CmdError(`bash: !-${m[1]}: event not found`); out += e; i += m[0].length; changed = true; continue; }
        if ((m = /^(\d+)/.exec(rest))) { const e = h[Number(m[1]) - 1]; if (!e) throw new CmdError(`bash: !${m[1]}: event not found`); out += e; i += m[0].length; changed = true; continue; }
        if ((m = /^([A-Za-z_./][^\s;|&]*)/.exec(rest))) { const e = [...h].reverse().find((x) => x.startsWith(m[1])); if (!e) throw new CmdError(`bash: !${m[1]}: event not found`); out += e; i += m[0].length; changed = true; continue; }
      }
      out += c;
    }
    if (changed) this.io.write(out + '\n');
    return out;
  }

  // ---------------------------------------------------------------- running
  async run(line) {
    this.abort = false;
    try { line = this.expandHistory(line); } catch (e) { this.io.write(e.message + '\n'); this.status = 1; return 1; }
    if (!line.trim()) return this.status;
    if (!line.startsWith(' ') && this.history[this.history.length - 1] !== line) this.history.push(line);
    return this.runText(line, { out: (s) => this.io.write(s), err: (s) => this.io.write(s), stdin: null, tty: true });
  }

  async runText(text, stdio) {
    let ast;
    try { ast = parse(text); } catch (e) {
      if (e instanceof ParseError) { stdio.err(`bash: ${e.message}\n`); this.status = 2; return 2; }
      throw e;
    }
    try { await this.execNode(ast, stdio); } catch (e) {
      if (e && e.shellExit !== undefined) throw e;
      stdio.err(`bash: internal error: ${e && e.message}\n`);
      console.error(e);
      this.status = 1;
    }
    return this.status;
  }

  /** Run text and capture its stdout (command substitution). */
  async capture(text, stdio) {
    let buf = '';
    const saved = this.status;
    await this.runText(text, { out: (s) => { buf += s; }, err: stdio.err, stdin: stdio.stdin, tty: false });
    this.status = saved === undefined ? this.status : this.status;
    return buf.replace(/\n+$/, '');
  }

  // ---------------------------------------------------------------- AST execution
  async execNode(node, stdio) {
    if (this.abort) return 130;
    switch (node.type) {
      case 'list': {
        let st = this.status;
        for (const it of node.items) { if (this.abort) break; st = await this.execNode(it.node, stdio); }
        return st;
      }
      case 'andor': {
        let st = await this.execNode(node.first, stdio);
        for (const [op, n] of node.rest) {
          if (op === '&&' ? st === 0 : st !== 0) st = await this.execNode(n, stdio);
        }
        return st;
      }
      case 'pipe': return this.execPipe(node, stdio);
      case 'simple': return this.execSimple(node, stdio);
      case 'redir': return this.execRedirected(node, stdio);
      case 'for': return this.execFor(node, stdio);
      case 'while': return this.execWhile(node, stdio);
      case 'if': {
        for (const [cond, body] of node.branches) {
          if ((await this.execNode(cond, stdio)) === 0) return this.execNode(body, stdio);
        }
        if (node.els) return this.execNode(node.els, stdio);
        this.status = 0; return 0;
      }
      case 'subshell': case 'group': return this.execNode(node.body, stdio);
      default: throw new Error('unknown node ' + node.type);
    }
  }

  async execPipe(node, stdio) {
    let input = stdio.stdin;
    let status = 0;
    for (let i = 0; i < node.cmds.length; i++) {
      const last = i === node.cmds.length - 1;
      let buf = '';
      const st = { out: last ? stdio.out : (s) => { buf += s; }, err: stdio.err, stdin: input, tty: last ? stdio.tty : false };
      status = await this.execNode(node.cmds[i], st);
      if (!last) input = { data: buf, pos: 0 };
    }
    if (node.neg) status = status ? 0 : 1;
    this.status = status;
    return status;
  }

  async openRedirs(redirs, stdio) {
    const sinks = { ...stdio };
    const fs = this.fsFor(this.user);
    const sink = async (path, append) => {
      const abs = this.resolve(path);
      try {
        if (!append || !this.sys.vfs.exists(abs)) fs.writeFile(abs, '');
        else if (this.sys.vfs.isDir(abs)) throw new FsError('EISDIR', path);
        else fs.writeFile(abs, '', { append: true });
      } catch (e) {
        if (e instanceof FsError) { stdio.err(`bash: ${path}: ${e.text}\n`); return null; }
        throw e;
      }
      return (s) => { try { fs.writeFile(abs, s, { append: true }); } catch { /* disk write failed */ } };
    };
    for (const r of redirs) {
      if (r.op === '2>&1') { sinks.err = sinks.out; continue; }
      const target = (await this.expandWord(r.target, { glob: false }))[0] ?? '';
      if (r.op === '>&') { if (target === '2') sinks.out = sinks.err; continue; }
      if (r.op === '<') {
        try { sinks.stdin = { data: fs.readFile(this.resolve(target)), pos: 0 }; } catch (e) {
          if (e instanceof FsError) { stdio.err(`bash: ${target}: ${e.text}\n`); return null; }
          throw e;
        }
        continue;
      }
      const append = r.op.endsWith('>>');
      const w = await sink(target, append);
      if (!w) return null;
      if (r.op === '>' || r.op === '>>') { sinks.out = w; sinks.tty = false; }
      else if (r.op === '2>' || r.op === '2>>') sinks.err = w;
      else { sinks.out = w; sinks.err = w; sinks.tty = false; }
    }
    return sinks;
  }

  async execRedirected(node, stdio) {
    const sinks = await this.openRedirs(node.redirs, stdio);
    if (!sinks) { this.status = 1; return 1; }
    return this.execNode(node.node, sinks);
  }

  async execFor(node, stdio) {
    let items;
    if (node.words) { items = []; for (const w of node.words) items.push(...(await this.expandWord(w))); }
    else items = this.positional.length ? this.positional[this.positional.length - 1].args : [];
    let st = 0;
    let guard = 0;
    for (const it of items) {
      if (this.abort || ++guard > 100000) break;
      this.setVar(node.name, it);
      st = await this.execNode(node.body, stdio);
    }
    this.status = st;
    return st;
  }

  async execWhile(node, stdio) {
    let st = 0;
    let guard = 0;
    for (;;) {
      if (this.abort || ++guard > 100000) break;
      const c = await this.execNode(node.cond, stdio);
      if (node.until ? c === 0 : c !== 0) break;
      st = await this.execNode(node.body, stdio);
    }
    this.status = st;
    return st;
  }

  async execSimple(node, stdio) {
    let argv = [];
    for (const w of node.words) argv.push(...(await this.expandWord(w)));
    const assigns = [];
    for (const a of node.assigns) assigns.push([a.name, (await this.expandWord(a.word, { split: false, glob: false })).join(' ')]);
    const sinks = node.redirs.length ? await this.openRedirs(node.redirs, stdio) : stdio;
    if (!sinks) { this.status = 1; return 1; }
    if (!argv.length) { for (const [k, v] of assigns) this.setVar(k, v); this.status = 0; return 0; }
    // aliases (only when the command word was written unquoted)
    const first = node.words[0];
    if (first.segs.length === 1 && first.segs[0].k === 'lit' && this.aliases.has(argv[0]) && !this._aliasing) {
      this._aliasing = true;
      try {
        const val = this.aliases.get(argv[0]);
        const ast = parse(val);
        const w = ast.items[0]?.node;
        if (w && w.type === 'simple') {
          const pre = [];
          for (const t of w.words) pre.push(...(await this.expandWord(t)));
          argv = [...pre, ...argv.slice(1)];
        }
      } catch { /* bad alias text: run the literal command */ } finally { this._aliasing = false; }
    }
    const env = {};
    for (const [k, v] of assigns) env[k] = v;
    const st = await this.execArgv(argv, sinks, { env });
    this.status = st;
    return st;
  }

  // ---------------------------------------------------------------- command dispatch
  resolveCommand(name, user = this.user) {
    if (name.includes('/')) {
      const path = this.resolve(name);
      const fs = this.fsFor(user);
      let node;
      try { node = fs.lookup(path); } catch (e) { if (e instanceof FsError) return { err: `${name}: ${e.text}`, code: 126 }; throw e; }
      if (!node) return { err: `${name}: No such file or directory`, code: 127 };
      if (node.t === 'd') return { err: `${name}: Is a directory`, code: 126 };
      if (!(node.mode & 0o111) || (user !== 'root' && !this.canExec(node, this.credOf(user)))) return { err: `${name}: Permission denied`, code: 126 };
      const text = node.gen ? node.gen() : node.data || '';
      if (text.startsWith('\u007fELF')) {
        const base = posix.basename(path);
        const def = commands.get(base);
        if (def && this.available(def)) return { def };
        return { err: `${name}: cannot execute binary file: Exec format error`, code: 126 };
      }
      return { script: path, text };
    }
    const def = commands.get(name);
    if (def && this.available(def)) return { def };
    for (const d of (this.env.PATH || DEFAULT_PATH).split(':')) {
      const p = `${d}/${name}`;
      try {
        const node = this.sys.vfs.lookup(p);
        if (node && node.t === 'f' && (node.mode & 0o111) && !(node.data || '').startsWith('\u007fELF')) return { script: p, text: node.data || '' };
      } catch { /* keep searching */ }
    }
    return null;
  }
  canExec(node, cred) {
    const shift = node.uid === cred.uid ? 6 : cred.gids.includes(node.gid) ? 3 : 0;
    return ((node.mode >> shift) & 1) !== 0;
  }
  available(def) { return !def.pkg || pk.isInstalled(this.sys, def.pkg); }

  notFound(name) {
    if (!name.includes('/')) {
      const p = packageForCommand(name);
      if (p && !pk.isInstalled(this.sys, p) && PACKAGES[p]) return `Command '${name}' not found, but can be installed with:\n\nsudo apt install ${p}\n`;
      return `${name}: command not found\n`;
    }
    return `bash: ${name}: No such file or directory\n`;
  }

  makeCtx(argv, stdio, { asUser, env } = {}) {
    const user = asUser ?? this.user;
    const cred = this.credOf(user);
    const sh = this;
    const fs = new FsView(this.sys.vfs, cred);
    const ctx = {
      sh, sys: this.sys, name: argv[0], argv, args: argv.slice(1), stdio, stdin: stdio.stdin,
      out: stdio.out, err: stdio.err, tty: !!stdio.tty, user, cred, fs, isRoot: cred.uid === 0,
      env: { ...this.env, ...(asUser && asUser !== this.user ? this.pushedEnv(asUser) : {}), ...(env || {}) },
      cwd: this.cwd, term: this.io, cols: this.io.cols || 80,
      resolve: (p) => posix.normalize(p, this.cwd),
      aborted: () => this.abort,
      sleep: (ms) => new Promise((r) => { const t = setTimeout(r, ms); const iv = setInterval(() => { if (sh.abort) { clearTimeout(t); clearInterval(iv); r(); } }, 60); setTimeout(() => clearInterval(iv), ms + 100); }),
      exec: (a, io = stdio, o = {}) => sh.execArgv(a, io, { asUser: user !== sh.user ? user : undefined, ...o }),
      fail(msg, code = 1) { ctx.err(`${ctx.name}: ${msg}\n`); return code; },
      fsErr(e, shown) { ctx.err(`${ctx.name}: ${shown ?? e.path}: ${e.text}\n`); return 1; },
      readAll() { const s = ctx.stdin; if (!s) return ''; const r = s.data.slice(s.pos); s.pos = s.data.length; return r; },
      readLine() { const s = ctx.stdin; if (!s || s.pos >= s.data.length) return null; const i = s.data.indexOf('\n', s.pos); const line = i < 0 ? s.data.slice(s.pos) : s.data.slice(s.pos, i); s.pos = i < 0 ? s.data.length : i + 1; return line; },
      /** stdin text; when attached to the terminal, read lines until Ctrl+D. */
      async stdinText() {
        if (ctx.stdin) return ctx.readAll();
        let t = '';
        for (;;) { const l = await sh.io.readLine('', { echo: true }); if (l == null) break; t += l + '\n'; }
        return t;
      },
    };
    return ctx;
  }

  pushedEnv(user) {
    const u = users.getUser(this.sys, user);
    return { USER: user, LOGNAME: user, HOME: u?.home || '/', SUDO_USER: this.user };
  }

  async execArgv(argv, stdio, opts = {}) {
    const name = argv[0];
    const r = this.resolveCommand(name, opts.asUser ?? this.user);
    if (!r) { stdio.err(this.notFound(name)); this.status = 127; return 127; }
    if (r.err) { stdio.err(`bash: ${r.err}\n`); this.status = r.code; return r.code; }
    if (r.script) return this.runScript(r.text, argv[0], argv.slice(1), stdio, opts);
    const ctx = this.makeCtx(argv, stdio, opts);
    let st;
    try {
      if (ctx.args.includes('--help') && r.def.usage && !r.def.noHelp) { ctx.out(`Usage: ${r.def.usage}\n`); st = 0; }
      else st = (await r.def.fn(ctx)) ?? 0;
    } catch (e) {
      if (e instanceof FsError) { ctx.err(`${name}: ${e.path}: ${e.text}\n`); st = 1; }
      else if (e instanceof CmdError) { ctx.err(e.message + '\n'); st = e.code; }
      else if (e && e.shellExit !== undefined) throw e;
      else { ctx.err(`${name}: internal error: ${e && e.message}\n`); console.error(e); st = 1; }
    }
    this.status = st;
    return st;
  }

  async runScript(text, name, args, stdio, opts = {}) {
    if (this.depth > 20) { stdio.err('bash: maximum recursion depth exceeded\n'); return 1; }
    let body = text;
    if (body.startsWith('#!')) body = body.slice(body.indexOf('\n') + 1);
    this.positional.push({ name, args });
    this.depth++;
    const pushed = opts.asUser && opts.asUser !== this.user;
    if (pushed) this.pushFrame(opts.asUser, { cwd: this.cwd, keepEnv: null });
    try { await this.runText(body, stdio); } finally { if (pushed) this.popFrame(); this.depth--; this.positional.pop(); }
    return this.status;
  }

  /** Run script text (bash -c) optionally as another user. */
  async runScriptAs(text, stdio, asUser) {
    const pushed = asUser && asUser !== this.user;
    if (pushed) this.pushFrame(asUser, { cwd: this.cwd });
    try { await this.runText(text, stdio); } finally { if (pushed) this.popFrame(); }
    return this.status;
  }

  // ---------------------------------------------------------------- expansion
  async expandWord(tok, { split = true, glob = true } = {}) {
    const fields = [{ s: '', g: '', has: false }];
    const cur = () => fields[fields.length - 1];
    const esc = (t) => t.replace(/[*?[\\]/g, '\\$&');
    const addQuoted = (t) => { const f = cur(); f.s += t; f.g += esc(t); f.has = true; };
    const addLit = (t) => { const f = cur(); f.s += t; f.g += t; };
    const addSplit = (t) => {
      if (!split) { addLit(t); return; }
      const parts = t.split(/[ \t\n]+/);
      parts.forEach((p, i) => {
        if (i > 0) fields.push({ s: '', g: '', has: false });
        if (p) addLit(p);
      });
    };
    for (let si = 0; si < tok.segs.length; si++) {
      const seg = tok.segs[si];
      switch (seg.k) {
        case 'sq': addQuoted(seg.v); break;
        case 'dqmark': cur().has = true; break;
        case 'dq': addQuoted(await this.expandVars(seg.v)); break;
        case 'cmd': {
          const out = await this.capture(seg.v, { err: (s) => this.io.write(s), stdin: null });
          if (seg.quoted) addQuoted(out); else addSplit(out);
          break;
        }
        case 'arith': { const v = String(await this.arith(seg.v)); if (seg.quoted) addQuoted(v); else addSplit(v); break; }
        case 'lit': {
          let t = seg.v;
          if (si === 0 && t[0] === '~') {
            const m = /^~([A-Za-z0-9_-]*)(\/.*)?$/.exec(t);
            if (m && !(tok.segs[1] && tok.segs[1].k !== 'lit' && !m[2] && false)) {
              const home = m[1] ? users.getUser(this.sys, m[1])?.home : this.env.HOME;
              if (home) t = home + (m[2] || '');
            }
          }
          const re = /\$\{([A-Za-z_][A-Za-z0-9_]*|[?$#@*0-9])(?:(:?[-=+?])([^}]*))?\}|\$\{#([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)|\$([?$#@*0-9!])/g;
          let last = 0; let m;
          while ((m = re.exec(t))) {
            if (m.index > last) addLit(t.slice(last, m.index));
            addSplit(this.varValue(m));
            last = m.index + m[0].length;
          }
          if (last < t.length) addLit(t.slice(last));
          break;
        }
        default: break;
      }
    }
    const out = [];
    for (const f of fields) {
      if (!f.has && f.s === '') continue;
      if (glob && MAGIC.test(f.g)) {
        const matches = this.glob(f.g);
        if (matches.length) { out.push(...matches); continue; }
      }
      out.push(f.s);
    }
    return out;
  }

  varValue(m) {
    if (m[4]) return String(this.getVar(m[4]).length);
    const name = m[1] || m[5] || m[6];
    let v = this.getVar(name);
    if (m[2]) {
      const op = m[2]; const arg = m[3] ?? '';
      const unset = v === '';
      if (op === ':-' || op === '-') return unset ? arg : v;
      if (op === ':=' || op === '=') { if (unset) { this.setVar(name, arg); return arg; } return v; }
      if (op === ':+' || op === '+') return unset ? '' : arg;
    }
    return v;
  }

  async expandVars(text) {
    const re = /\$\{([A-Za-z_][A-Za-z0-9_]*|[?$#@*0-9])(?:(:?[-=+?])([^}]*))?\}|\$\{#([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)|\$([?$#@*0-9!])/g;
    return text.replace(re, (...m) => this.varValue(m));
  }

  async arith(expr) {
    const e = (await this.expandVars(expr)).replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, (n) => this.getVar(n) || '0');
    if (!/^[\d\s+\-*/%()<>=!&|^]+$/.test(e)) return 0;
    try { return Math.trunc(Function(`"use strict";return (${e})`)()); } catch { return 0; }
  }

  glob(pattern) {
    const abs = pattern.startsWith('/');
    const parts = pattern.split('/').filter((x, i) => x !== '' || i === 0);
    let bases = [abs ? '/' : ''];
    const vfs = this.sys.vfs;
    const cred = this.credOf(this.user);
    const parts2 = abs ? parts.slice(1) : parts;
    for (let i = 0; i < parts2.length; i++) {
      const part = parts2[i];
      const next = [];
      if (!MAGIC.test(part)) {
        const lit = part.replace(/\\(.)/g, '$1');
        for (const b of bases) { const p = b === '' ? lit : b === '/' ? '/' + lit : `${b}/${lit}`; if (i === parts2.length - 1 ? vfs.exists(this.resolve(p)) : true) next.push(p); }
      } else {
        const re = globToRegex(part);
        for (const b of bases) {
          let names;
          try { names = vfs.readdir(this.resolve(b === '' ? '.' : b), { cred }); } catch { continue; }
          for (const n of names.sort()) {
            if (n.startsWith('.') && !part.startsWith('.')) continue;
            if (!re.test(n)) continue;
            const p = b === '' ? n : b === '/' ? '/' + n : `${b}/${n}`;
            if (i < parts2.length - 1 && !vfs.isDir(this.resolve(p))) continue;
            next.push(p);
          }
        }
      }
      bases = next;
      if (!bases.length) return [];
    }
    return bases;
  }

  // ---------------------------------------------------------------- tab completion
  complete(line, cursor = line.length) {
    const before = line.slice(0, cursor);
    const m = /(?:^|[\s;|&(])((?:[^\s'"\\]|\\.)*)$/.exec(before);
    const word = m ? m[1] : '';
    const start = before.length - word.length;
    const prefixText = before.slice(0, start);
    const atCommand = /(^|[;|&(]\s*|\bsudo\s+(-\S+\s+)*|\bxargs\s+|\bwatch\s+|\btime\s+|\bnohup\s+)$/.test(prefixText) || prefixText.trim() === '';
    const unesc = word.replace(/\\(.)/g, '$1');
    let cands = [];
    if (atCommand && !unesc.includes('/')) {
      const set = new Set();
      for (const [n, d] of commands) if (this.available(d)) set.add(n);
      for (const n of this.aliases.keys()) set.add(n);
      for (const n of ['cd', 'exit', 'export', 'alias', 'unalias', 'history', 'source', 'type', 'read', 'echo', 'pwd', 'logout', 'unset', 'set', 'exec', 'kill', 'test', 'true', 'false']) set.add(n);
      for (const d of (this.env.PATH || '').split(':')) { try { for (const n of this.sys.vfs.readdir(d)) set.add(n); } catch { /* skip */ } }
      cands = [...set].filter((n) => n.startsWith(unesc)).sort();
    } else {
      const slash = unesc.lastIndexOf('/');
      const dirPart = slash >= 0 ? unesc.slice(0, slash + 1) : '';
      const namePart = unesc.slice(slash + 1);
      let dirAbs = this.resolve(dirPart === '' ? '.' : dirPart.startsWith('~') ? (this.env.HOME + dirPart.slice(1)) : dirPart);
      try {
        const names = this.sys.vfs.readdir(dirAbs, { cred: this.credOf(this.user) });
        for (const n of names.sort()) {
          if (!n.startsWith(namePart)) continue;
          if (n.startsWith('.') && !namePart.startsWith('.')) continue;
          const isDir = this.sys.vfs.isDir(posix.join(dirAbs, n));
          cands.push(dirPart + n + (isDir ? '/' : ''));
        }
      } catch { /* unreadable dir */ }
      if (atCommand) cands = cands.filter((c) => c.endsWith('/') || true);
    }
    const escape = (s) => s.replace(/([ '"\\&;|()<>*?[\]$`!#])/g, '\\$1');
    return { start, candidates: cands, escaped: cands.map((c) => (c.endsWith('/') ? escape(c) : escape(c))), single: cands.length === 1 && !cands[0].endsWith('/') };
  }
}
