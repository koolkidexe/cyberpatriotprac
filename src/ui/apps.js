// GUI applications: Firefox-style viewer, Text Editor (xed), Files (nemo) and "not simulated yet" placeholders.
import { icon, kindFor } from './icons.js';
import { FsView } from '../core/vfs.js';
import * as users from '../core/users.js';
import { posix } from '../core/util.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fsOf = (app, user) => new FsView(app.sys.vfs, users.credFor(app.sys, user));

export function parseDesktop(text) {
  const o = {}; for (const l of text.split('\n')) { const m = /^([A-Za-z-]+)=(.*)$/.exec(l); if (m && !(m[1] in o)) o[m[1]] = m[2]; } return o;
}

// ------------------------------------------------------------------ Firefox-style window
export function openBrowser(app, wm, { url = 'sim://scoring-report', user = 'student' } = {}) {
  return wm.open({ title: 'Mozilla Firefox', kind: 'browser', width: 820, height: 540, content: (w) => {
    w.body.classList.add('browser');
    w.body.innerHTML = `<div class="tb"><button class="btn" data-a="reload">⟳</button><input type="text"><button class="btn" data-a="go">Go</button></div><iframe sandbox="allow-same-origin"></iframe>`;
    const input = w.body.querySelector('input'); const frame = w.body.querySelector('iframe'); let cur = url;
    const render = () => {
      let html; input.value = cur; const fs = fsOf(app, user);
      if (cur === 'sim://scoring-report') { html = app.engine.reportHtml(); w.setTitle('Scoring Report — Mozilla Firefox'); }
      else if (/^file:\/\//.test(cur) || cur.startsWith('/')) {
        const p = cur.replace(/^file:\/\//, '');
        try { const t = fs.readFile(p); html = /\.html?$/.test(p) ? t : `<pre>${esc(t)}</pre>`; w.setTitle(`${posix.basename(p)} — Mozilla Firefox`); }
        catch (e) { html = `<h2>${e.code === 'ENOENT' ? 'File not found' : 'Access denied'}</h2><p>Firefox can’t open ${esc(p)}: ${esc(e.text || e.message)}.</p>`; w.setTitle('Problem loading page'); }
      } else if (/localhost|127\.0\.0\.1/.test(cur)) {
        const port = Number((/:(\d+)/.exec(cur) || [0, 80])[1]); const open = app.sys.sockets().some((s) => s.port === port);
        html = open ? `<h2>Directory listing for /</h2><hr><p>(simulated page served on port ${port})</p>` : `<h2>Unable to connect</h2><p>Firefox can’t establish a connection to the server at ${esc(cur)}.</p>`;
      } else html = `<h2>Server not found</h2><p>Firefox can’t find the server at ${esc(cur)}.</p><p>This simulated computer has no internet access.</p>`;
      frame.srcdoc = html;
    };
    w.body.querySelector('[data-a=reload]').onclick = render;
    w.body.querySelector('[data-a=go]').onclick = () => { cur = input.value.trim(); render(); };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { cur = input.value.trim(); render(); } });
    w.navigate = (u) => { cur = u; render(); };
    if (url === 'sim://scoring-report') { const off = app.engine.on('update', () => { if (cur === 'sim://scoring-report') render(); }); w.onClose = () => { off(); return true; }; }
    render();
  } });
}

// ------------------------------------------------------------------ Text Editor (xed)
export function openEditor(app, wm, { path = null, user = 'student' } = {}) {
  return wm.open({ title: path ? `${posix.basename(path)} — Text Editor` : 'Unsaved Document — Text Editor', kind: 'editor', width: 640, height: 440, content: (w) => {
    const fs = fsOf(app, user); let text = ''; let readOnly = false; let msg = '';
    if (path) {
      try { text = fs.readFile(path); } catch (e) { text = ''; msg = `Could not open ${path}: ${e.text || e.message}`; readOnly = true; }
      if (!msg) { try { const st = fs.stat(path); const c = users.credFor(app.sys, user); const can = c.uid === 0 || (st.uid === c.uid ? st.mode & 0o200 : c.gids.includes(st.gid) ? st.mode & 0o020 : st.mode & 0o002); if (!can) { readOnly = true; msg = 'Read-only: you do not have permission to modify this file. (Run it with sudo to edit system files.)'; } } catch { /* new */ } }
    }
    w.body.classList.add('xed');
    w.body.innerHTML = `<div class="tb"><button class="btn" data-a="save">Save</button><span class="grow" style="flex:1"></span><span>${esc(path || 'New file')}</span></div><textarea spellcheck="false"></textarea><div class="status"></div>`;
    const ta = w.body.querySelector('textarea'); const st = w.body.querySelector('.status'); ta.value = text; ta.readOnly = readOnly; st.textContent = msg;
    const save = () => {
      if (!path) { st.textContent = 'Save as… is not available; open a file from Files or the terminal.'; return; }
      try { fs.writeFile(path, ta.value, { mode: 0o644 }); st.textContent = `Saved ${path}`; app.sys.touch('edit'); }
      catch (e) { st.textContent = `Could not save the file ${path}: ${e.text || e.message}`; }
    };
    w.body.querySelector('[data-a=save]').onclick = save;
    ta.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.ctrlKey && e.key === 's') { e.preventDefault(); save(); } });
    w.onFocus = () => ta.focus(); setTimeout(() => ta.focus(), 0);
  } });
}

