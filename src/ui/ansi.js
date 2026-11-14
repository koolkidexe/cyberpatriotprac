// Streaming ANSI (SGR) text renderer used by the terminal and any "console" view.
import { h } from './dom.js';

const FG = ['#2e3436', '#cc0000', '#4e9a06', '#c4a000', '#3465a4', '#75507b', '#06989a', '#d3d7cf'];
const FGB = ['#555753', '#ef2929', '#8ae234', '#fce94f', '#729fcf', '#ad7fa8', '#34e2e2', '#eeeeec'];

function color256(n) {
  if (n < 8) return FG[n];
  if (n < 16) return FGB[n - 8];
  if (n < 232) { const i = n - 16; const r = Math.floor(i / 36); const g = Math.floor((i % 36) / 6); const b = i % 6; const f = (v) => (v ? 55 + v * 40 : 0); return `rgb(${f(r)},${f(g)},${f(b)})`; }
  const v = 8 + (n - 232) * 10; return `rgb(${v},${v},${v})`;
}

export class AnsiView {
  constructor(el, { maxLines = 4000 } = {}) {
    this.el = el;
    this.maxLines = maxLines;
    this.style = this.reset();
    this.esc = '';
    this.newLine();
  }
  reset() { return { fg: null, bg: null, bold: false, dim: false, ul: false, inv: false }; }
  clear() { this.el.textContent = ''; this.style = this.reset(); this.newLine(); }
  newLine() {
    this.line = h('div', { class: 'ln' });
    this.col = 0;
    this.el.append(this.line);
    while (this.el.childNodes.length > this.maxLines) this.el.firstChild.remove();
  }
  spanFor() {
    const s = this.style;
    const sp = document.createElement('span');
    let fg = s.fg; let bg = s.bg;
    if (s.inv) { const t = fg; fg = bg || '#2b2b2b'; bg = t || '#e6e6e6'; }
    if (s.bold && fg == null && !s.inv) sp.style.fontWeight = '700';
    if (s.bold) sp.style.fontWeight = '700';
    if (fg) sp.style.color = fg;
    if (bg) sp.style.background = bg;
    if (s.dim) sp.style.opacity = '.7';
    if (s.ul) sp.style.textDecoration = 'underline';
    return sp;
  }
  put(text) {
    if (!text) return;
    const plain = !this.style.fg && !this.style.bg && !this.style.bold && !this.style.dim && !this.style.ul && !this.style.inv;
    const node = plain ? document.createTextNode(text) : Object.assign(this.spanFor(), { textContent: text });
    this.line.append(node);
    this.col += text.length;
  }
  /** Overwrite the current line from column 0 (carriage return semantics). */
  carriage() { this.line.textContent = ''; this.col = 0; }

  write(data) {
    let text = this.esc + data;
    this.esc = '';
    let buf = '';
    const flush = () => { if (buf) { this.put(buf); buf = ''; } };
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '\u001b') {
        const m = /^\u001b\[([0-9;?]*)([A-Za-z])/.exec(text.slice(i, i + 40));
        if (!m) { if (text.length - i < 40 && !/^\u001b\[[0-9;?]*[A-Za-z]/.test(text.slice(i))) { /* incomplete */ if (text.length - i < 12) { flush(); this.esc = text.slice(i); return; } } continue; }
        flush();
        i += m[0].length - 1;
        this.csi(m[1], m[2]);
      } else if (c === '\n') { flush(); this.newLine(); }
      else if (c === '\r') { flush(); if (text[i + 1] === '\n') continue; this.carriage(); }
      else if (c === '\t') { const n = 8 - (this.col + buf.length) % 8; buf += ' '.repeat(n); }
      else if (c === '\b') { flush(); const t = this.line.lastChild; if (t) { if (t.textContent.length > 1) t.textContent = t.textContent.slice(0, -1); else t.remove(); this.col = Math.max(0, this.col - 1); } }
      else if (c === '\u0007') { /* bell */ }
      else buf += c;
    }
    flush();
  }
  csi(params, cmd) {
    const nums = params === '' ? [] : params.replace('?', '').split(';').map((x) => (x === '' ? 0 : Number(x)));
    if (cmd === 'm') {
      const n = nums.length ? nums : [0];
      for (let i = 0; i < n.length; i++) {
        const v = n[i];
        if (v === 0) this.style = this.reset();
        else if (v === 1) this.style.bold = true;
        else if (v === 2) this.style.dim = true;
        else if (v === 4) this.style.ul = true;
        else if (v === 7) this.style.inv = true;
        else if (v === 22) { this.style.bold = false; this.style.dim = false; }
        else if (v === 24) this.style.ul = false;
        else if (v === 27) this.style.inv = false;
        else if (v >= 30 && v <= 37) this.style.fg = this.style.bold ? FGB[v - 30] : FG[v - 30];
        else if (v === 39) this.style.fg = null;
        else if (v >= 40 && v <= 47) this.style.bg = FG[v - 40];
        else if (v === 49) this.style.bg = null;
        else if (v >= 90 && v <= 97) this.style.fg = FGB[v - 90];
        else if (v >= 100 && v <= 107) this.style.bg = FGB[v - 100];
        else if ((v === 38 || v === 48) && n[i + 1] === 5) { const col = color256(n[i + 2] ?? 0); if (v === 38) this.style.fg = col; else this.style.bg = col; i += 2; }
        else if ((v === 38 || v === 48) && n[i + 1] === 2) { const col = `rgb(${n[i + 2]},${n[i + 3]},${n[i + 4]})`; if (v === 38) this.style.fg = col; else this.style.bg = col; i += 4; }
      }
    } else if (cmd === 'J') { if (nums[0] === 2 || nums[0] === 3) this.clear(); }
    else if (cmd === 'H') { /* home: ignored for a scrolling terminal */ }
    else if (cmd === 'K') { /* erase to end of line: nothing to erase when appending */ }
    else if (cmd === 'G') { if ((nums[0] || 1) === 1) this.carriage(); }
  }
}
