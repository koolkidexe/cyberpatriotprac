// What a reboot (or a fresh login) does to the machine: runtime-only changes are lost, configuration is re-applied.
import * as services from './services.js';
import { SYSCTL_DEFAULTS, sysctlFiles, sysctlApply } from './sysctl.js';
import { parseDesktopText } from './desktop-entry.js';
import * as users from './users.js';

export function rebootSystem(sys) {
  // services come up according to their enablement
  for (const name of Object.keys(sys.svcState)) {
    const st = sys.svcState[name];
    try {
      if (st.enabled === 'enabled' && st.active !== 'active') services.startUnit(sys, name);
      else if (st.enabled !== 'enabled' && st.active === 'active') services.stopUnit(sys, name);
    } catch { /* masked units simply stay down */ }
  }
  // kernel parameters go back to defaults, then the config files are applied
  sys.sysctl = { ...SYSCTL_DEFAULTS };
  sysctlApply(sys, sysctlFiles(sys));
  // interactive and stray processes disappear; real services and the desktop session are kept
  for (const p of sys.processes.slice()) {
    if (p.svc || p.ppid === 0 || p.ppid === 2 || p.user === 'root' && !p.respawnId && !p.tty.startsWith('pts')) continue;
    if (p.tty.startsWith('pts') || p.respawnId || p.user !== 'student' && p.user !== 'root') sys.killProc(p.pid);
  }
  sys.sudoTs = {}; sys.polkitTs = {};
  sys.bootTime = sys.now();
  sys.touch('boot');
}

/** Login scripts / autostart entries that start background listeners (the malicious updater in the scenario). */
export function autostartListeners(sys, user) {
  const u = users.getUser(sys, user);
  const out = [];
  if (!u) return out;
  const dir = `${u.home}/.config/autostart`;
  if (!sys.vfs.isDir(dir)) return out;
  for (const n of sys.vfs.readdir(dir)) {
    if (!n.endsWith('.desktop')) continue;
    const d = parseDesktopText(sys.vfs.readFile(`${dir}/${n}`));
    if (d['X-GNOME-Autostart-enabled'] === 'false' || d.Hidden === 'true') continue;
    const exec = (d.Exec || '').split(/\s+/)[0];
    if (!exec || !sys.vfs.isFile(exec)) continue;
    const text = sys.vfs.readFile(exec);
    const m = /nc(?:\.traditional)? -l -p (\d+)(?: -e (\S+))?/.exec(text);
    const delay = /sleep (\d+)/.exec(text);
    if (m) out.push({ port: Number(m[1]), delayMs: (delay ? Number(delay[1]) : 0) * 1000, cmd: `/bin/nc.traditional -l -p ${m[1]}${m[2] ? ` -e ${m[2]}` : ''}`, source: `${dir}/${n}` });
  }
  return out;
}
