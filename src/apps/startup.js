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
  let win;
  const ubBtns = env.os === 'ubuntu' ? h('div', { class: 'gsp-btns' }, h('button', { class: 'btn', title: 'Add a startup program', onclick: () => add() }, 'Add'), h('button', { class: 'btn', title: 'Remove the selected startup program', onclick: () => remove() }, 'Remove'), h('button', { class: 'btn', title: 'Edit the selected startup program', onclick: () => edit() }, 'Edit')) : null;
  if (ubBtns) { const content = h('div', { class: 'app-body' }, h('div', { class: 'gsp-head' }, 'Additional startup programs:'), h('div', { class: 'gsp-row' }, listEl, ubBtns), h('div', { class: 'gsp-foot' }, h('button', { class: 'btn', title: 'Close', onclick: () => win.close() }, 'Close')));
    win = env.wm.open({ title: 'Startup Applications Preferences', icon: 'startup', width: 600, height: 420, appId: 'startup', content }); }
  else win = env.wm.open({ title: 'Startup Applications', icon: 'startup', width: 560, height: 400, appId: 'startup', content: h('div', { class: 'app-body' }, listEl,
    h('div', { class: 'toolbar' }, h('button', { class: 'btn', title: 'Add a startup program', onclick: add }, '＋'), h('button', { class: 'btn', title: 'Remove the selected startup program', onclick: remove }, '－'), h('button', { class: 'btn', title: 'Edit the selected startup program', onclick: edit }, 'Edit'), h('span', { style: { flex: 1 } }), h('button', { class: 'btn', title: 'Run the selected program now', onclick: () => { const it = entries().find((x) => x.n === sel); if (it) env.ui.toast({ title: 'Startup Applications', message: `Started: ${it.e.Exec || it.n}`, kind: 'info' }); } }, 'Run now'))) });
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
        icon(it.e.Icon || 'app', 32),
        h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { style: { fontWeight: 600 } }, it.e.Name || it.n), h('div', { style: { fontSize: '11px', opacity: .8 } }, it.e.Comment || it.e.Exec || ''), h('div', { style: { fontSize: '11px', opacity: .6 } }, `Delay: ${it.e['X-GNOME-Autostart-Delay'] || 'none'} · ${it.mine ? it.path.replace(home, '~') : it.path}`)),
        env.os === 'ubuntu' ? null : h('span', { class: 'sw' + (it.on ? ' on' : ''), title: it.on ? 'Disable this startup program' : 'Enable this startup program', onclick: (e) => { e.stopPropagation(); toggle(it, !it.on); } })));
      if (env.os === 'ubuntu') listEl.lastChild.prepend(h('input', { type: 'checkbox', checked: it.on, title: it.on ? 'Disable this startup program' : 'Enable this startup program', onclick: (e) => e.stopPropagation(), onchange: (e) => toggle(it, e.target.checked) }));
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
