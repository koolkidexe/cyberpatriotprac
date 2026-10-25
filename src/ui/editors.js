// Terminal editors: a faithful-enough GNU nano 6.2 and a small modal vi, rendered as overlays on a terminal body.
import { h } from './dom.js';

const NANO_KEYS = [
  [['^G', 'Help'], ['^O', 'Write Out'], ['^W', 'Where Is'], ['^K', 'Cut'], ['^T', 'Execute'], ['^C', 'Location']],
  [['^X', 'Exit'], ['^R', 'Read File'], ['^\\', 'Replace'], ['^U', 'Paste'], ['^J', 'Justify'], ['^/', 'Go To Line']],
];

const lineCount = (t) => (t === '' ? 0 : t.replace(/\n$/, '').split('\n').length);

/** opts: { path, display, text, isNew, readErr, save(text)->{ok,err}, startLine, readOnly } -> Promise<string|null> */
export function openNano(host, opts) {
  return new Promise((resolve) => {
    const path = opts.path;
    const nameShown = opts.display ?? path ?? '';
    let savedText = null;
    let original = opts.text || '';
    let cutBuf = [];
    let mode = null; // null | { kind, resolve }
    const ta = h('textarea', { class: 'nano-ta', spellcheck: false, wrap: 'off', value: original });
    const title = h('div', { class: 'nano-title' });
    const status = h('div', { class: 'nano-status' });
    const prompt = h('div', { class: 'nano-prompt', style: { display: 'none' } });
    const help = h('div', { class: 'nano-help' });
    const root = h('div', { class: 'nano' }, title, ta, status, prompt, help);

    const renderTitle = () => {
      const mod = ta.value !== original;
      title.innerHTML = '';
      title.append(h('span', null, '  GNU nano 6.2'), h('span', { class: 'c' }, nameShown ? nameShown : 'New Buffer'), h('span', { class: 'r' }, mod ? 'Modified  ' : ''));
    };
    const say = (msg, ms = 4000) => {
      status.textContent = msg ? `[ ${msg} ]` : '';
      status.style.visibility = msg ? 'visible' : 'hidden';
      clearTimeout(say.t);
      if (msg && ms) say.t = setTimeout(() => { status.style.visibility = 'hidden'; }, ms);
    };
    const renderHelp = (rows) => {
      help.innerHTML = '';
      for (const row of rows) help.append(h('div', { class: 'row' }, row.map(([k, d]) => h('span', { class: 'it', onclick: () => key(k) }, h('b', null, k), ' ' + d))));
    };
    renderHelp(NANO_KEYS);

    function done(val) { root.remove(); resolve(val); }
    function curLine() { const before = ta.value.slice(0, ta.selectionStart); return before.split('\n').length - 1; }
    function lineBounds(n) {
      const lines = ta.value.split('\n'); let s = 0;
      for (let i = 0; i < n; i++) s += lines[i].length + 1;
      return [s, s + (lines[n] ?? '').length];
    }
    function ask(label, initial = '') {
      return new Promise((res) => {
        prompt.style.display = ''; help.style.display = 'none';
        const inp = h('input', { class: 'nano-in', value: initial, spellcheck: false, onkeydown: (e) => {
          if (e.key === 'Enter') { e.preventDefault(); close(inp.value); }
          else if (e.key === 'Escape' || (e.ctrlKey && e.key.toLowerCase() === 'c')) { e.preventDefault(); close(null); }
          e.stopPropagation();
        } });
        const close = (v) => { prompt.style.display = 'none'; help.style.display = ''; ta.focus(); mode = null; res(v); };
        prompt.innerHTML = ''; prompt.append(h('span', null, label), inp);
        mode = { kind: 'ask' };
        inp.focus(); inp.select?.();
      });
    }
    function askYN(label) {
      return new Promise((res) => {
        prompt.style.display = ''; help.style.display = 'none';
        prompt.innerHTML = '';
        const fin = (v) => { prompt.style.display = 'none'; help.style.display = ''; ta.focus(); mode = null; res(v); };
        const box = h('div', { class: 'nano-yn', tabindex: 0, onkeydown: (e) => {
          const k = e.key.toLowerCase();
          if (k === 'y') fin('y'); else if (k === 'n') fin('n'); else if (k === 'escape' || (e.ctrlKey && k === 'c')) fin(null);
          e.preventDefault(); e.stopPropagation();
        } }, h('div', null, label), h('div', { class: 'opts' }, h('span', { onclick: () => fin('y') }, h('b', null, ' Y'), ' Yes'), h('span', { onclick: () => fin('n') }, h('b', null, ' N'), ' No'), h('span', { onclick: () => fin(null) }, h('b', null, '^C'), ' Cancel')));
        prompt.append(box);
        mode = { kind: 'yn' };
        box.focus();
      });
    }

    async function writeOut() {
      if (opts.readOnly) { say('Key invalid in view mode'); return false; }
      let target = path;
      if (opts.save || path) {
        const entered = await ask('File Name to Write: ', nameShown);
        if (entered == null) { say('Cancelled'); return false; }
        target = entered || path;
      }
      const text = ta.value;
      if (opts.save) {
        if (target !== path && target) {
          // writing under another name: the caller only knows `path`; report as unsupported
          say(`Error writing ${target}: Writing to another file is not supported here`);
          return false;
        }
        const r = opts.save(text);
        if (!r.ok) { say(`Error writing ${target}: ${r.err}`, 6000); return false; }
      }
      savedText = text; original = text;
      renderTitle();
      const n = lineCount(text);
      say(`Wrote ${n} line${n === 1 ? '' : 's'}`);
      return true;
    }
    async function exit() {
      if (ta.value !== original) {
        const a = await askYN('Save modified buffer?  (Answering "No" will DISCARD changes.) ');
        if (a == null) { say('Cancelled'); return; }
        if (a === 'y') { const ok = await writeOut(); if (!ok) return; }
      }
      done(savedText);
    }
    async function where() {
      const q = await ask('Search: ', root.dataset.lastSearch || '');
      if (q == null || q === '') { say('Cancelled'); return; }
      root.dataset.lastSearch = q;
      const hay = ta.value.toLowerCase(); const needle = q.toLowerCase();
      let i = hay.indexOf(needle, ta.selectionEnd);
      if (i < 0) { i = hay.indexOf(needle); if (i >= 0) say('Search Wrapped'); }
      if (i < 0) { say(`"${q}" not found`); return; }
      ta.focus(); ta.setSelectionRange(i, i + q.length);
      scrollToCaret();
    }
    async function replace() {
      const q = await ask('Search (to replace): ');
      if (!q) { say('Cancelled'); return; }
      const r = await ask('Replace with: ');
      if (r == null) { say('Cancelled'); return; }
      const n = ta.value.split(q).length - 1;
      if (!n) { say(`"${q}" not found`); return; }
      ta.value = ta.value.split(q).join(r);
      renderTitle();
      say(`Replaced ${n} occurrence${n === 1 ? '' : 's'}`);
    }
    async function goto() {
      const v = await ask('Enter line number, column number: ');
      if (v == null) return;
      const [l, c] = v.split(',').map((x) => parseInt(x, 10));
      if (!l) return;
      const [s, e] = lineBounds(Math.min(Math.max(l, 1), ta.value.split('\n').length) - 1);
      const pos = Math.min(s + ((c || 1) - 1), e);
      ta.focus(); ta.setSelectionRange(pos, pos); scrollToCaret();
    }
    function scrollToCaret() {
      const cs = getComputedStyle(ta); const lh = parseFloat(cs.lineHeight) || 18;
      const y = curLine() * lh;
      if (y < ta.scrollTop) ta.scrollTop = y; else if (y > ta.scrollTop + ta.clientHeight - lh * 2) ta.scrollTop = y - ta.clientHeight + lh * 3;
    }
    function cut() {
      const n = curLine(); const lines = ta.value.split('\n');
      if (lines.length === 1 && lines[0] === '') return;
      cutBuf = [lines[n]];
      lines.splice(n, 1);
      ta.value = lines.join('\n');
      const [s] = lineBounds(Math.min(n, lines.length - 1));
      ta.setSelectionRange(s, s);
      renderTitle();
    }
    function paste() {
      if (!cutBuf.length) { say('Cutbuffer is empty'); return; }
      const n = curLine(); const lines = ta.value.split('\n');
      lines.splice(n, 0, ...cutBuf);
      ta.value = lines.join('\n');
      const [s] = lineBounds(n + cutBuf.length);
      ta.setSelectionRange(s, s);
      renderTitle();
    }
    function location() {
      const before = ta.value.slice(0, ta.selectionStart); const ln = before.split('\n').length; const total = ta.value.split('\n').length;
      const col = before.length - before.lastIndexOf('\n'); const lineLen = ta.value.split('\n')[ln - 1].length + 1;
      say(`line ${ln}/${total} (${Math.round((ln / total) * 100)}%), col ${col}/${lineLen} (${Math.round((col / lineLen) * 100)}%), char ${before.length + 1}/${ta.value.length + 1} (${Math.round(((before.length + 1) / (ta.value.length + 1)) * 100)}%)`);
    }
    function showHelp() {
      const back = h('div', { class: 'nano-helppage' }, h('pre', null, `Main nano help text\n\n The nano editor is designed to emulate the functionality and ease-of-use of the UW Pico text editor.\n\n Keystrokes written ^X mean "hold Ctrl and press X". In this simulator the shortcut list at the bottom of the screen is clickable, which is handy when your browser keeps ^W or ^T for itself. F2 exits, F3 writes out, F6 searches.\n\n ^O  Write the current buffer to disk\n ^X  Exit (asks to save when modified)\n ^W  Search for text\n ^\\  Replace text\n ^K  Cut the current line\n ^U  Paste the cut line\n ^C  Show the cursor position\n ^/  Go to a line number\n\n (press any key to return)`));
      root.append(back);
      const rm = () => { back.remove(); ta.focus(); };
      back.tabIndex = 0; back.focus(); back.onkeydown = rm; back.onclick = rm;
    }
    function key(k) {
      switch (k) {
        case '^G': showHelp(); break;
        case '^O': writeOut(); break;
        case '^X': exit(); break;
        case '^W': where(); break;
        case '^\\': replace(); break;
        case '^K': cut(); break;
        case '^U': paste(); break;
        case '^C': location(); break;
        case '^/': case '^_': goto(); break;
        case '^R': say('Reading other files is not supported in the simulator'); break;
        case '^T': say('Command execution is not supported in the simulator'); break;
        case '^J': say('Justify is not supported in the simulator'); break;
        default: break;
      }
      ta.focus();
    }
    ta.addEventListener('input', renderTitle);
    ta.addEventListener('keydown', (e) => {
      if (mode) return;
      const k = e.key.toLowerCase();
      if (e.ctrlKey && !e.shiftKey && !e.altKey) {
        const map = { g: '^G', o: '^O', x: '^X', w: '^W', k: '^K', u: '^U', c: '^C', r: '^R', t: '^T', j: '^J', '\\': '^\\', '/': '^/', _: '^/' };
        if (map[k]) { e.preventDefault(); e.stopPropagation(); key(map[k]); }
        else if (k === 'a') { e.preventDefault(); const [s] = lineBounds(curLine()); ta.setSelectionRange(s, s); }
        else if (k === 'e') { e.preventDefault(); const [, en] = lineBounds(curLine()); ta.setSelectionRange(en, en); }
      } else if (e.key === 'F1') { e.preventDefault(); key('^G'); }
      else if (e.key === 'F2') { e.preventDefault(); key('^X'); }
      else if (e.key === 'F3') { e.preventDefault(); key('^O'); }
      else if (e.key === 'F6') { e.preventDefault(); key('^W'); }
      else if (e.altKey && k === 'u') { e.preventDefault(); document.execCommand('undo'); }
      else if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '\t'); }
      e.stopPropagation();
    });
    ta.addEventListener('keyup', (e) => e.stopPropagation());
    host.append(root);
    renderTitle();
    if (opts.readErr) say(`Error reading ${nameShown}: ${opts.readErr}`, 0);
    else if (opts.isNew) say('New File', 0);
    else { const n = lineCount(original); say(`Read ${n} line${n === 1 ? '' : 's'}`, 3500); }
    ta.focus();
    if (opts.startLine > 1) { const [s] = lineBounds(opts.startLine - 1); ta.setSelectionRange(s, s); } else ta.setSelectionRange(0, 0);
    ta.scrollTop = 0;
    // saving: the editor is "done" with whatever the last successful save wrote
  });
}

