// A small window manager: draggable/resizable windows, a taskbar list and focus handling.
import { icon } from './icons.js';

export class WindowManager {
  constructor(desktop, onChange) { this.desktop = desktop; this.wins = []; this.z = 10; this.onChange = onChange; this.n = 0; }
  open({ title, kind = 'generic', width = 640, height = 420, content, onClose, x, y }) {
    const el = document.createElement('div'); el.className = 'win';
    const maxW = this.desktop.clientWidth; const maxH = this.desktop.clientHeight;
    width = Math.min(width, maxW - 10); height = Math.min(height, maxH - 10);
    const off = (this.n++ % 8) * 26;
    el.style.cssText = `width:${width}px;height:${height}px;left:${x ?? Math.max(0, Math.min(60 + off, maxW - width))}px;top:${y ?? Math.max(0, Math.min(30 + off, maxH - height))}px`;
    el.innerHTML = `<div class="titlebar"><div class="t"></div><button class="mn" title="Minimize">–</button><button class="mx" title="Maximize">□</button><button class="x" title="Close">✕</button></div><div class="body"></div><div class="resize"></div>`;
    const w = { el, title, kind, body: el.querySelector('.body'), min: false, max: false, onClose, setTitle: (t) => { w.title = t; el.querySelector('.t').textContent = t; this.onChange(); }, close: () => this.close(w), focus: () => this.focus(w) };
    el.querySelector('.t').textContent = title;
    this.desktop.appendChild(el); this.wins.push(w);
    el.addEventListener('mousedown', () => this.focus(w), true);
    const tb = el.querySelector('.titlebar');
    tb.addEventListener('mousedown', (e) => { if (e.target.tagName === 'BUTTON' || w.max) return; const sx = e.clientX - el.offsetLeft; const sy = e.clientY - el.offsetTop; const mv = (ev) => { el.style.left = Math.max(-width + 80, Math.min(ev.clientX - sx, this.desktop.clientWidth - 80)) + 'px'; el.style.top = Math.max(0, Math.min(ev.clientY - sy, this.desktop.clientHeight - 30)) + 'px'; }; const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); }; addEventListener('mousemove', mv); addEventListener('mouseup', up); });
    tb.addEventListener('dblclick', () => this.toggleMax(w));
    el.querySelector('.mn').onclick = () => this.minimize(w); el.querySelector('.mx').onclick = () => this.toggleMax(w); el.querySelector('.x').onclick = () => this.close(w);
    el.querySelector('.resize').addEventListener('mousedown', (e) => { e.preventDefault(); const sw = el.offsetWidth; const sh = el.offsetHeight; const sx = e.clientX; const sy = e.clientY; const mv = (ev) => { el.style.width = Math.max(260, sw + ev.clientX - sx) + 'px'; el.style.height = Math.max(140, sh + ev.clientY - sy) + 'px'; w.onResize?.(); }; const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); }; addEventListener('mousemove', mv); addEventListener('mouseup', up); });
    if (content) content(w);
    this.focus(w);
    return w;
  }
  toggleMax(w) {
    const el = w.el;
    if (w.max) { Object.assign(el.style, w.saved); el.classList.remove('max'); w.max = false; }
    else { w.saved = { left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height }; Object.assign(el.style, { left: '0px', top: '0px', width: '100%', height: '100%' }); el.classList.add('max'); w.max = true; }
    w.onResize?.();
  }
  minimize(w) { w.min = true; w.el.style.display = 'none'; this.active === w && (this.active = null); this.onChange(); }
  focus(w) {
    if (w.min) { w.min = false; w.el.style.display = ''; }
    this.wins.forEach((x) => x.el.classList.toggle('inactive', x !== w));
    w.el.style.zIndex = ++this.z; this.active = w; this.onChange(); w.onFocus?.();
  }
  close(w) { if (w.onClose && w.onClose() === false) return; w.el.remove(); this.wins = this.wins.filter((x) => x !== w); if (this.active === w) this.active = null; this.onChange(); }
  list() { return this.wins; }
  iconOf(w) { return icon(w.kind); }
}
