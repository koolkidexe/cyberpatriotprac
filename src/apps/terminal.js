// GNOME-Terminal-like window running one simulated bash.
import { h } from '../ui/dom.js';
import { AnsiView } from '../ui/ansi.js';
import { openNano, openVi } from '../ui/editors.js';
import { createShell } from '../shell/index.js';

let ttyCounter = 0;

export function openTerminal(env, opts = {}) {
  const user = opts.user || env.user;
  const out = h('div', { class: 'out' });
  const inl = h('div', { class: 'inl' });
  const term = h('div', { class: 'term', tabindex: 0 }, out, inl);
  const view = new AnsiView(out);
  // GNOME Terminal 3.44 as shipped on Mint 21 / Ubuntu 22.04: menu bar (Mint) and the dark theme variant
  const menuItem = (n, items) => h('div', { class: 'mi', title: `${n} menu`, onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); env.ui.showMenu(r.left, r.bottom, items()); } }, n);
  const termMenu = env.os === 'ubuntu' ? null : h('div', { class: 'menubar term-menu' },
    menuItem('File', () => [{ label: 'New Window', action: () => env.openApp('terminal', { user }) }, 'sep', { label: 'Close Window', action: () => win.close() }]),
    menuItem('Edit', () => [{ label: 'Copy', action: () => document.execCommand('copy') }, { label: 'Select All', action: () => { const r = document.createRange(); r.selectNodeContents(out); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r); } }]),
    menuItem('View', () => [{ label: 'Zoom In', action: () => zoom(1) }, { label: 'Normal Size', action: () => zoom(0) }, { label: 'Zoom Out', action: () => zoom(-1) }]),
    menuItem('Search', () => [{ label: 'Find… (use grep in the shell)', action: () => {} }]),
    menuItem('Terminal', () => [{ label: 'Reset and Clear', action: () => { out.textContent = ''; } }]),
    menuItem('Help', () => [{ label: 'About', action: () => env.ui.alert({ title: 'About Terminal', heading: 'GNOME Terminal 3.44.0', message: 'Simulated terminal running bash 5.1.', icon: 'terminal' }) }]));
  let fsz = 15;
  function zoom(d) { fsz = d === 0 ? 15 : Math.max(9, Math.min(28, fsz + d * 2)); term.style.fontSize = fsz + 'px'; }
  const wrap = termMenu ? h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } }, termMenu, term) : term;
  const win = env.wm.open({ title: `${user}@${env.sys.hostname}: ~`, icon: 'terminal', width: 760, height: 470, appId: 'terminal', content: wrap, minW: 360, minH: 200, cls: 'term-win' });
  const ttyNo = ++ttyCounter;
  let overlayOpen = false;
  let state = null; // active input request
  let running = false;
  let alive = true;
  const pasteQueue = [];

  // character cell measurement for $COLUMNS-style behaviour
  const probe = h('span', { class: 'probe' }, 'MMMMMMMMMM');
  inl.append(probe);
  const cell = () => { const r = probe.getBoundingClientRect(); return { w: (r.width / 10) || 8, h: (r.height) || 17 }; };

  const io = {
    write: (s) => { view.write(s); scroll(); },
    readLine: (prompt, o = {}) => requestInput(prompt, o),
    async editor(eo) {
      overlayOpen = true;
      term.blur();
      const fn = eo.kind === 'vi' ? openVi : openNano;
      try { return await fn(win.body, eo); } finally { overlayOpen = false; term.focus(); scroll(); }
    },
    launch: (app, o) => env.openApp(app, { ...o }),
    clear: () => { view.clear(); },
    exit: () => win.close(),
    power: (k) => env.power?.(k),
    notify: (a) => env.ui.toast({ title: a[0] || 'Notification', message: a.slice(1).join(' '), kind: 'info' }),
    get cols() { return Math.max(20, Math.floor((term.clientWidth - 16) / cell().w)); },
    get rows() { return Math.max(5, Math.floor(term.clientHeight / cell().h)); },
  };
  const shell = createShell(env.sys, { user, io });
  shell.ttyNo = ttyNo;
  if (opts.cwd && env.sys.vfs.isDir(opts.cwd)) shell.cwd = opts.cwd;
  win.shell = shell;

  function scroll() { term.scrollTop = term.scrollHeight; }
  function title() {
    const home = shell.env.HOME;
    let p = shell.cwd;
    if (home && (p === home || p.startsWith(home + '/'))) p = '~' + p.slice(home.length);
    win.setTitle(`${shell.user}@${env.sys.hostname}: ${p}`);
  }

  // ---------------------------------------------------------------- input line
  function renderInput() {
    if (!state) { inl.style.display = 'none'; return; }
    inl.style.display = '';
    inl.textContent = '';
    const tmp = document.createElement('div');
    const pv = new AnsiView(tmp);
    pv.write(state.prompt);
    for (const n of [...tmp.firstChild.childNodes]) inl.append(n);
    const text = state.secret ? '' : state.buf;
    const before = text.slice(0, state.pos); const at = text[state.pos] ?? ' '; const after = text.slice(state.pos + 1);
    inl.append(document.createTextNode(before), h('span', { class: 'cur' + (document.activeElement === term ? ' on' : '') }, at), document.createTextNode(after), probe);
    scroll();
  }

  function requestInput(prompt, o = {}) {
    return new Promise((resolve) => {
      state = { prompt, buf: '', pos: 0, echo: o.echo !== false && !o.secret, secret: !!o.secret, main: !!o.main, resolve, hist: -1, draft: '', tabs: 0 };
      renderInput();
      term.focus();
    });
  }
  function finish(value, { echo = true } = {}) {
    const s = state; state = null; renderInput();
    const shown = s.secret ? '' : (s.echo ? s.buf : '');
    if (echo) view.write(s.prompt + shown + (value === null && s.main ? '' : '') + '\n');
    s.resolve(value);
  }

  async function mainLoop() {
    while (alive) {
      title();
      const line = await requestInput(shell.prompt(), { main: true });
      if (!alive) break;
      if (line === null) { await runLine('exit'); continue; }
      if (line.trim() === '') continue;
      await runLine(line, true);
      if (pasteQueue.length) { /* continue below */ }
    }
  }
  async function runLine(line, echoed = false) {
    running = true;
    try { await shell.run(line); } catch (e) {
      if (e && e.shellExit !== undefined) { win.close(); return; }
      console.error(e);
    }
    running = false;
    shell.saveHistory?.();
    scroll();
  }

  // ---------------------------------------------------------------- keyboard
  function wordLeft(s, p) { let i = p; while (i > 0 && /\s/.test(s[i - 1])) i--; while (i > 0 && !/\s/.test(s[i - 1])) i--; return i; }
  function wordRight(s, p) { let i = p; while (i < s.length && /\s/.test(s[i])) i++; while (i < s.length && !/\s/.test(s[i])) i++; return i; }

  function onKey(e) {
    if (overlayOpen) return;
    if (e.ctrlKey && e.shiftKey && ['C', 'V'].includes(e.key.toUpperCase())) return; // copy / paste handled by the browser
    if (!state) {
      if (e.ctrlKey && e.key.toLowerCase() === 'c' && running) { e.preventDefault(); shell.abort = true; view.write('^C\n'); }
      return;
    }
    const s = state;
    const k = e.key;
    const ctrl = e.ctrlKey; const alt = e.altKey;
    let handled = true;
    if (ctrl && k.toLowerCase() === 'c') {
      if (s.main) { view.write(s.prompt + s.buf + '^C\n'); s.buf = ''; s.pos = 0; state = null; shell.status = 130; s.resolve(''); }
      else { view.write(s.prompt + '\n'); shell.abort = true; const r = s.resolve; state = null; renderInput(); r(null); }
    } else if (ctrl && k.toLowerCase() === 'd') {
      if (s.buf === '') { if (s.main) { view.write(s.prompt + 'exit\n'); const r = s.resolve; state = null; renderInput(); r(null); } else finish(null, { echo: false }); } else handled = true;
    } else if (ctrl && k.toLowerCase() === 'l') { view.clear(); renderInput(); }
    else if (ctrl && k.toLowerCase() === 'a') { s.pos = 0; renderInput(); }
    else if (ctrl && k.toLowerCase() === 'e') { s.pos = s.buf.length; renderInput(); }
    else if (ctrl && k.toLowerCase() === 'u') { s.buf = s.buf.slice(s.pos); s.pos = 0; renderInput(); }
    else if (ctrl && k.toLowerCase() === 'k') { s.buf = s.buf.slice(0, s.pos); renderInput(); }
    else if (ctrl && k.toLowerCase() === 'w') { const i = wordLeft(s.buf, s.pos); s.buf = s.buf.slice(0, i) + s.buf.slice(s.pos); s.pos = i; renderInput(); }
    else if (ctrl && k === 'ArrowLeft' || alt && k.toLowerCase() === 'b') { s.pos = wordLeft(s.buf, s.pos); renderInput(); }
    else if (ctrl && k === 'ArrowRight' || alt && k.toLowerCase() === 'f') { s.pos = wordRight(s.buf, s.pos); renderInput(); }
    else if (k === 'Enter') { const v = s.buf; if (s.main) { view.write(s.prompt + v + '\n'); state = null; renderInput(); s.resolve(v); } else finish(v); }
    else if (k === 'Backspace') { if (s.pos > 0) { s.buf = s.buf.slice(0, s.pos - 1) + s.buf.slice(s.pos); s.pos--; } renderInput(); }
    else if (k === 'Delete') { s.buf = s.buf.slice(0, s.pos) + s.buf.slice(s.pos + 1); renderInput(); }
    else if (k === 'ArrowLeft') { s.pos = Math.max(0, s.pos - 1); renderInput(); }
    else if (k === 'ArrowRight') { s.pos = Math.min(s.buf.length, s.pos + 1); renderInput(); }
    else if (k === 'Home') { s.pos = 0; renderInput(); }
    else if (k === 'End') { s.pos = s.buf.length; renderInput(); }
    else if (k === 'ArrowUp' && s.main) {
      const hist = shell.history;
      if (s.hist === -1) { s.draft = s.buf; s.hist = hist.length; }
      if (s.hist > 0) { s.hist--; s.buf = hist[s.hist]; s.pos = s.buf.length; }
      renderInput();
    } else if (k === 'ArrowDown' && s.main) {
      const hist = shell.history;
      if (s.hist !== -1) { s.hist++; s.buf = s.hist >= hist.length ? s.draft : hist[s.hist]; if (s.hist >= hist.length) s.hist = -1; s.pos = s.buf.length; }
      renderInput();
    } else if (k === 'Tab' && s.main) { complete(s); }
    else if (k === 'PageUp') { term.scrollTop -= term.clientHeight * 0.9; }
    else if (k === 'PageDown') { term.scrollTop += term.clientHeight * 0.9; }
    else if (k.length === 1 && !ctrl && !e.metaKey) { s.buf = s.buf.slice(0, s.pos) + k + s.buf.slice(s.pos); s.pos++; renderInput(); }
    else handled = false;
    if (handled) e.preventDefault();
    if (s.main && k !== 'Tab') s.tabs = 0;
  }

  function commonPrefix(list) {
    let p = list[0];
    for (const x of list) { while (!x.startsWith(p)) p = p.slice(0, -1); }
    return p;
  }
  function complete(s) {
    const r = shell.complete(s.buf, s.pos);
    if (!r.candidates.length) return;
    const apply = (rep, trailing) => { s.buf = s.buf.slice(0, r.start) + rep + trailing + s.buf.slice(s.pos); s.pos = r.start + rep.length + trailing.length; };
    if (r.candidates.length === 1) { apply(r.escaped[0], r.single ? ' ' : ''); renderInput(); return; }
    const cp = commonPrefix(r.candidates);
    const word = s.buf.slice(r.start, s.pos).replace(/\\(.)/g, '$1');
    if (cp.length > word.length) { apply(r.escaped[0].slice(0, 0) + cp.replace(/([ '"\\&;|()<>*?[\]$`!#])/g, '\\$1'), ''); renderInput(); return; }
    s.tabs = (s.tabs || 0) + 1;
    if (s.tabs >= 2) {
      const cols = Math.max(1, Math.floor(io.cols / (Math.max(...r.candidates.map((c) => c.length)) + 2)));
      const w = Math.max(...r.candidates.map((c) => c.length)) + 2;
      let text = '';
      const rows = Math.ceil(r.candidates.length / cols);
      for (let i = 0; i < rows; i++) { let line = ''; for (let j = i; j < r.candidates.length; j += rows) line += r.candidates[j].padEnd(w); text += line.trimEnd() + '\n'; }
      view.write(s.prompt + s.buf + '\n' + text);
      renderInput();
    }
  }

  term.addEventListener('keydown', onKey);
  term.addEventListener('mousedown', () => { setTimeout(() => { if (!window.getSelection().toString()) term.focus(); }, 0); });
  term.addEventListener('focus', renderInput);
  term.addEventListener('blur', renderInput);
  document.addEventListener('paste', onPaste, true);
  function onPaste(e) {
    if (overlayOpen || !win.el.contains(document.activeElement) && document.activeElement !== term) return;
    const t = (e.clipboardData || window.clipboardData)?.getData('text') || '';
    if (!t) return;
    e.preventDefault();
    const lines = t.replace(/\r/g, '').split('\n');
    const first = lines.shift();
    if (state) { state.buf = state.buf.slice(0, state.pos) + first + state.buf.slice(state.pos); state.pos += first.length; renderInput(); }
    if (lines.length && state?.main) {
      const submit = async (l) => { if (!state) return false; state.buf += ''; const s = state; view.write(s.prompt + s.buf + '\n'); state = null; renderInput(); s.resolve(s.buf); return true; };
      (async () => {
        await submit();
        for (const l of lines) { if (l === '' ) continue; await new Promise((r) => setTimeout(r, 30)); while (!state || !state.main) await new Promise((r) => setTimeout(r, 30)); state.buf = l; state.pos = l.length; if (l !== lines[lines.length - 1] || t.endsWith('\n')) await submit(); }
      })();
    }
  }
  win.onClose(() => { alive = false; document.removeEventListener('paste', onPaste, true); if (state) { const r = state.resolve; state = null; r(null); } shell.saveHistory?.(); });
  win.el.addEventListener('wmresize', () => scroll());

  // greeting like a real session: nothing (bash starts straight at the prompt)
  mainLoop();
  setTimeout(() => term.focus(), 30);
  if (opts.run) setTimeout(() => runLine(opts.run), 50);
  return win;
}

export const open = openTerminal;