/** Minimal vi: normal/insert/command-line modes over a textarea. */
export function openVi(host, opts) {
  return new Promise((resolve) => {
    const path = opts.path;
    let original = opts.text || '';
    let savedText = null;
    let insert = false; let cmdline = null; let pending = ''; let yank = ''; let msg = '';
    const ta = h('textarea', { class: 'nano-ta vi-ta', spellcheck: false, wrap: 'off', value: original });
    const bar = h('div', { class: 'vi-bar' });
    const root = h('div', { class: 'nano vi' }, ta, bar);
    const total = () => ta.value.split('\n').length;
    const pos = () => { const b = ta.value.slice(0, ta.selectionStart); const ln = b.split('\n').length; return [ln, b.length - b.lastIndexOf('\n')]; };
    const render = () => {
      if (cmdline != null) { bar.textContent = ':' + cmdline; return; }
      if (msg) { bar.textContent = msg; return; }
      const [l, c] = pos();
      bar.textContent = insert ? '-- INSERT --' : (`"${opts.display ?? path ?? ''}" ${total()}L, ${ta.value.length}C`.slice(0, 0) + '');
      const r = h('span', { class: 'r' }, `${l},${c}`);
      bar.append(r);
    };
    const lb = (n) => { const lines = ta.value.split('\n'); let s = 0; for (let i = 0; i < n; i++) s += lines[i].length + 1; return [s, s + (lines[n] ?? '').length]; };
    const cur = () => ta.value.slice(0, ta.selectionStart).split('\n').length - 1;
    const setPos = (p) => { ta.setSelectionRange(p, p); };
    function writeOut() {
      if (opts.save) { const r = opts.save(ta.value); if (!r.ok) { msg = `E212: Can't open file for writing`; return false; } }
      savedText = ta.value; original = ta.value;
      msg = `"${opts.display ?? path}" ${total()}L, ${ta.value.length}C written`;
      return true;
    }
    function runCmd(c) {
      const t = c.trim();
      if (t === 'w' || t === 'w!') { writeOut(); }
      else if (t === 'wq' || t === 'x' || t === 'wq!' || t === 'x!') { if (writeOut()) { root.remove(); resolve(savedText); return; } }
      else if (t === 'q') { if (ta.value !== original) msg = 'E37: No write since last change (add ! to override)'; else { root.remove(); resolve(savedText); return; } }
      else if (t === 'q!') { root.remove(); resolve(savedText); return; }
      else if (/^\d+$/.test(t)) { const [s] = lb(Math.min(Number(t), total()) - 1); setPos(s); }
      else if (t === 'set nu' || t === 'set number') msg = '';
      else if (/^%?s\/.*\/.*\/g?$/.test(t)) { const m = /^%?s\/(.*?)\/(.*?)\/(g?)$/.exec(t); try { ta.value = ta.value.split('\n').map((l) => l.replace(new RegExp(m[1], m[3] ? 'g' : ''), m[2])).join('\n'); } catch { msg = 'E486: Pattern not found'; } }
      else msg = `E492: Not an editor command: ${t}`;
      cmdline = null; render();
    }
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (cmdline != null) {
        e.preventDefault();
        if (e.key === 'Enter') runCmd(cmdline);
        else if (e.key === 'Escape') { cmdline = null; render(); }
        else if (e.key === 'Backspace') { if (cmdline === '') cmdline = null; else cmdline = cmdline.slice(0, -1); render(); }
        else if (e.key.length === 1) { cmdline += e.key; render(); }
        return;
      }
      if (insert) {
        if (e.key === 'Escape') { e.preventDefault(); insert = false; setPos(Math.max(0, ta.selectionStart - (ta.value[ta.selectionStart - 1] === '\n' ? 0 : 1))); msg = ''; render(); }
        return;
      }
      if (e.ctrlKey || e.metaKey) return;
      const k = e.key;
      if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(k)) return;
      if (k.startsWith('Arrow') || k === 'Home' || k === 'End') { return; }
      e.preventDefault();
      msg = '';
      const n = cur(); const [s, en] = lb(n); const p = ta.selectionStart;
      const seq = pending + k; pending = '';
      switch (seq) {
        case 'i': insert = true; break;
        case 'a': setPos(Math.min(p + 1, en)); insert = true; break;
        case 'I': setPos(s); insert = true; break;
        case 'A': setPos(en); insert = true; break;
        case 'o': { setPos(en); document.execCommand('insertText', false, '\n'); insert = true; break; }
        case 'O': { setPos(s); document.execCommand('insertText', false, '\n'); setPos(s); insert = true; break; }
        case 'h': setPos(Math.max(s, p - 1)); break;
        case 'l': setPos(Math.min(en, p + 1)); break;
        case 'j': { const [s2, e2] = lb(Math.min(n + 1, total() - 1)); setPos(Math.min(s2 + (p - s), e2)); break; }
        case 'k': { const [s2, e2] = lb(Math.max(n - 1, 0)); setPos(Math.min(s2 + (p - s), e2)); break; }
        case '0': setPos(s); break;
        case '$': setPos(en); break;
        case 'G': setPos(lb(total() - 1)[0]); break;
        case 'gg': setPos(0); break;
        case 'g': case 'd': case 'y': case 'Z': pending = seq; break;
        case 'x': if (p < en) { ta.setSelectionRange(p, p + 1); yank = ta.value[p]; document.execCommand('delete'); } break;
        case 'dd': { yank = ta.value.slice(s, en) + '\n'; ta.setSelectionRange(s, Math.min(en + 1, ta.value.length)); document.execCommand('delete'); break; }
        case 'D': ta.setSelectionRange(p, en); yank = ta.value.slice(p, en); document.execCommand('delete'); break;
        case 'yy': yank = ta.value.slice(s, en) + '\n'; msg = '1 line yanked'; break;
        case 'p': if (yank.endsWith('\n')) { setPos(Math.min(en + 1, ta.value.length)); if (en >= ta.value.length) document.execCommand('insertText', false, '\n' + yank.slice(0, -1)); else { document.execCommand('insertText', false, yank); } } else { setPos(Math.min(p + 1, en)); document.execCommand('insertText', false, yank); } break;
        case 'P': setPos(s); document.execCommand('insertText', false, yank); break;
        case 'u': document.execCommand('undo'); break;
        case 'ZZ': { if (writeOut()) { root.remove(); resolve(savedText); return; } break; }
        case ':': cmdline = ''; break;
        case '/': { const q = window.prompt?.('/') ; if (q) { const i = ta.value.indexOf(q, p + 1); if (i >= 0) setPos(i); else msg = `E486: Pattern not found: ${q}`; } break; }
        default: break;
      }
      render();
    });
    ta.addEventListener('click', () => { if (!insert) render(); });
    ta.addEventListener('keyup', (e) => { e.stopPropagation(); if (cmdline == null) render(); });
    host.append(root);
    msg = opts.readErr ? `"${opts.display}" Permission denied` : opts.isNew ? `"${opts.display ?? ''}" [New]` : `"${opts.display ?? path}" ${total()}L, ${original.length}C`;
    render();
    ta.focus(); ta.setSelectionRange(0, 0); ta.scrollTop = 0;
  });
}
