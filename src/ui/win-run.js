// The Run dialog (Win+R, or right-click Start > Run). Commands go through cmd.exe's own launcher, so
// "secpol.msc", "gpedit.msc", "lusrmgr.msc", "services.msc", "control", "cmd", "powershell", "notepad" ... all work.
import { h } from './dom.js';
import { icon } from './icons.js';
import { createWinShell } from '../win/shell.js';

export function open(env) {
  return env.ui.modal((done) => {
    const inp = h('input', { value: env.settings.lastRun || '', autofocus: true, onkeydown: (e) => { if (e.key === 'Enter') go(); if (e.key === 'Escape') done(false); } });
    const go = async () => {
      const cmd = inp.value.trim(); if (!cmd) return;
      env.settings.lastRun = cmd; env.saveSettings();
      done(true);
      if (/^(cmd|powershell|pwsh|wt)(\.exe)?$/i.test(cmd)) { env.openApp('terminal', { mode: /^cmd/i.test(cmd) ? 'cmd' : 'ps' }); return; }
      let out = '';
      const sh = createWinShell(env.sys, { user: env.user, mode: 'cmd', io: { write: (s) => { out += s; }, readLine: async () => null, launch: (app, o) => env.openApp(app, o), clear() {}, exit() {}, power: (k) => env.power(k), cols: 100 } });
      const word = cmd.split(/\s+/)[0];
      await sh.run(/^[a-z]:\\|^\\\\/i.test(cmd) || /\.(txt|log|ini|html?|pcap)$/i.test(cmd) ? `start "${cmd}"` : /\./.test(word) && !/\.(exe|msc|cpl)$/i.test(word) ? `start ${cmd}` : cmd);
      if (/not recognized|cannot find/i.test(out)) {
        const p = env.sys.vfs && cmd.replace(/^"|"$/g, '');
        const vp = p && /^[a-z]:\\/i.test(p) ? (await import('../win/state.js')).resolve(env.sys, (await import('../win/state.js')).fromWin(p)) : null;
        if (vp && env.sys.vfs.exists(vp)) { env.openPath(vp); return; }
        env.ui.alert({ title: cmd, heading: `Windows cannot find '${cmd}'.`, message: 'Make sure you typed the name correctly, and then try again.', icon: 'w-bad' });
      }
    };
    return h('div', { class: 'wrun', onkeydown: (e) => { if (e.key === 'Escape') done(false); } },
      h('div', { class: 'wd-t', style: { background: '#fff', padding: '8px 12px', display: 'flex', justifyContent: 'space-between' } }, h('span', null, 'Run'), h('span', { onclick: () => done(false) }, '✕')),
      h('div', { class: 'b' }, icon('w-exe', 32), h('div', null, 'Type the name of a program, folder, document, or Internet resource, and Windows will open it for you.')),
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', padding: '0 14px 14px' } }, h('span', null, 'Open:'), inp),
      h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '10px 14px', background: '#f0f0f0' } }, h('button', { class: 'w-btn primary', style: { minWidth: '76px' }, onclick: go }, 'OK'), h('button', { class: 'w-btn', style: { minWidth: '76px' }, onclick: () => done(false) }, 'Cancel'), h('button', { class: 'w-btn', style: { minWidth: '76px' }, disabled: true }, 'Browse...')));
  });
}
