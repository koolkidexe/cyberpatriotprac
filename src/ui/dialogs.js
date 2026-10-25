// Modal dialogs (message, confirm, polkit-style authentication), toasts, context menus and sounds.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import * as users from '../core/users.js';

export class UI {
  constructor({ overlay, toasts, sys }) {
    this.overlay = overlay; this.toasts = toasts; this.sys = sys;
    this.soundOn = true;
    this.queue = [];
    this.busy = false;
    this.menu = null;
    document.addEventListener('mousedown', (e) => { if (this.menu && !this.menu.contains(e.target)) this.closeMenu(); }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.closeMenu(); });
  }
  setSys(sys) { this.sys = sys; }

  // ---------------------------------------------------------------- modal plumbing
  modal(build) {
    return new Promise((resolve) => {
      this.queue.push({ build, resolve });
      this.pump();
    });
  }
  pump() {
    if (this.busy || !this.queue.length) return;
    this.busy = true;
    const { build, resolve } = this.queue.shift();
    clear(this.overlay);
    const done = (v) => { this.overlay.classList.remove('show'); clear(this.overlay); this.busy = false; resolve(v); this.pump(); };
    const dlg = build(done);
    this.overlay.append(dlg);
    this.overlay.classList.add('show');
    const f = dlg.querySelector('[autofocus], input, button.primary');
    if (f) setTimeout(() => f.focus(), 0);
  }

  alert({ title = 'Message', heading, message, icon: ic = 'info', ok = 'OK' }) {
    return this.modal((done) => h('div', { class: 'dlg', onkeydown: (e) => { if (e.key === 'Enter' || e.key === 'Escape') done(true); } },
      h('div', { class: 'dt' }, title),
      h('div', { class: 'db' }, icon(ic, 40), h('div', { class: 'txt' }, heading ? h('h3', null, heading) : null, h('p', null, message))),
      h('div', { class: 'df' }, h('button', { class: 'btn primary', onclick: () => done(true) }, ok))));
  }
  confirm({ title = 'Confirm', heading, message, ok = 'OK', cancel = 'Cancel', danger = false, icon: ic = 'question' }) {
    return this.modal((done) => h('div', { class: 'dlg', onkeydown: (e) => { if (e.key === 'Escape') done(false); } },
      h('div', { class: 'dt' }, title),
      h('div', { class: 'db' }, icon(ic, 40), h('div', { class: 'txt' }, heading ? h('h3', null, heading) : null, h('p', null, message))),
      h('div', { class: 'df' }, h('button', { class: 'btn', onclick: () => done(false) }, cancel), h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => done(true) }, ok))));
  }
  prompt({ title = 'Input', message, value = '', ok = 'OK', password = false }) {
    return this.modal((done) => {
      const inp = h('input', { class: 'in', type: password ? 'password' : 'text', value, style: { width: '100%' }, onkeydown: (e) => { if (e.key === 'Enter') done(inp.value); if (e.key === 'Escape') done(null); } });
      return h('div', { class: 'dlg' }, h('div', { class: 'dt' }, title), h('div', { class: 'db' }, h('div', { class: 'txt' }, h('p', null, message), inp)),
        h('div', { class: 'df' }, h('button', { class: 'btn', onclick: () => done(null) }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => done(inp.value) }, ok)));
    });
  }

  /** polkit-style prompt. Resolves true when an administrator's password was entered correctly. */
  authenticate({ message = 'Authentication is required to perform this action.', action = '', asUser }) {
    const sys = this.sys;
    if (sys.polkitTs?.[asUser] && sys.now() - sys.polkitTs[asUser] < 5 * 60000) return Promise.resolve(true);
    const admins = users.readPasswd(sys).filter((u) => u.uid >= 1000 && u.uid < 65534 && users.isAdmin(sys, u.name) && !/nologin|false/.test(u.shell));
    const mine = admins.find((a) => a.name === asUser) || admins[0];
    return this.modal((done) => {
      let tries = 0;
      const err = h('div', { class: 'err' });
      const pw = h('input', { class: 'in', type: 'password', style: { width: '100%' }, autofocus: true, onkeydown: (e) => { if (e.key === 'Enter') go(); if (e.key === 'Escape') done(false); } });
      const sel = admins.length > 1 ? h('select', { class: 'in', style: { width: '100%', marginBottom: '8px' } }, admins.map((a) => h('option', { value: a.name, selected: a.name === mine?.name }, `${(a.gecos || '').split(',')[0] || a.name} (${a.name})`))) : null;
      const go = () => {
        const who = sel ? sel.value : mine?.name;
        if (who && users.checkPassword(sys, who, pw.value)) {
          sys.polkitTs = sys.polkitTs || {}; sys.polkitTs[asUser || who] = sys.now(); sys.polkitTs[who] = sys.now();
          sys.log('auth.log', 'polkitd(authority=local)', `Operator of unix-session:c2 successfully authenticated as unix-user:${who} to gain TEMPORARY authorization for action ${action || 'org.freedesktop.policykit.exec'} for unix-process:1123:2842 [pkexec] (owned by unix-user:${asUser || who})`);
          done(true);
        } else {
          tries++; pw.value = ''; err.textContent = 'Authentication failed. Please try again.';
          sys.log('auth.log', 'polkit-agent-helper-1', `pam_unix(polkit-1:auth): authentication failure; logname= uid=0 euid=0 tty= ruser=${who} rhost=  user=${who}`);
          pw.focus();
          if (tries >= 3) done(false);
        }
      };
      return h('div', { class: 'dlg' }, h('div', { class: 'dt' }, 'Authenticate'),
        h('div', { class: 'db' }, icon('key', 44), h('div', { class: 'txt' },
          h('h3', null, message), h('p', null, 'An application is attempting to perform an action that requires privileges. Authentication as one of the users below is required to perform this action.'),
          sel || h('p', { style: { margin: '0 0 6px' } }, h('b', null, `${(mine?.gecos || '').split(',')[0] || mine?.name || 'root'} (${mine?.name || 'root'})`)),
          h('label', null, 'Password:'), pw, err)),
        h('div', { class: 'df' }, h('button', { class: 'btn', onclick: () => done(false) }, 'Cancel'), h('button', { class: 'btn primary', onclick: go }, 'Authenticate')));
    });
  }

  // ---------------------------------------------------------------- toasts
  toast({ title, message = '', kind = 'good', icon: ic, ms = 6500 }) {
    const el = h('div', { class: `toast ${kind}`, onclick: () => rm() }, icon(ic || (kind === 'bad' ? 'warn' : kind === 'info' ? 'info' : 'score'), 34), h('div', null, h('div', { class: 'ttl' }, title), h('div', { class: 'msg' }, message)));
    const rm = () => { el.classList.add('out'); setTimeout(() => el.remove(), 380); };
    this.toasts.append(el);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
    setTimeout(rm, ms);
    return el;
  }
  ding(kind = 'good') {
    if (!this.soundOn) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ac = this.ac || new AC();
      const t = this.ac.currentTime;
      const notes = kind === 'bad' ? [330, 247] : [660, 880];
      notes.forEach((f, i) => {
        const o = this.ac.createOscillator(); const g = this.ac.createGain();
        o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t + i * 0.14);
        g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.14 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.14 + 0.5);
        o.connect(g); g.connect(this.ac.destination); o.start(t + i * 0.14); o.stop(t + i * 0.14 + 0.55);
      });
    } catch { /* audio unavailable */ }
  }

  // ---------------------------------------------------------------- context menus
  /** items: [{label, action, disabled}] or 'sep'. */
  showMenu(x, y, items, parent = document.getElementById('screen')) {
    this.closeMenu();
    const m = h('div', { class: 'ctxmenu', style: { left: x + 'px', top: y + 'px' } }, items.map((it) => (it === 'sep' ? h('div', { class: 'sep' }) : h('div', { class: 'it' + (it.disabled ? ' dis' : ''), onclick: () => { this.closeMenu(); it.action?.(); } }, h('span', null, it.label), it.hint ? h('span', { style: { color: '#999' } }, it.hint) : null))));
    parent.append(m);
    const r = m.getBoundingClientRect(); const pr = parent.getBoundingClientRect();
    if (r.right > pr.right) m.style.left = Math.max(0, x - r.width) + 'px';
    if (r.bottom > pr.bottom - 40) m.style.top = Math.max(0, y - r.height) + 'px';
    this.menu = m;
    return m;
  }
  closeMenu() { if (this.menu) { this.menu.remove(); this.menu = null; } }
}