// ------------------------------------------------------------------ Files (nemo)
export function openFiles(app, wm, { path, user = 'student' } = {}) {
  return wm.open({ title: 'Files', kind: 'files', width: 680, height: 460, content: (w) => {
    const fs = fsOf(app, user); const home = users.getUser(app.sys, user)?.home || '/'; let cur = path || home;
    w.body.innerHTML = `<div class="tb"><button class="btn" data-a="up">↑</button><button class="btn" data-a="home">⌂</button><input type="text"></div><div class="files"></div><div class="status"></div>`;
    const input = w.body.querySelector('input'); const box = w.body.querySelector('.files'); const st = w.body.querySelector('.status'); let showHidden = false;
    const go = (p) => {
      let names; try { names = fs.readdir(p); } catch (e) { st.textContent = `Could not display “${p}”: ${e.text || e.message}`; return; }
      cur = p; input.value = p; w.setTitle(posix.basename(p) || '/'); box.innerHTML = '';
      names = names.filter((n) => showHidden || !n.startsWith('.')).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      for (const n of names) {
        const fp = posix.join(p, n); let stt; try { stt = fs.lstat(fp); } catch { continue; }
        const isDir = stt.type === 'dir' || (stt.type === 'link' && app.sys.vfs.isDir(fp));
        const it = document.createElement('div'); it.className = 'it'; it.innerHTML = `<img src="${icon(isDir ? 'folder' : /\.desktop$/.test(n) ? 'generic' : 'file')}"><div>${esc(n)}</div>`;
        it.onclick = () => { box.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel')); it.classList.add('sel'); st.textContent = `“${n}” selected${isDir ? '' : ` (${stt.size} bytes)`}`; };
        it.ondblclick = () => (isDir ? go(fp) : app.openPath(fp, user));
        box.appendChild(it);
      }
      st.textContent = `${names.length} items`;
    };
    w.body.querySelector('[data-a=up]').onclick = () => go(posix.dirname(cur)); w.body.querySelector('[data-a=home]').onclick = () => go(home);
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') go(input.value); });
    box.addEventListener('contextmenu', (e) => { e.preventDefault(); showHidden = !showHidden; go(cur); });
    const off = app.sys.on('change', () => { if (document.body.contains(w.el)) go(cur); }); w.onClose = () => { off(); return true; };
    go(cur);
  } });
}

// ------------------------------------------------------------------ placeholders for apps that are planned but not simulated yet
const PLANNED = {
  'Users and Groups': 'The GUI user manager is planned. Use the terminal: <code>sudo userdel</code>, <code>sudo usermod -aG</code>, <code>sudo gpasswd -d user sudo</code>, <code>sudo passwd</code>.',
  'Firewall Configuration': 'The GUFW firewall window is planned. Use the terminal: <code>sudo ufw enable</code>, <code>sudo ufw status verbose</code>.',
  'Update Manager': 'The Update Manager window is planned. Use the terminal: <code>sudo apt update</code>, <code>sudo apt upgrade</code>.',
  'Software Manager': 'The Software Manager window is planned. Use the terminal: <code>sudo apt remove --purge &lt;package&gt;</code>.',
  'Login Window': 'The Login Window settings are planned. Edit <code>/etc/lightdm/lightdm.conf.d/</code> from the terminal.',
  'Startup Applications': 'The Startup Applications window is planned. Look in <code>~/.config/autostart</code> and <code>/etc/xdg/autostart</code>.',
  'System Monitor': 'The System Monitor window is planned. Use <code>ps aux</code>, <code>top -bn1</code> and <code>ss -tulpn</code>.',
};
export function openPlanned(app, wm, name) {
  const key = Object.keys(PLANNED).find((k) => name.toLowerCase().includes(k.toLowerCase().split(' ')[0])) || name;
  return wm.open({ title: name, kind: kindFor(name.toLowerCase()), width: 460, height: 260, content: (w) => { w.body.innerHTML = `<div class="stub"><h3>${esc(name)}</h3><p>This graphical tool is not part of the simulator yet.</p><p>${PLANNED[key] || 'Use the terminal instead.'}</p></div>`; } });
}
