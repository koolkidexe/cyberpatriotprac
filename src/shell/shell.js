// The shell: expansion, pipelines, redirections, control flow, builtins and command dispatch.
// DOM-free. The UI (or a test) supplies an `io` object: { write, prompt, editor, launch, clear, exit }.
import { parse, ParseError, tokenize } from './parser.js';
import { CmdError } from '../core/errors.js';
import { FsError, FsView } from '../core/vfs.js';
import { globToRegex, posix } from '../core/util.js';
import * as users from '../core/users.js';
import { PACKAGES } from '../images/catalog.js';
import { REGISTRY } from './registry.js';

export class ExitSignal { constructor(code) { this.code = code; } }
class BreakSignal { constructor(n = 1) { this.n = n; } }
class ContinueSignal { constructor(n = 1) { this.n = n; } }

/** Where a command's stdout/stderr goes. */
export class Sink {
  constructor(fn = null) { this.chunks = []; this.fn = fn; }
  write(s) { if (s === '' || s == null) return; if (this.fn) this.fn(String(s)); else this.chunks.push(String(s)); }
  get text() { return this.chunks.join(''); }
}
const NULL_SINK = new Sink(() => {});

const pad = (s, n) => String(s).padEnd(n);
void pad;

export class Shell {
  /**
   * @param sys System
   * @param io {write(text), prompt(text,{silent}), editor(opts), launch(app,args), clear(), exit()}
   */
  constructor(sys, io, { user = 'student', env = {}, cols = 80 } = {}) {
    this.sys = sys;
    this.io = io;
    this.cols = cols;
    this.frames = [];                // su / sudo -s nesting: {user, cwd, vars}
    this.history = [];
    this.aliases = new Map();
    this.vars = new Map();
    this.exported = new Set();
    this.positional = [];
    this.scriptName = 'bash';
    this.lastStatus = 0;
    this.pid = 2231 + Math.floor(Math.random() * 40);
    this.sudoLecture = true;
    this.login(user, { fresh: true, env });
  }

  // ------------------------------------------------------------ identity & environment
  get user() { return this.euser; }
  get cred() {
    const key = `${this.euser}:${this.sys.counters.touches}`;
    if (this._credKey !== key) { this._credKey = key; this._cred = users.credFor(this.sys, this.euser); }
    return this._cred;
  }

  login(name, { fresh = false, env = {}, cwd } = {}) {
    const u = users.getUser(this.sys, name);
    const home = u ? u.home : '/';
    this.euser = name;
    this.vars = new Map();
    this.exported = new Set();
    const base = { USER: name, LOGNAME: name, HOME: home, SHELL: u?.shell || '/bin/bash', PWD: cwd || home, LANG: 'en_US.UTF-8', TERM: 'xterm-256color', PATH: name === 'root' ? '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' : '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games', HOSTNAME: this.sys.hostname, COLUMNS: String(this.cols), LINES: '24', PS1: '', ...env };
    for (const [k, v] of Object.entries(base)) { this.vars.set(k, v); this.exported.add(k); }
    this.cwd = this.sys.vfs.isDir(cwd || home) ? (cwd || home) : '/';
    this.vars.set('PWD', this.cwd);
    this.vars.set('OLDPWD', this.cwd);
    this.loadAliases();
    void fresh;
  }

