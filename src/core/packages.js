// dpkg/apt model: install, remove, purge and upgrade packages, with dependencies, config-file
// retention (the "rc" state) and the services each package ships.
import { PACKAGES, SERVICES } from '../images/catalog.js';
import { compareVersions } from './util.js';
import { CmdError } from './errors.js';
import * as users from './users.js';
import * as services from './services.js';

const elfBytes = (name) => `\u007fELF\u0002\u0001\u0001\u0000[simulated executable: ${name}]\n`;

function pseudoSize(name) {
  let h = 0;
  for (const ch of name) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  return 18000 + (h % 1100000);
}

export const def = (name) => PACKAGES[name] || null;

export function pkgInfo(sys, name) {
  const d = PACKAGES[name];
  if (!d) return null;
  const st = sys.pkgState[name] || { installed: false };
  return { ...d, installed: !!st.installed, version: st.installed ? st.version || d.v : d.v, auto: !!st.auto, config: !!st.config };
}

export const isInstalled = (sys, name) => !!sys.pkgState[name]?.installed;
export const installedVersion = (sys, name) => (isInstalled(sys, name) ? sys.pkgState[name].version || PACKAGES[name]?.v : null);

export function installedNames(sys) {
  return Object.keys(sys.pkgState).filter((n) => sys.pkgState[n].installed).sort();
}

/** Packages with a newer version in the repository than the installed one. */
export function upgradable(sys) {
  const out = [];
  for (const name of installedNames(sys)) {
    const d = PACKAGES[name];
    if (d?.avail && compareVersions(installedVersion(sys, name), d.avail) < 0) out.push({ name, from: installedVersion(sys, name), to: d.avail, size: d.size });
  }
  return out;
}

export function reverseDeps(sys, name) {
  return installedNames(sys).filter((n) => (PACKAGES[n]?.dep || []).includes(name));
}

/** Work out what an install request pulls in. */
export function planInstall(sys, names) {
  const missing = [];
  const toInstall = [];
  const already = [];
  const visit = (n, explicit) => {
    const d = PACKAGES[n];
    if (!d) { if (explicit) missing.push(n); return; }
    if (isInstalled(sys, n)) { if (explicit && !already.includes(n)) already.push(n); return; }
    if (toInstall.includes(n)) return;
    for (const dep of d.dep) visit(dep, false);
    toInstall.push(n);
  };
  for (const n of names) visit(n, true);
  return { missing, toInstall, already };
}

/** Everything that would be removed with these packages (dependents go with them). */
export function planRemove(sys, names) {
  const remove = new Set();
  const notInstalled = [];
  const visit = (n) => {
    if (remove.has(n)) return;
    remove.add(n);
    for (const r of reverseDeps(sys, n)) visit(r);
  };
  for (const n of names) {
    if (!PACKAGES[n] || !isInstalled(sys, n)) {
      // `apt remove` still succeeds for packages that only have leftover config files (state rc)
      notInstalled.push(n);
      continue;
    }
    visit(n);
  }
  const essential = [...remove].filter((n) => PACKAGES[n]?.essential);
  return { remove: [...remove].sort(), notInstalled, essential };
}

/** Packages installed automatically that nothing needs any more. */
export function autoremovable(sys) {
  const out = [];
  for (const n of installedNames(sys)) {
    if (!sys.pkgState[n].auto) continue;
    if (reverseDeps(sys, n).length === 0) out.push(n);
  }
  return out;
}

const POSTINST = {
  vsftpd(sys) {
    if (!users.getUser(sys, 'ftp')) {
      users.userAdd(sys, { name: 'ftp', system: true, gecos: 'ftp daemon,,,', home: '/srv/ftp', shell: '/usr/sbin/nologin', createHome: false });
      sys.vfs.mkdir('/srv/ftp', { parents: true, mode: 0o555, uid: 0, gid: 0 });
    }
  },
  postfix(sys) { if (!users.getUser(sys, 'postfix')) users.userAdd(sys, { name: 'postfix', system: true, home: '/var/spool/postfix', createHome: false }); },
  named(sys) { if (!users.getUser(sys, 'bind')) users.userAdd(sys, { name: 'bind', system: true, home: '/var/cache/bind', createHome: false }); },
  snmpd(sys) { if (!users.getUser(sys, 'Debian-snmp')) users.userAdd(sys, { name: 'Debian-snmp', system: true, home: '/var/lib/snmp', createHome: false }); },
};

const CAT_MAP = {
  Internet: 'Network;', Office: 'Office;', Accessories: 'Utility;', 'System Tools': 'System;Settings;', 'Sound and video': 'AudioVideo;', Graphics: 'Graphics;', Games: 'Game;',
};

