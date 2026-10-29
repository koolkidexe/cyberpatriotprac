// Software Manager (mintinstall, Mint) and Ubuntu Software (gnome-software, Ubuntu): home page with categories,
// search, per-package icons, a details page and Install / Remove that go through the same apt model as the terminal.
import { h, clear } from '../ui/dom.js';
import { icon, iconSvg } from '../ui/icons.js';
import * as pk from '../core/packages.js';

const CATS = [
  ['Accessories', 'cat-accessories', (d) => /^(utils|text)$/.test(d.s) && !!d.gui],
  ['Graphics', 'cat-graphics', (d) => d.s === 'graphics'],
  ['Internet', 'cat-internet', (d) => /^(web|net|mail|httpd)$/.test(d.s)],
  ['Office', 'cat-office', (d) => /office|libreoffice/.test(d.name)],
  ['Sound and video', 'cat-sound-video', (d) => /^(sound|video)$/.test(d.s)],
  ['Programming', 'terminal', (d) => /^(devel|python|editors|vcs)$/.test(d.s)],
  ['Games', 'cat-sound-video', (d) => d.s === 'games'],
  ['System tools', 'cat-admin', (d) => /^(admin|utils)$/.test(d.s)],
];
const KNOWN = {
  firefox: 'firefox', chromium: 'chromium', thunderbird: 'thunderbird', 'gnome-terminal': 'terminal', xed: 'xed', gedit: 'gedit', nemo: 'folder', nautilus: 'folder', gufw: 'shield', ufw: 'shield',
  'libreoffice-writer': 'lo-writer', 'libreoffice-calc': 'lo-calc', 'libreoffice-impress': 'lo-impress', rhythmbox: 'rhythmbox', 'gnome-calculator': 'calc', 'mintupdate': 'update', 'update-manager': 'update', 'mintinstall': 'software',
  'gnome-software': 'ubuntu-software', 'gnome-system-monitor': 'pulse', clamav: 'shield', fail2ban: 'shield', auditd: 'shield', lynis: 'shield', rkhunter: 'shield', chkrootkit: 'shield', 'unattended-upgrades': 'update',
};
const PALETTE = ['#e0533d', '#d98a1d', '#c9b11a', '#4aa84f', '#2e9d8f', '#2f87c9', '#5b63c7', '#9452c2', '#c24d8f', '#6b7a82'];
function letterTile(name, size) {
  let n = 0; for (const c of name) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  const col = PALETTE[n % PALETTE.length];
  const s = document.createElement('span');
  s.className = 'ico sw-letter'; s.style.width = s.style.height = size + 'px';
  s.innerHTML = `<svg viewBox="0 0 48 48" width="${size}" height="${size}"><rect x="3" y="3" width="42" height="42" rx="10" fill="${col}"/><text x="24" y="32" text-anchor="middle" font-family="sans-serif" font-size="22" font-weight="700" fill="#fff">${name.replace(/^(lib|python3-|gnome-)/, '')[0].toUpperCase()}</text></svg>`;
  return s;
}
/** Icon for a package: its app icon when there is one, otherwise a coloured letter tile (like a missing icon in the real store). */
export function pkgIcon(d, size) {
  const k = KNOWN[d.name];
  if (k) return icon(k, size);
  if (d.s === 'games') return icon('cat-sound-video', size);
  if (/john|hydra|ophcrack|nmap|wireshark|tcpdump/.test(d.name)) return letterTile(d.name, size);
  return letterTile(d.name, size);
}
void iconSvg;