  loadAliases() {
    this.aliases = new Map();
    const u = users.getUser(this.sys, this.euser);
    const rc = u && this.sys.vfs.isFile(`${u.home}/.bashrc`) ? this.sys.vfs.readFile(`${u.home}/.bashrc`) : '';
    for (const l of rc.split('\n')) {
      const m = /^\s*alias\s+([\w.-]+)=(?:'([^']*)'|"([^"]*)")\s*$/.exec(l);
      if (m) this.aliases.set(m[1], m[2] ?? m[3]);
    }
  }

  /** Push a new login identity (su, sudo -i). */
  pushUser(name, { login = true, keepEnv = false } = {}) {
    this.frames.push({ user: this.euser, cwd: this.cwd, vars: this.vars, exported: this.exported, aliases: this.aliases });
    const u = users.getUser(this.sys, name);
    if (login) this.login(name);
    else { this.euser = name; this.setVar('USER', name, true); if (!keepEnv) this.setVar('HOME', u?.home || '/', true); }
  }
  popUser() {
    const f = this.frames.pop();
    if (!f) return false;
    this.euser = f.user; this.cwd = f.cwd; this.vars = f.vars; this.exported = f.exported; this.aliases = f.aliases;
    return true;
  }

  getVar(name) {
    if (name === '?') return String(this.lastStatus);
    if (name === '$') return String(this.pid);
    if (name === '#') return String(this.positional.length);
    if (name === '0') return this.scriptName;
    if (/^[1-9]$/.test(name)) return this.positional[Number(name) - 1] ?? '';
    if (name === '@' || name === '*') return this.positional.join(' ');
    if (name === 'RANDOM') return String(Math.floor(this.sys.rng() * 32768));
    if (name === 'UID' || name === 'EUID') return String(users.getUser(this.sys, this.euser)?.uid ?? 0);
    return this.vars.get(name) ?? '';
  }
  setVar(name, value, exp = false) { this.vars.set(name, String(value)); if (exp) this.exported.add(name); if (name === 'PWD') this.cwd = value; }
  get env() { const o = {}; for (const k of this.exported) o[k] = this.vars.get(k) ?? ''; return o; }
  home() { return this.vars.get('HOME') || '/'; }

  /** Absolute path for `p` relative to cwd (a leading ~ is expanded here too). */
  abs(p, cwd = this.cwd) {
    if (p === '~' || p.startsWith('~/')) p = this.home() + p.slice(1);
    return posix.normalize(p, cwd);
  }

  prompt() {
    const home = this.home();
    let dir = this.cwd;
    if (dir === home) dir = '~'; else if (home !== '/' && dir.startsWith(home + '/')) dir = '~' + dir.slice(home.length);
    const sym = this.euser === 'root' ? '#' : '$';
    return `\u001b[01;32m${this.euser}@${this.sys.hostname}\u001b[00m:\u001b[01;34m${dir}\u001b[00m${sym} `;
  }

  // ------------------------------------------------------------ public entry points
  /** Run one interactive line. Output goes to io.write. Resolves to the exit status. */
  async execLine(line) {
    let text = line;
    if (/^\s*$/.test(text)) return this.lastStatus;
    // history expansion (minimal)
    if (/(^|\s)!!/.test(text) && !/'[^']*!![^']*'/.test(text)) {
      const prev = this.history[this.history.length - 1];
      if (prev !== undefined) { text = text.replace(/!!/g, prev); this.io.write(text + '\n'); }
    }
    const m = /^\s*!(\d+)\s*$/.exec(text);
    if (m && this.history[Number(m[1]) - 1] !== undefined) { text = this.history[Number(m[1]) - 1]; this.io.write(text + '\n'); }
    if (!/^\s/.test(line) && this.history[this.history.length - 1] !== text) this.history.push(text);
    try {
      const code = await this.runText(text, { term: true });
      this.lastStatus = code;
      return code;
    } catch (e) {
      if (e instanceof ExitSignal) { this.lastStatus = e.code; throw e; }
      throw e;
    }
  }

  /** Is the text a complete command (false = show "> " continuation prompt)? */
  isComplete(text) {
    try { parse(text); return true; } catch (e) { if (e instanceof ParseError && e.incomplete) return false; return true; }
  }

  /** Parse and run text. Returns exit status. */
  async runText(text, { term = false, stdout = null, stderr = null, stdin = '' } = {}) {
    let ast;
    try { ast = parse(text); } catch (e) {
      if (e instanceof ParseError) { (stderr || new Sink((s) => this.io.write(s))).write(`bash: ${e.message}\n`); return 2; }
      throw e;
    }
    const out = stdout || new Sink((s) => this.io.write(s));
    const err = stderr || (term ? new Sink((s) => this.io.write(`\u001b[0m${s}`)) : out);
    const io = { stdin, out, err, tty: term && !stdout };
    return this.runList(ast, io);
  }

  /** Capture the stdout of a script fragment (command substitution). */
  async capture(text, io) {
    const out = new Sink();
    await this.runText(text, { stdout: out, stderr: io.err, stdin: '' });
    return out.text.replace(/\n+$/, '');
  }

  // ------------------------------------------------------------ interpreter
  async runList(list, io) {
    let code = this.lastStatus;
    for (const { node, bg } of list.items) {
      void bg;
      code = await this.runAndOr(node, io);
      this.lastStatus = code;
    }
    return code;
  }

  async runAndOr(node, io) {
    let code = await this.runPipeline(node.first, io);
    this.lastStatus = code;
    for (const { op, pipe } of node.rest) {
      if (op === '&&' && code !== 0) continue;
      if (op === '||' && code === 0) continue;
      code = await this.runPipeline(pipe, io);
      this.lastStatus = code;
    }
    return code;
  }

  async runPipeline(p, io) {
    let code;
    if (p.cmds.length === 1) code = await this.runCommand(p.cmds[0], io);
    else {
      let input = io.stdin;
      for (let i = 0; i < p.cmds.length; i++) {
        const last = i === p.cmds.length - 1;
        const buf = last ? io.out : new Sink();
        code = await this.runCommand(p.cmds[i], { stdin: input, out: buf, err: io.err, tty: last && io.tty });
        if (!last) input = buf.text;
      }
    }
    return p.neg ? (code === 0 ? 1 : 0) : code;
  }

  async runCommand(node, io) {
    // redirections
    let ioc = { ...io };
    const files = [];
    try {
      for (const r of node.redirs || []) {
        if (r.op === '2>&1') { ioc.err = ioc.out; continue; }
        if (r.op === '>&2') { ioc.out = ioc.err; continue; }
        const target = (await this.expandWord(r.target, { split: false }))[0] ?? '';
        if (r.op === '<<<') { ioc.stdin = target + '\n'; continue; }
        if (r.op === '<') {
          const path = this.abs(target);
          try { ioc.stdin = this.fsView().readFile(path); } catch (e) { io.err.write(`bash: ${target}: ${e instanceof FsError ? e.text : e.message}\n`); return 1; }
          continue;
        }
        const append = r.op.endsWith('>>');
        const sink = new Sink();
        if (target === '/dev/null') {
          if (r.op === '2>' || r.op === '2>>') ioc.err = NULL_SINK; else if (r.op === '&>' || r.op === '&>>') { ioc.out = NULL_SINK; ioc.err = NULL_SINK; } else ioc.out = NULL_SINK;
          continue;
        }
        const path = this.abs(target);
        try {
          const fs = this.fsView();
          if (fs.exists(path) && fs.isDir(path)) throw new FsError('EISDIR', path);
          if (!append) fs.writeFile(path, '', { mode: 0o644 });
          else if (!fs.exists(path)) fs.writeFile(path, '', { mode: 0o644 });
          else fs.writeFile(path, '', { append: true });
        } catch (e) { io.err.write(`bash: ${target}: ${e instanceof FsError ? e.text : e.message}\n`); return 1; }
        files.push({ path, sink });
        if (r.op === '2>' || r.op === '2>>') ioc.err = sink; else if (r.op === '&>' || r.op === '&>>') { ioc.out = sink; ioc.err = sink; } else ioc.out = sink;
        ioc.tty = r.op === '2>' || r.op === '2>>' ? ioc.tty : false;
      }
      let code;
      switch (node.type) {
        case 'simple': code = await this.runSimple(node, ioc); break;
        case 'group': code = await this.runList(node.body, ioc); break;
        case 'if': code = await this.runIf(node, ioc); break;
        case 'for': code = await this.runFor(node, ioc); break;
        case 'while': code = await this.runWhile(node, ioc); break;
        default: code = 1;
      }
      return code;
    } finally {
      for (const f of files) {
        try { this.fsView().writeFile(f.path, f.sink.text, { append: true }); } catch { /* disappeared */ }
      }
    }
  }

  async runIf(node, io) {
    for (const c of node.clauses) {
      if ((await this.runList(c.cond, { ...io, tty: false })) === 0) return this.runList(c.body, io);
    }
    return node.else ? this.runList(node.else, io) : 0;
  }

  async runFor(node, io) {
    const items = node.words ? (await Promise.all(node.words.map((w) => this.expandWord(w)))).flat() : [...this.positional];
    let code = 0;
    for (const it of items) {
      this.setVar(node.var, it);
      try { code = await this.runList(node.body, io); } catch (e) {
        if (e instanceof BreakSignal) { if (e.n > 1) throw new BreakSignal(e.n - 1); break; }
        if (e instanceof ContinueSignal) { if (e.n > 1) throw new ContinueSignal(e.n - 1); continue; }
        throw e;
      }
    }
    return code;
  }

  async runWhile(node, io) {
    let code = 0;
    for (let guard = 0; guard < 10000; guard++) {
      const c = await this.runList(node.cond, { ...io, tty: false });
      if ((c === 0) === node.until) break;
      try { code = await this.runList(node.body, io); } catch (e) {
        if (e instanceof BreakSignal) break;
        if (e instanceof ContinueSignal) continue;
        throw e;
      }
    }
    return code;
  }

  fsView() { return new FsView(this.sys.vfs, this.cred); }

  // ------------------------------------------------------------ simple commands
  async runSimple(node, io) {
    const assigns = [];
    for (const a of node.assigns) assigns.push([a.name, (await this.expandWord(a.word, { split: false, glob: false })).join(' ')]);
    let words = [];
    for (const w of node.words) words.push(...(await this.expandWord(w)));
    if (!words.length) { for (const [k, v] of assigns) this.setVar(k, v); return 0; }
    // alias expansion of the first word (once)
    if (this.aliases.has(words[0]) && !node.words[0].hasQuote) {
      try {
        const toks = tokenize(this.aliases.get(words[0])).filter((t) => t.t === 'word');
        const exp = [];
        for (const t of toks) exp.push(...(await this.expandWord(t)));
        words = [...exp, ...words.slice(1)];
      } catch { /* ignore broken alias */ }
    }
    const saved = assigns.map(([k]) => [k, this.vars.get(k), this.exported.has(k)]);
    for (const [k, v] of assigns) this.setVar(k, v, true);
    try {
      return await this.dispatch(words[0], words.slice(1), io);
    } finally {
      for (const [k, v, was] of saved) { if (v === undefined) { this.vars.delete(k); this.exported.delete(k); } else { this.vars.set(k, v); if (!was) this.exported.delete(k); } }
    }
  }

  makeCtx(name, args, io) {
    const cred = this.cred;
    return {
      sys: this.sys, shell: this, name, args, io: this.io,
      stdin: io.stdin, tty: !!io.tty, cols: this.cols,
      out: (s) => io.out.write(s), err: (s) => io.err.write(s),
      user: this.euser, uid: cred.uid, cred, isRoot: cred.uid === 0,
      fs: new FsView(this.sys.vfs, cred),
      env: this.env, cwd: this.cwd,
      abs: (p) => this.abs(p),
      now: () => this.sys.now(),
      run: (text, o = {}) => this.runText(text, { stdout: o.stdout || io.out, stderr: o.stderr || io.err, stdin: o.stdin ?? '' }),
      exec: (argv, o = {}) => this.dispatch(argv[0], argv.slice(1), { stdin: o.stdin ?? '', out: o.out || io.out, err: o.err || io.err, tty: !!o.tty }),
    };
  }

  findInPath(name) {
    if (name.includes('/')) return this.abs(name);
    for (const d of (this.vars.get('PATH') || '').split(':')) {
      const p = `${d}/${name}`;
      if (this.sys.vfs.isFile(p)) return p;
    }
    return null;
  }

  async dispatch(name, args, io) {
    const ctx = this.makeCtx(name, args, io);
    try {
      const b = REGISTRY.builtins[name];
      if (b) return (await b(ctx)) ?? 0;
      if (name.includes('/')) return await this.runPath(name, args, io, ctx);
      const cmd = REGISTRY.commands[name];
      if (cmd) {
        // commands that ship in a package only exist while the package's binary is present
        if (cmd.bin && !this.sys.vfs.exists(cmd.bin)) return this.notFound(name, io);
        return (await cmd.fn(ctx)) ?? 0;
      }
      // an executable script on the PATH
      const p = this.findInPath(name);
      if (p && this.sys.vfs.isFile(p)) return await this.runPath(p, args, io, ctx);
      return this.notFound(name, io);
    } catch (e) {
      if (e instanceof ExitSignal || e instanceof BreakSignal || e instanceof ContinueSignal) throw e;
      if (e instanceof CmdError) { if (e.message) io.err.write(e.message.endsWith('\n') ? e.message : e.message + '\n'); return e.code; }
      if (e instanceof FsError) { io.err.write(`${name}: ${e.path}: ${e.text}\n`); return 1; }
      throw e;
    }
  }

  notFound(name, io) {
    const providers = Object.values(PACKAGES).filter((p) => p.bins.some((b) => b.split('/').pop() === name) || (REGISTRY.commands[name]?.bin && p.bins.includes(REGISTRY.commands[name].bin)));
    if (providers.length) io.err.write(`Command '${name}' not found, but can be installed with:\n\nsudo apt install ${providers[0].name}\n`);
    else io.err.write(`${name}: command not found\n`);
    return 127;
  }

  async runPath(name, args, io, ctx) {
    const path = this.abs(name);
    const fs = this.fsView();
    if (!fs.exists(path)) { io.err.write(`bash: ${name}: No such file or directory\n`); return 127; }
    if (fs.isDir(path)) { io.err.write(`bash: ${name}: Is a directory\n`); return 126; }
    const st = this.sys.vfs.stat(path);
    if ((st.mode & 0o111) === 0 || !this.canExec(st)) { io.err.write(`bash: ${name}: Permission denied\n`); return 126; }
    const text = fs.readFile(path);
    if (text.startsWith('\u007fELF')) return REGISTRY.commands[posix.basename(path)] ? REGISTRY.commands[posix.basename(path)].fn(ctx) : 0;
    return this.runScript(text, [path, ...args], io);
  }
  canExec(st) {
    const c = this.cred;
    if (c.uid === 0) return true;
    const shift = st.uid === c.uid ? 6 : c.gids.includes(st.gid) ? 3 : 0;
    return ((st.mode >> shift) & 1) !== 0;
  }

  async runScript(text, argv, io) {
    const savedPos = this.positional; const savedName = this.scriptName;
    this.positional = argv.slice(1); this.scriptName = argv[0];
    try {
      const body = text.replace(/^#!.*\n/, '');
      return await this.runText(body, { stdout: io.out, stderr: io.err, stdin: io.stdin });
    } catch (e) {
      if (e instanceof ExitSignal) return e.code;
      throw e;
    } finally { this.positional = savedPos; this.scriptName = savedName; }
  }

  // ------------------------------------------------------------ expansion
  async expandWord(word, { split = true, glob = true } = {}) {
    const fields = [[]];             // each field: [{s,q}]
    let quotedEmpty = [false];
    const cur = () => fields[fields.length - 1];
    const add = (s, q) => { if (s !== '' || q) cur().push({ s, q }); if (q) quotedEmpty[fields.length - 1] = true; };
    const addSplit = (s) => {
      if (!split) return add(s, false);
      const pieces = s.split(/[ \t\n]+/);
      pieces.forEach((piece, i) => {
        if (i > 0) { fields.push([]); quotedEmpty.push(false); }
        if (piece !== '') cur().push({ s: piece, q: false });
      });
    };
    for (const part of word.parts) {
      switch (part.k) {
        case 'lit': add(part.v, part.q); break;
        case 'tilde': add(part.v ? (users.getUser(this.sys, part.v)?.home ?? `~${part.v}`) : this.home(), true); break;
        case 'var': {
          if ((part.v === '@' || part.v === '*') && part.q && split) {
            this.positional.forEach((p, i) => { if (i > 0) { fields.push([]); quotedEmpty.push(false); } add(p, true); });
            break;
          }
          const val = await this.expandVar(part.v);
          if (part.q) add(val, true); else addSplit(val);
          break;
        }
        case 'cmd': {
          const val = await this.capture(part.v, { err: new Sink((s) => this.io.write(s)) });
          if (part.q) add(val, true); else addSplit(val);
          break;
        }
        case 'arith': { const val = String(this.arith(part.v)); if (part.q) add(val, true); else addSplit(val); break; }
        default: break;
      }
    }
    const result = [];
    fields.forEach((f, i) => {
      if (!f.length && !quotedEmpty[i]) return;
      const text = f.map((x) => x.s).join('');
      const hasGlob = glob && f.some((x) => !x.q && /[*?[]/.test(x.s));
      if (hasGlob) {
        const pat = f.map((x) => (x.q ? x.s.replace(/[*?[\\]/g, '\\$&') : x.s)).join('');
        const m = this.globExpand(pat);
        if (m.length) { result.push(...m); return; }
      }
      result.push(text);
    });
    return result;
  }

  async expandVar(spec) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*|[0-9]+|[?$#@*!])(.*)$/.exec(spec);
    if (!m) return '';
    const [, name, rest] = m;
    const val = this.getVar(name);
    if (!rest) return val;
    if (spec.startsWith('#') && rest === '' ) return String(val.length);
    let r;
    if ((r = /^:?-(.*)$/.exec(rest))) return val === '' ? r[1] : val;
    if ((r = /^:?=(.*)$/.exec(rest))) { if (val === '') { this.setVar(name, r[1]); return r[1]; } return val; }
    if ((r = /^:?\+(.*)$/.exec(rest))) return val !== '' ? r[1] : '';
    if ((r = /^(##?)(.*)$/.exec(rest))) { const re = globToRegex(r[2]); let best = val; for (let i = 0; i <= val.length; i++) if (re.test(val.slice(0, i))) { best = val.slice(i); if (r[1] === '#') break; } return best; }
    if ((r = /^(%%?)(.*)$/.exec(rest))) { const re = globToRegex(r[2]); let best = val; for (let i = val.length; i >= 0; i--) if (re.test(val.slice(i))) { best = val.slice(0, i); if (r[1] === '%') break; } return best; }
    if ((r = /^\/(\/?)([^/]*)\/?(.*)$/.exec(rest))) { const re = new RegExp(r[2].replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*'), r[1] ? 'g' : ''); return val.replace(re, r[3]); }
    if ((r = /^:(\d+)(?::(\d+))?$/.exec(rest))) return r[2] ? val.substr(Number(r[1]), Number(r[2])) : val.slice(Number(r[1]));
    return val;
  }

  arith(expr) {
    const e = expr.replace(/\$?([A-Za-z_][A-Za-z0-9_]*)/g, (_, n) => String(Number(this.getVar(n)) || 0));
    if (!/^[0-9+\-*/%()\s<>=!&|^]*$/.test(e)) return 0;
    try { return Math.trunc(Function(`"use strict";return (${e || 0})`)()); } catch { return 0; }
  }

  globExpand(pattern) {
    const abs = pattern.startsWith('/');
    const segs = pattern.split('/').filter((s) => s !== '');
    const fs = this.sys.vfs;
    const cred = this.cred;
    let bases = [abs ? '/' : this.cwd];
    let display = [abs ? '/' : ''];
    segs.forEach((seg, idx) => {
      const last = idx === segs.length - 1;
      const next = []; const nd = [];
      if (!/[*?[]/.test(seg)) {
        const lit = seg.replace(/\\(.)/g, '$1');
        bases.forEach((b, i) => { const p = posix.normalize(lit, b); if (fs.exists(p, { cred }) && (last || fs.isDir(p, { cred }))) { next.push(p); nd.push(display[i] + lit + (last ? '' : '/')); } });
      } else {
        const re = globToRegex(seg);
        bases.forEach((b, i) => {
          let names = [];
          try { names = fs.readdir(b, { cred }); } catch { return; }
          for (const n of names.sort()) {
            if (n.startsWith('.') && !seg.startsWith('.')) continue;
            if (!re.test(n)) continue;
            const p = posix.join(b, n);
            if (!last && !fs.isDir(p, { cred })) continue;
            next.push(p); nd.push(display[i] + n + (last ? '' : '/'));
          }
        });
      }
      bases = next; display = nd;
    });
    return segs.length ? display.filter((_, i) => bases[i] != null) : [];
  }

  // ------------------------------------------------------------ completion
  complete(line) {
    const m = /(^|\s)([^\s]*)$/.exec(line);
    const word = m ? m[2] : '';
    const first = line.slice(0, line.length - word.length).trim() === '';
    let cands = [];
    if (first && !word.includes('/')) {
      const set = new Set([...Object.keys(REGISTRY.builtins), ...Object.keys(REGISTRY.commands).filter((n) => !REGISTRY.commands[n].bin || this.sys.vfs.exists(REGISTRY.commands[n].bin)), ...this.aliases.keys()]);
      cands = [...set].filter((n) => n.startsWith(word)).sort();
    } else {
      const slash = word.lastIndexOf('/');
      const dirPart = slash >= 0 ? word.slice(0, slash + 1) : '';
      const base = word.slice(slash + 1);
      try {
        const dir = this.abs(dirPart || '.');
        for (const n of this.fsView().readdir(dir).sort()) {
          if (!n.startsWith(base) || (n.startsWith('.') && !base.startsWith('.'))) continue;
          const p = posix.join(dir, n);
          cands.push(dirPart + n + (this.sys.vfs.isDir(p) ? '/' : ''));
        }
      } catch { /* unreadable */ }
    }
    return { word, candidates: cands };
  }
}

export { BreakSignal, ContinueSignal };