/** Contents of /usr/share/applications/NAME.desktop for a GUI package. */
export function desktopEntry(d) {
  const g = d.gui;
  const exec = g.exec || (d.bins[0] ? d.bins[0].split('/').pop() : d.name);
  return `[Desktop Entry]
Name=${g.title}
Comment=${g.summary}
Exec=${exec}
Icon=${g.icon || d.name}
Terminal=false
Type=Application
Categories=${CAT_MAP[g.cat] || 'Utility;'}
X-Package=${d.name}
`;
}

export const desktopPath = (name) => `/usr/share/applications/${name}.desktop`;

function writePkgFile(sys, path, data, mode = 0o644, size) {
  const dir = path.slice(0, path.lastIndexOf('/')) || '/';
  if (!sys.vfs.exists(dir)) sys.vfs.mkdir(dir, { parents: true, mode: 0o755 });
  const node = sys.vfs.writeFile(path, data, { mode, uid: 0, gid: 0, mtime: sys.now() });
  if (size != null) node.size = size;
}

/** Install one package (and mark state). Dependencies must already be handled by the caller. */
export function installPackage(sys, name, { auto = false, boot = false } = {}) {
  const d = PACKAGES[name];
  if (!d) throw new CmdError(`E: Unable to locate package ${name}`, 100);
  if (isInstalled(sys, name)) return;
  for (const bin of d.bins) {
    if (!sys.vfs.exists(bin)) writePkgFile(sys, bin, elfBytes(bin.split('/').pop()), 0o755, pseudoSize(bin));
  }
  for (const [p, data] of Object.entries(d.files)) writePkgFile(sys, p, typeof data === 'function' ? data(sys) : data, 0o644);
  if (d.gui) writePkgFile(sys, desktopPath(name), desktopEntry(d), 0o644);
  for (const [p, data] of Object.entries(d.conf)) {
    if (!sys.vfs.exists(p)) writePkgFile(sys, p, typeof data === 'function' ? data(sys) : data, p === '/etc/sudoers' ? 0o440 : 0o644);
  }
  for (const sname of d.svc) {
    const sd = SERVICES[sname];
    if (!sd) continue;
    writePkgFile(sys, `/lib/systemd/system/${sd.unit}`, unitFileText(sd), 0o644);
  }
  sys.pkgState[name] = { installed: true, version: d.v, auto: !!auto, config: !!Object.keys(d.conf).length };
  POSTINST[name]?.(sys);
  if (!boot) {
    for (const sname of d.svc) services.registerUnit(sys, sname, { start: true });
  }
  sys.touch('packages');
}

export function unitFileText(sd) {
  return `[Unit]
Description=${sd.desc}
After=network.target

[Service]
Type=${sd.type === 'oneshot' ? 'oneshot' : 'simple'}
ExecStart=${sd.execPath || sd.exec}
${sd.type === 'oneshot' ? 'RemainAfterExit=yes\n' : 'Restart=on-failure\n'}
[Install]
WantedBy=multi-user.target
`;
}

export function removePackage(sys, name, { purge = false } = {}) {
  const d = PACKAGES[name];
  const st = sys.pkgState[name];
  if (!d) throw new CmdError(`E: Unable to locate package ${name}`, 100);
  if (st?.installed) {
    for (const sname of d.svc) services.unregisterUnit(sys, sname);
    for (const bin of d.bins) if (sys.vfs.exists(bin)) sys.vfs.unlink(bin);
    for (const p of Object.keys(d.files)) if (sys.vfs.exists(p)) sys.vfs.unlink(p);
    if (d.gui && sys.vfs.exists(desktopPath(name))) sys.vfs.unlink(desktopPath(name));
    for (const sname of d.svc) {
      const sd = SERVICES[sname];
      const up = `/lib/systemd/system/${sd?.unit}`;
      if (sd && sys.vfs.exists(up)) sys.vfs.unlink(up);
    }
    st.installed = false;
  }
  if (purge || !Object.keys(d.conf).length) {
    for (const p of Object.keys(d.conf)) if (sys.vfs.exists(p)) sys.vfs.unlink(p);
    if (st) st.config = false;
  }
  sys.touch('packages');
}

export function upgradePackage(sys, name) {
  const d = PACKAGES[name];
  const st = sys.pkgState[name];
  if (!d || !st?.installed || !d.avail) return false;
  st.version = d.avail;
  sys.touch('packages');
  // restarting a service on upgrade (postinst) leaves it running
  return true;
}

/** dpkg status letter pair: 'ii' installed, 'rc' removed with config left. */
export function dpkgState(sys, name) {
  const st = sys.pkgState[name];
  if (st?.installed) return 'ii';
  if (st?.config) return 'rc';
  return null;
}

export function installedSizeKb(sys) {
  return installedNames(sys).reduce((a, n) => a + (PACKAGES[n]?.size || 0), 0);
}

export function searchPackages(term) {
  const t = term.toLowerCase();
  return Object.values(PACKAGES).filter((p) => p.name.includes(t) || p.d.toLowerCase().includes(t)).sort((a, b) => (a.name < b.name ? -1 : 1));
}
