// Minimal window manager: draggable, resizable, minimizable, maximizable windows in #winlayer.
import { h } from './dom.js';
import { icon } from './icons.js';

let seq = 0;

export class WindowManager {
  constructor(layer) {
    this.layer = layer;
    this.wins = [];
    this.z = 10;
    this.listeners = new Set();
    this.cascade = 0;
  }
  onChange(fn) { this.listeners.add(fn); }
  changed() { for (const fn of this.listeners) fn(this.wins); }

  /** opts: { title, icon, width, height, x, y, appId, resizable, minW, minH, onClose, content, noMax } */
  open(opts) {
    const id = ++seq;
    const W = this.layer.clientWidth || 1000; const H = this.layer.clientHeight || 700;
    const width = Math.min(opts.width || 640, W - 10);
    const height = Math.min(opts.height || 440, H - 10);
    const off = (this.cascade++ % 8) * 26;
    const x = opts.x ?? Math.max(0, Math.round((W - width) / 2) - 60 + off);
    const y = opts.y ?? Math.max(0, Math.round((H - height) / 2) - 40 + off);
    const titleEl = h('div', { class: 'tt' }, opts.title || '');
    const btnMin = h('button', { title: 'Minimize', onclick: (e) => { e.stopPropagation(); win.minimize(); } }, '–');
    const btnMax = h('button', { title: 'Maximize', onclick: (e) => { e.stopPropagation(); win.toggleMax(); }, style: opts.noMax ? { display: 'none' } : null }, '□');
    const btnX = h('button', { class: 'x', title: 'Close', onclick: (e) => { e.stopPropagation(); win.close(); } }, '✕');
    const iconEl = icon(opts.icon || 'app', 16);
    const bar = h('div', { class: 'title' }, iconEl, titleEl, h('div', { class: 'wb' }, btnMin, btnMax, btnX));
    const body = h('div', { class: 'content' });
    const el = h('div', { class: 'win' + (opts.cls ? ' ' + opts.cls : '') + (opts.frameless ? ' frameless' : ''), style: { left: x + 'px', top: y + 'px', width: width + 'px', height: height + 'px', minWidth: (opts.minW || 260) + 'px', minHeight: (opts.minH || 120) + 'px' } }, opts.frameless ? null : bar, body);
    if (opts.resizable !== false) for (const d of ['r', 'b', 'br', 'l', 't', 'bl']) el.append(h('div', { class: 'rz ' + d, dataset: { d }, onmousedown: (e) => this.startResize(win, e, d) }));
    const win = {
      id, el, body, appId: opts.appId, title: opts.title || '', iconName: opts.icon || 'app', minimized: false, maximized: false, closed: false, closeHandlers: [], data: {},
      setTitle: (t) => { win.title = t; titleEl.textContent = t; this.changed(); },
      focus: () => this.focus(win),
      minimize: () => { win.minimized = true; el.style.display = 'none'; this.activateTop(); this.changed(); },
      restore: () => { win.minimized = false; el.style.display = ''; this.focus(win); },
      toggleMax: () => this.toggleMax(win),
      close: () => this.close(win),
      onClose: (fn) => win.closeHandlers.push(fn),
      /** For frameless windows: let an app-drawn element act as the title bar (drag, double-click to maximize). */
      makeDraggable: (node) => {
        node.addEventListener('mousedown', (e) => { if (!e.target.closest('button, input, .no-drag')) this.startDrag(win, e); });
        node.addEventListener('dblclick', (e) => { if (!e.target.closest('button, input, .no-drag') && !opts.noMax) win.toggleMax(); });
      },
      /** A fresh set of minimize / maximize / close buttons for an app-drawn title bar. */
      controls: () => h('div', { class: 'wb' },
        h('button', { title: 'Minimize', onclick: (e) => { e.stopPropagation(); win.minimize(); } }, '–'),
        opts.noMax ? null : h('button', { title: 'Maximize', onclick: (e) => { e.stopPropagation(); win.toggleMax(); } }, '□'),
        h('button', { class: 'x', title: 'Close', onclick: (e) => { e.stopPropagation(); win.close(); } }, '✕')),
    };
    if (opts.onClose) win.closeHandlers.push(opts.onClose);
    bar.addEventListener('mousedown', (e) => this.startDrag(win, e));
    bar.addEventListener('dblclick', () => { if (!opts.noMax && opts.resizable !== false) win.toggleMax(); });
    el.addEventListener('mousedown', () => this.focus(win), true);
    this.layer.append(el);
    this.wins.push(win);
    if (opts.content) body.append(opts.content);
    this.focus(win);
    return win;
  }

