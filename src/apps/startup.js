// Startup Applications (cinnamon-session-properties).
import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { FsView, FsError } from '../core/vfs.js';
import * as users from '../core/users.js';
import { parseDesktopText } from '../core/desktop-entry.js';

export function open(env) {
  const sys = env.sys;
  const user = env.user;
  const fs = new FsView(sys.vfs, users.credFor(sys, user));
  const home = users.getUser(sys, user).home;
  const dir = `${home}/.config/autostart`;
  const listEl = h('div', { class: 'listbox', style: { flex: 1, margin: '8px' } });
  const win = env.wm.open({ title: 'Startup Applications Preferences', icon: 'startup', width: 560, height: 400, appId: 'startup', content: h('div', { class: 'app-body' }, listEl,
    h('div', { class: 'toolbar' }, h('button', { class: 'btn', onclick: add }, 'Add'), h('button', { class: 'btn', onclick: remove }, 'Remove'), h('button', { class: 'btn', onclick: edit }, 'Edit'))) });
  let sel = null;
  const unsub = sys.on('change', (k) => { if (k === 'fs') draw(); });
  win.onClose(() => unsub());
  const entries = () => {
    const out = [];
    const seen = new Set();
    const scan = (d, mine) => { try { for (const n of fs.readdir(d)) { if (!n.endsWith('.desktop') || seen.has(n)) continue; const path = `${d}/${n}`; const e = parseDesktopText(fs.readFile(path)); seen.add(n); if (e.Hidden === 'true' && !mine) continue; out.push({ n, path, mine, e, on: e['X-GNOME-Autostart-enabled'] !== 'false' && e.Hidden !== 'true' }); } } catch (err) { if (!(err instanceof FsError)) throw err; } };
    scan(dir, true); scan('/etc/xdg/autostart', false);
    return out;
  };
  function draw() {
    if (win.closed) return;
    clear(listEl);
    const es = entries();
    if (sel && !es.some((x) => x.n === sel)) sel = null;
    for (const it of es) {
      listEl.append(h('div', { class: 'li' + (sel === it.n ? ' sel' : ''), onclick: () => { sel = it.n; draw(); } },
        h('input', { type: 'checkbox', checked: it.on, onclick: (e) => e.stopPropagation(), onchange: (e) => toggle(it, e.target.checked) }), icon('app', 24),
        h('div', null, h('div', { style: { fontWeight: 600 } }, it.e.Name || it.n), h('div', { style: { fontSize: '11px', opacity: .8 } }, it.e.Comment || it.e.Exec || ''))));
    }
  }
  function toggle(it, on) {
    try {
      let txt = fs.readFile(it.path);
      txt = /X-GNOME-Autostart-enabled=/.test(txt) ? txt.replace(/X-GNOME-Autostart-enabled=.*/, `X-GNOME-Autostart-enabled=${on}`) : txt.replace(/\n?$/, `\nX-GNOME-Autostart-enabled=${on}\n`);
      if (!it.mine) { if (!fs.exists(dir)) fs.mkdir(dir); fs.writeFile(`${dir}/${it.n}`, txt); } else fs.writeFile(it.path, txt);
    } catch (e) { if (!(e instanceof FsError)) throw e; env.ui.alert({ title: 'Error', heading: 'Error', message: e.text, icon: 'error' }); }
    draw();
  }
  function remove() {
    const it = entries().find((x) => x.n === sel);
    if (!it) return;
    try {
      if (it.mine) fs.unlink(it.path);
      else { if (!fs.exists(dir)) fs.mkdir(dir); fs.writeFile(`${dir}/${it.n}`, `[Desktop Entry]\nHidden=true\n`); }
    } catch (e) { if (!(e instanceof FsError)) throw e; env.ui.alert({ title: 'Error', heading: 'Error', message: e.text, icon: 'error' }); }
    draw();
  }
  async function dlg(init) {
    return env.ui.modal((done) => {
      const nm = h('input', { class: 'in', value: init?.Name || '', style: { width: '100%' } });
      const cmd = h('input', { class: 'in', value: init?.Exec || '', style: { width: '100%' } });
      const cm = h('input', { class: 'in', value: init?.Comment || '', style: { width: '100%' } });
      return h('div', { class: 'dlg' }, h('div', { class: 'dt' }, init ? 'Edit Startup Program' : 'Add Startup Program'), h('div', { class: 'db' }, h('div', { class: 'txt' }, h('div', { class: 'kv', style: { gridTemplateColumns: '90px 1fr' } }, h('div', { class: 'k' }, 'Name:'), nm, h('div', { class: 'k' }, 'Command:'), cmd, h('div', { class: 'k' }, 'Comment:'), cm))),
        h('div', { class: 'df' }, h('button', { class: 'btn', onclick: () => done(null) }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => done({ Name: nm.value, Exec: cmd.value, Comment: cm.value }) }, 'Save')));
    });
  }
  async function add() {
    const r = await dlg(null); if (!r || !r.Name) return;
    try { if (!fs.exists(dir)) fs.mkdir(dir); fs.writeFile(`${dir}/${r.Name.replace(/[^\w.-]+/g, '-').toLowerCase()}.desktop`, `[Desktop Entry]\nType=Application\nExec=${r.Exec}\nHidden=false\nNoDisplay=false\nX-GNOME-Autostart-enabled=true\nName=${r.Name}\nComment=${r.Comment}\n`); } catch (e) { if (!(e instanceof FsError)) throw e; }
    draw();
  }
  async function edit() {
    const it = entries().find((x) => x.n === sel); if (!it) return;
    const r = await dlg(it.e); if (!r) return;
    try { let t = fs.readFile(it.path); for (const k of ['Name', 'Exec', 'Comment']) t = new RegExp(`^${k}=`, 'm').test(t) ? t.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${r[k]}`) : t + `${k}=${r[k]}\n`; if (!it.mine) { if (!fs.exists(dir)) fs.mkdir(dir); fs.writeFile(`${dir}/${it.n}`, t); } else fs.writeFile(it.path, t); } catch (e) { if (!(e instanceof FsError)) throw e; }
    draw();
  }
  draw();
  return win;
}
