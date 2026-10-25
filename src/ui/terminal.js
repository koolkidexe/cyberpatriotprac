// Terminal emulator window: ANSI rendering, line editing, history, tab completion, password prompts and a nano-style editor.
import { Shell, ExitSignal } from '../shell/index.js';

const SGR = { 30: '#2e3436', 31: '#cc0000', 32: '#4e9a06', 33: '#c4a000', 34: '#729fcf', 35: '#75507b', 36: '#06989a', 37: '#d3d7cf', 90: '#555753', 91: '#ef2929', 92: '#8ae234', 93: '#fce94f', 94: '#729fcf', 95: '#ad7fa8', 96: '#34e2e2', 97: '#eeeeec' };
const BG = { 40: '#2e3436', 41: '#cc0000', 42: '#4e9a06', 43: '#c4a000', 44: '#3465a4', 45: '#75507b', 46: '#06989a', 47: '#d3d7cf' };
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export class AnsiBuffer {
  constructor() { this.html = []; this.st = {}; }
  write(text) {
    const re = /\u001b\[([0-9;]*)([A-Za-z])|\u001b\][^\u0007]*\u0007|\u001b\[K/g; let last = 0; let m;
    const flush = (t) => { if (!t) return; t = t.replace(/\r/g, ''); const s = this.style(); this.html.push(s ? `<span style="${s}">${esc(t)}</span>` : esc(t)); };
    while ((m = re.exec(text))) { flush(text.slice(last, m.index)); last = re.lastIndex; if (m[2] === 'm') this.sgr(m[1]); }
    flush(text.slice(last));
  }
  sgr(p) {
    const codes = p === '' ? [0] : p.split(';').map(Number);
    for (const c of codes) { if (c === 0) this.st = {}; else if (c === 1) this.st.b = 1; else if (c === 4) this.st.u = 1; else if (c === 7) this.st.r = 1; else if (SGR[c]) this.st.fg = SGR[c]; else if (BG[c]) this.st.bg = BG[c]; else if (c === 39) delete this.st.fg; else if (c === 49) delete this.st.bg; }
  }
  style() { const s = this.st; let o = ''; if (s.fg) o += `color:${s.fg};`; if (s.bg) o += `background:${s.bg};`; if (s.b) o += 'font-weight:bold;'; if (s.u) o += 'text-decoration:underline;'; return o; }
  get text() { return this.html.join(''); }
}

export function openTerminal(app, wm, { user = 'student' } = {}) {
  return wm.open({ title: `${user}@${app.sys.hostname}: ~`, kind: 'terminal', width: 760, height: 460, x: 130, y: 24, content: (w) => {
    const el = document.createElement('div'); el.className = 'term'; el.tabIndex = 0; w.body.appendChild(el);
    const out = new AnsiBuffer(); let line = ''; let cur = 0; let mode = 'idle'; let secret = false; let promptText = ''; let resolvePrompt = null; let hist = -1; let saved = ''; let pending = ''; let busy = false; let editorOpen = false;
    const io = {
      write: (s) => { out.write(s); draw(); },
      prompt: (text, { silent } = {}) => new Promise((res) => { out.write(text); promptText = ''; secret = !!silent; mode = 'prompt'; line = ''; cur = 0; resolvePrompt = res; draw(); el.focus(); }),
      editor: (o) => runEditor(o), launch: (a, args, ctx) => app.launch(a, args, ctx), clear: () => { out.html = []; draw(); },
      exit: () => w.close(),
    };
    const shell = new Shell(app.sys, io, { user, cols: 90 }); w.shell = shell;
    const fit = () => { shell.cols = Math.max(40, Math.floor((el.clientWidth - 16) / 7.8)); }; fit();
    const setTitle = () => w.setTitle(`${shell.euser}@${app.sys.hostname}: ${shell.cwd.replace(shell.home(), '~')}`);
    function draw() {
      const before = esc(line.slice(0, cur)); const at = line[cur] ?? ' '; const after = esc(line.slice(cur + 1));
      const shown = secret ? '' : `${before}<span class="cur">${esc(at)}</span>${after}`;
      const pr = mode === 'idle' ? new AnsiBuffer() : null;
      let promptHtml = ''; if (pr) { pr.write(pending ? '> ' : shell.prompt()); promptHtml = pr.text; }
      el.innerHTML = out.text + promptHtml + (mode === 'running' ? '' : secret ? '<span class="cur"> </span>' : shown);
      el.scrollTop = el.scrollHeight;
    }
    async function submit() {
      if (mode === 'prompt') { const v = line; mode = 'running'; const r = resolvePrompt; resolvePrompt = null; out.write(secret ? '\n' : v + '\n'); secret = false; line = ''; cur = 0; r(v); return; }
      const text = (pending ? pending + '\n' : '') + line;
      const pr = new AnsiBuffer(); pr.write(pending ? '> ' : shell.prompt()); out.html.push(pr.text); out.write(line + '\n');
      line = ''; cur = 0; hist = -1;
      if (!shell.isComplete(text)) { pending = text; draw(); return; }
      pending = ''; mode = 'running'; busy = true; draw();
      try { await shell.execLine(text); } catch (e) { if (e instanceof ExitSignal) { w.close(); return; } out.write(`bash: internal error: ${e.message}\n`); console.error(e); }
      busy = false; mode = 'idle'; setTitle(); draw();
    }
    function complete() {
      const { word, candidates } = shell.complete(line.slice(0, cur));
      if (!candidates.length) return;
      const common = candidates.reduce((a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return a.slice(0, i); });
      if (candidates.length === 1 || common.length > word.length) { const add = (candidates.length === 1 ? candidates[0] : common).slice(word.length); const needsSpace = candidates.length === 1 && !candidates[0].endsWith('/'); line = line.slice(0, cur) + add + (needsSpace ? ' ' : '') + line.slice(cur); cur += add.length + (needsSpace ? 1 : 0); }
      else { const pr = new AnsiBuffer(); pr.write(shell.prompt()); out.html.push(pr.text); out.write(line + '\n' + candidates.map((c) => c.replace(/\/$/, '/')).join('  ') + '\n'); }
      draw();
    }
    el.addEventListener('keydown', (e) => {
      if (editorOpen) return;
      if (mode === 'running') { if (e.ctrlKey && e.key === 'c') { out.write('^C\n'); } return; }
      const k = e.key;
      if (e.ctrlKey && !e.shiftKey) {
        if (k === 'c') { e.preventDefault(); if (mode === 'prompt') { const r = resolvePrompt; resolvePrompt = null; mode = 'running'; out.write('\n'); r(null); return; } const pr = new AnsiBuffer(); pr.write(pending ? '> ' : shell.prompt()); out.html.push(pr.text); out.write(line + '^C\n'); line = ''; cur = 0; pending = ''; draw(); return; }
        if (k === 'l') { e.preventDefault(); out.html = []; draw(); return; }
        if (k === 'a') { e.preventDefault(); cur = 0; draw(); return; } if (k === 'e') { e.preventDefault(); cur = line.length; draw(); return; }
        if (k === 'u') { e.preventDefault(); line = line.slice(cur); cur = 0; draw(); return; } if (k === 'k') { e.preventDefault(); line = line.slice(0, cur); draw(); return; }
        if (k === 'w') { e.preventDefault(); const b = line.slice(0, cur).replace(/\s*\S*$/, ''); line = b + line.slice(cur); cur = b.length; draw(); return; }
        if (k === 'd') { e.preventDefault(); if (!line) { if (shell.frames.length) { line = 'exit'; submit(); } else w.close(); } return; }
        return;
      }
      if (e.metaKey || e.altKey) return;
      if (k === 'Enter') { e.preventDefault(); submit(); }
      else if (k === 'Backspace') { e.preventDefault(); if (cur > 0) { line = line.slice(0, cur - 1) + line.slice(cur); cur--; draw(); } }
      else if (k === 'Delete') { e.preventDefault(); line = line.slice(0, cur) + line.slice(cur + 1); draw(); }
      else if (k === 'ArrowLeft') { e.preventDefault(); cur = Math.max(0, cur - 1); draw(); } else if (k === 'ArrowRight') { e.preventDefault(); cur = Math.min(line.length, cur + 1); draw(); }
      else if (k === 'Home') { cur = 0; draw(); } else if (k === 'End') { cur = line.length; draw(); }
      else if (k === 'ArrowUp' && mode === 'idle') { e.preventDefault(); const h = shell.history; if (hist === -1) saved = line; if (hist < h.length - 1) { hist++; line = h[h.length - 1 - hist]; cur = line.length; draw(); } }
      else if (k === 'ArrowDown' && mode === 'idle') { e.preventDefault(); if (hist > -1) { hist--; line = hist === -1 ? saved : shell.history[shell.history.length - 1 - hist]; cur = line.length; draw(); } }
      else if (k === 'Tab') { e.preventDefault(); if (mode === 'idle') complete(); }
      else if (k.length === 1) { e.preventDefault(); line = line.slice(0, cur) + k + line.slice(cur); cur++; draw(); }
    });
    el.addEventListener('paste', (e) => { e.preventDefault(); if (mode === 'running' || editorOpen) return; const t = (e.clipboardData.getData('text') || '').replace(/\r/g, ''); const parts = t.split('\n'); line = line.slice(0, cur) + parts[0] + line.slice(cur); cur += parts[0].length; draw(); if (parts.length > 1) { /* multi-line paste: run the first line */ submit(); } });
    el.addEventListener('focus', () => el.classList.remove('blur')); el.addEventListener('blur', () => el.classList.add('blur'));
    w.onFocus = () => el.focus(); w.onResize = () => { fit(); draw(); };

    // ---- nano-style editor overlay
    function runEditor({ path, shown, content, title, save, isNew }) {
      return new Promise((resolve) => {
        editorOpen = true;
        const ov = document.createElement('div'); ov.className = 'editor';
        ov.innerHTML = `<div class="hd"><span>${esc(title || 'GNU nano 6.2')}</span><span></span></div><textarea spellcheck="false"></textarea><div class="msg"><span></span></div><div class="keys"><span><b data-k="o">^O</b>Write Out</span><span><b data-k="x">^X</b>Exit</span><span><b data-k="k">^K</b>Cut Line</span><span><b data-k="u">^U</b>Paste</span></div>`;
        w.body.style.position = 'relative'; w.body.appendChild(ov);
        const ta = ov.querySelector('textarea'); const msg = ov.querySelector('.msg span'); ta.value = content; let orig = content; let clip = ''; let asking = false;
        const flash = (t) => { msg.textContent = t ? `[ ${t} ]` : ''; msg.style.display = t ? '' : 'none'; };
        if (isNew) flash('New File'); else flash('');
        const nlines = () => ta.value.split('\n').length - (ta.value.endsWith('\n') ? 1 : 0);
        const doSave = async () => { try { await save(ta.value); orig = ta.value; flash(`Wrote ${nlines()} line${nlines() === 1 ? '' : 's'}`); app.sys.touch('edit'); return true; } catch (e) { flash(e.message || 'Error writing file'); return false; } };
        const done = () => { ov.remove(); editorOpen = false; w.onClose = null; resolve(); el.focus(); };
        const exit = async () => { if (ta.value === orig) return done(); asking = true; flash('Save modified buffer?  Y = Yes   N = No   ^C = Cancel'); };
        ta.addEventListener('keydown', async (e) => {
          e.stopPropagation();
          if (asking) { e.preventDefault(); const k = e.key.toLowerCase(); if (k === 'y') { asking = false; if (await doSave()) done(); } else if (k === 'n') done(); else if (k === 'c' && e.ctrlKey || k === 'escape') { asking = false; flash(''); } return; }
          if (e.ctrlKey && e.key === 'o') { e.preventDefault(); await doSave(); }
          else if (e.ctrlKey && e.key === 'x') { e.preventDefault(); exit(); }
          else if (e.ctrlKey && e.key === 'k') { e.preventDefault(); const p = ta.selectionStart; const s = ta.value.lastIndexOf('\n', p - 1) + 1; let en = ta.value.indexOf('\n', p); en = en < 0 ? ta.value.length : en + 1; clip = ta.value.slice(s, en); ta.value = ta.value.slice(0, s) + ta.value.slice(en); ta.selectionStart = ta.selectionEnd = s; }
          else if (e.ctrlKey && e.key === 'u') { e.preventDefault(); const p = ta.selectionStart; ta.value = ta.value.slice(0, p) + clip + ta.value.slice(p); ta.selectionStart = ta.selectionEnd = p + clip.length; }
        });
        ov.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', async () => { if (b.dataset.k === 'o') await doSave(); else if (b.dataset.k === 'x') exit(); }));
        w.onClose = () => { if (editorOpen) { done(); } return true; };
        ta.focus(); ta.setSelectionRange(0, 0);
      });
    }
    out.write('\u001b[0m'); draw(); setTimeout(() => el.focus(), 0);
    if (app.motd) io.write(app.motd);
    mode = 'idle'; draw(); void busy;
  } });
}