export function open(env) {
  const sys = env.sys;
  const ub = env.os === 'ubuntu';
  const brand = ub ? 'Ubuntu Software' : 'Software Manager';
  let page = { kind: 'home' };
  const back = [];
  const out = h('div', { class: 'sw-out scroll' });
  const q = h('input', { class: 'in sw-q', placeholder: ub ? 'Search for apps' : 'Search', title: 'Search all packages by name or description', oninput: () => { if (q.value.trim().length >= 2) go({ kind: 'search', term: q.value.trim() }, true); else if (!q.value.trim() && page.kind === 'search') go({ kind: 'home' }, true); } });
  const backBtn = h('button', { class: 'btn sw-back', title: 'Back', onclick: () => { if (back.length) { page = back.pop(); draw(); } } }, '←');
  let tabs = null;
  if (ub) tabs = h('div', { class: 'sw-tabs' }, [['Explore', 'home'], ['Installed', 'installed'], ['Updates', 'updates']].map(([l, k]) => h('button', { class: 'sw-tab', dataset: { k }, title: l, onclick: () => go({ kind: k }) }, l)));
  const bar = ub ? h('div', { class: 'gh-bar sw-bar' }, backBtn, h('div', { style: { flex: 1 } }), tabs, h('div', { style: { flex: 1 } }), q)
    : h('div', { class: 'toolbar sw-bar' }, backBtn, h('button', { class: 'btn', title: 'Show installed applications', onclick: () => go({ kind: 'installed' }) }, 'Installed'), h('div', { style: { flex: 1 } }), q);
  const content = h('div', { class: 'app-body swm' + (ub ? ' sw-ub' : ' sw-mint') }, bar, out);
  const win = env.wm.open({ title: brand, icon: ub ? 'ubuntu-software' : 'software', width: 900, height: 620, appId: 'software', content, frameless: ub });
  if (ub) { bar.append(win.controls()); win.makeDraggable(bar); }
  const unsub = sys.on('change', (k) => { if (k === 'packages') draw(); });
  win.onClose(() => unsub());

  function go(p, replace) { if (!replace) back.push(page); page = p; draw(); }
  const card = (d) => {
    const inst = pk.isInstalled(sys, d.name);
    return h('div', { class: 'sw-card', title: `Show details for ${d.gui?.title || d.name}`, onclick: () => go({ kind: 'pkg', name: d.name }) }, pkgIcon(d, 48),
      h('div', { class: 'sw-cinfo' }, h('div', { class: 'sw-cname' }, d.gui?.title || d.name), h('div', { class: 'sw-csum' }, d.gui?.summary || d.d)), inst ? h('span', { class: 'sw-inst', title: 'Installed' }, '✔') : null);
  };
  function list(title, pkgs, note) {
    out.append(...[h('h2', { class: 'sw-h' }, title), note ? h('div', { class: 'sw-note' }, note) : null,
      pkgs.length ? h('div', { class: 'sw-grid' }, pkgs.slice(0, 150).map(card)) : h('div', { class: 'sw-note' }, 'No applications found.')].filter(Boolean));
  }
  function draw() {
    if (win.closed) return;
    clear(out);
    backBtn.disabled = !back.length;
    if (tabs) for (const b of tabs.children) b.classList.toggle('on', b.dataset.k === page.kind);
    const all = Object.values(pk.PACKAGES || {}).length ? Object.values(pk.PACKAGES) : pk.searchPackages('');
    const visible = all.filter((d) => !d.missing && (d.gui || pk.isInstalled(sys, d.name) || d.s !== 'libs'));
    if (page.kind === 'home') {
      const feat = all.find((d) => d.name === 'gufw') || all.find((d) => d.gui);
      out.append(h('div', { class: 'sw-banner', title: 'Featured application', onclick: () => go({ kind: 'pkg', name: feat.name }) }, pkgIcon(feat, 72), h('div', null, h('div', { class: 'sw-btitle' }, feat.gui?.title || feat.name), h('div', null, feat.gui?.summary || feat.d))));
      out.append(h('h2', { class: 'sw-h' }, 'Categories'), h('div', { class: 'sw-cats' }, CATS.map(([n, ic, f]) => h('div', { class: 'sw-cat', title: `Browse ${n}`, onclick: () => go({ kind: 'cat', name: n }) }, icon(ic, 32), h('span', null, n))),
        h('div', { class: 'sw-cat', title: 'Show everything that is installed', onclick: () => go({ kind: 'installed' }) }, icon('app', 32), h('span', null, 'Installed applications'))));
      list(ub ? 'Editor’s Picks' : 'Top Rated', visible.filter((d) => d.gui).slice(0, 12));
    } else if (page.kind === 'cat') {
      const f = CATS.find((c) => c[0] === page.name)[2];
      list(page.name, visible.filter(f));
    } else if (page.kind === 'installed') {
      list('Installed applications', pk.installedNames(sys).map((n) => pk.def(n)).filter((d) => d && (d.gui || d.svc?.length || /admin|net|games|utils|web|httpd/.test(d.s))), 'Packages with a desktop app, a service or a tool. Use apt list --installed for everything.');
    } else if (page.kind === 'updates') {
      const ups = pk.upgradable(sys);
      out.append(h('h2', { class: 'sw-h' }, 'Updates'), h('div', { class: 'sw-note' }, ups.length ? `${ups.length} updates are available. They are installed with Software Updater.` : 'Software is up to date'),
        ...(ups.length ? [h('button', { class: 'btn primary', title: 'Open Software Updater', onclick: () => env.openApp('update') }, 'Open Software Updater')] : []));
    } else if (page.kind === 'search') {
      list(`Results for “${page.term}”`, pk.searchPackages(page.term).filter((d) => !d.missing));
    } else if (page.kind === 'pkg') {
      const d = pk.def(page.name);
      const inst = pk.isInstalled(sys, d.name);
      out.append(h('div', { class: 'sw-detail' }, pkgIcon(d, 96), h('div', { class: 'sw-dinfo' }, h('h1', null, d.gui?.title || d.name), h('div', { class: 'sw-csum' }, d.gui?.summary || d.d),
        h('div', { class: 'sw-dbtns' }, inst ? [h('button', { class: 'btn danger', title: `Remove ${d.name}`, onclick: () => act(d, true) }, 'Remove'), d.gui ? h('button', { class: 'btn', title: 'Launch', onclick: () => env.openApp(d.name === 'firefox' || d.name === 'chromium' ? d.name : 'generic', { title: d.gui.title }) }, 'Launch') : null]
          : h('button', { class: 'btn primary', title: `Install ${d.name}`, onclick: () => act(d, false) }, 'Install')))),
      h('div', { class: 'sw-meta' }, [['Package', d.name], ['Version', pk.installedVersion(sys, d.name) || d.v], ['Size', `${d.size} kB`], ['Section', d.s], ['Status', inst ? 'Installed' : 'Not installed']].map(([a, b]) => h('div', null, h('span', null, a), h('b', null, b)))),
      h('p', { class: 'sw-desc' }, d.d));
    }
  }
  async function act(d, inst) {
    const ok = await env.ui.authenticate({ message: `Authentication is required to ${inst ? 'remove' : 'install'} software`, action: ub ? 'org.debian.apt.install-or-remove-packages' : 'com.linuxmint.mintinstall', asUser: env.user });
    if (!ok) return;
    if (inst) {
      const plan = pk.planRemove(sys, [d.name]);
      if (plan.essential.length) { env.ui.alert({ title: brand, heading: 'Cannot remove', message: `${plan.essential.join(', ')} is essential and cannot be removed.`, icon: 'error' }); return; }
      const all = plan.remove;
      const go2 = await env.ui.confirm({ title: brand, heading: all.length > 1 ? 'The following packages will be removed' : `Remove ${d.gui?.title || d.name}?`, message: all.join(', '), ok: 'Remove', danger: true });
      if (!go2) return;
      for (const n of all) pk.removePackage(sys, n);
      env.ui.toast({ title: brand, message: `${d.name} was removed.`, kind: 'info' });
    } else {
      const plan = pk.planInstall(sys, [d.name]);
      for (const n of plan.toInstall) pk.installPackage(sys, n);
      env.ui.toast({ title: brand, message: `${d.name} was installed.`, kind: 'info' });
    }
    draw();
  }
  draw();
  return win;
}