  focus(win) {
    if (win.closed) return;
    if (win.minimized) { win.minimized = false; win.el.style.display = ''; }
    for (const w of this.wins) w.el.classList.toggle('inactive', w !== win);
    win.el.style.zIndex = ++this.z;
    this.active = win;
    this.changed();
  }
  activateTop() {
    const vis = this.wins.filter((w) => !w.minimized && !w.closed).sort((a, b) => Number(b.el.style.zIndex) - Number(a.el.style.zIndex));
    if (vis[0]) this.focus(vis[0]); else { this.active = null; for (const w of this.wins) w.el.classList.add('inactive'); }
  }
  close(win) {
    if (win.closed) return;
    for (const fn of win.closeHandlers) { try { if (fn() === false) return; } catch (e) { console.error(e); } }
    win.closed = true;
    win.el.remove();
    this.wins = this.wins.filter((w) => w !== win);
    this.activateTop();
    this.changed();
  }
  toggleMax(win) {
    if (win.maximized) {
      Object.assign(win.el.style, win.prev);
      win.el.classList.remove('max');
      win.maximized = false;
    } else {
      win.prev = { left: win.el.style.left, top: win.el.style.top, width: win.el.style.width, height: win.el.style.height };
      Object.assign(win.el.style, { left: '0px', top: '0px', width: this.layer.clientWidth + 'px', height: this.layer.clientHeight + 'px' });
      win.el.classList.add('max');
      win.maximized = true;
    }
    win.el.dispatchEvent(new CustomEvent('wmresize'));
  }
  showDesktop() {
    const all = this.wins.filter((w) => !w.minimized);
    if (all.length) all.forEach((w) => w.minimize()); else this.wins.forEach((w) => w.restore());
  }
  find(appId) { return this.wins.filter((w) => w.appId === appId); }

  startDrag(win, e) {
    if (e.target.closest('.wb') || e.button !== 0) return;
    if (win.maximized) return;
    const sx = e.clientX; const sy = e.clientY; const ox = win.el.offsetLeft; const oy = win.el.offsetTop;
    const move = (ev) => {
      win.el.style.left = ox + ev.clientX - sx + 'px';
      win.el.style.top = Math.max(0, Math.min(this.layer.clientHeight - 30, oy + ev.clientY - sy)) + 'px';
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    e.preventDefault();
  }
  startResize(win, e, d) {
    if (win.maximized) return;
    e.preventDefault(); e.stopPropagation();
    this.focus(win);
    const sx = e.clientX; const sy = e.clientY; const r = { l: win.el.offsetLeft, t: win.el.offsetTop, w: win.el.offsetWidth, h: win.el.offsetHeight };
    const minW = parseInt(win.el.style.minWidth, 10) || 260; const minH = parseInt(win.el.style.minHeight, 10) || 120;
    const move = (ev) => {
      const dx = ev.clientX - sx; const dy = ev.clientY - sy;
      let { l, t, w, h: hh } = r;
      if (d.includes('r')) w = Math.max(minW, r.w + dx);
      if (d.includes('b')) hh = Math.max(minH, r.h + dy);
      if (d.includes('l')) { w = Math.max(minW, r.w - dx); l = r.l + (r.w - w); }
      if (d.includes('t')) { hh = Math.max(minH, r.h - dy); t = r.t + (r.h - hh); }
      Object.assign(win.el.style, { left: l + 'px', top: t + 'px', width: w + 'px', height: hh + 'px' });
      win.el.dispatchEvent(new CustomEvent('wmresize'));
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  }
}
