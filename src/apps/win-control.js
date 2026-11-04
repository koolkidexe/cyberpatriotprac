// Classic Control Panel pages: the Category view, Windows Defender Firewall (with "Turn on or off"), Programs and
// Features, System Properties (Remote tab) and "Turn Windows features on or off".
import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { elevate } from '../ui/win-shell.js';
import { sheet } from './win-mmc.js';
import * as S from '../win/state.js';

const admin = (env, opts, what) => (opts.elevated ? Promise.resolve(true) : elevate(env, { what }));
const RA = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Remote Assistance';

export function open(env, opts = {}) {
  const a = opts.app;
  if (a === 'sysdm') return sysdm(env, opts);
  if (a === 'features') return features(env, opts);
  return controlPanel(env, opts, a === 'firewall' ? 'firewall' : a === 'programs' ? 'programs' : 'home');
}

function controlPanel(env, opts, start) {
  const sys = env.sys;
  let page = start; let sub = null;
  const side = h('div', { class: 'wcp-side' });
  const body = h('div', { class: 'wcp' });
  const addr = h('div', { class: 'path' });
  const root = h('div', { class: 'wapp', style: { background: '#fff' } }, h('div', { class: 'wcp-addr' }, h('button', { class: 'w-btn', style: { minHeight: '26px', padding: '0 8px' }, title: 'Back', onclick: () => { if (sub) sub = null; else page = 'home'; render(); } }, '←'), addr), h('div', { class: 'w-split' }, side, body));
  const titles = { home: 'Control Panel', firewall: 'Windows Defender Firewall', programs: 'Programs and Features' };
  const win = env.wm.open({ title: titles[page], icon: page === 'firewall' ? 'w-firewall' : page === 'programs' ? 'w-programs' : 'w-control', width: 980, height: 620, appId: 'control', content: root });
  const link = (t, fn, title) => h('a', { title: title || t, onclick: fn }, t);
  function render() {
    clear(side); clear(body); clear(addr);
    addr.append(icon('w-control', 16), 'Control Panel', page !== 'home' ? ` › ${page === 'firewall' ? 'System and Security › Windows Defender Firewall' : 'Programs › Programs and Features'}` : '', sub === 'onoff' ? ' › Customize Settings' : '');
    win.setTitle(sub === 'onoff' ? 'Customize Settings' : titles[page]);
    ({ home, firewall, programs }[page])();
  }
  function home() {
    side.style.display = 'none';
    const item = (ic, t, links, fn) => h('div', { class: 'cpi' }, icon(ic, 44), h('div', null, h('a', { onclick: fn, title: t }, t), h('div', { class: 'lnks' }, links.map(([l, f]) => h('a', { onclick: f, title: l }, l)))));
    body.append(h('h2', null, 'Adjust your computer\'s settings'), h('div', { class: 'cpg' },
      item('w-security', 'System and Security', [['Review your computer\'s status', () => env.openApp('security')], ['Windows Defender Firewall', () => { page = 'firewall'; render(); }], ['Allow remote access', () => env.openApp('sysdm')], ['Administrative Tools', () => env.openApp('compmgmt')]], () => { page = 'firewall'; render(); }),
      item('w-users', 'User Accounts', [['Change account type', () => env.openApp('settings', { page: 'accounts' })], ['Manage another account', () => env.openApp('lusrmgr')]], () => env.openApp('lusrmgr')),
      item('w-network', 'Network and Internet', [['View network status and tasks', () => env.openApp('settings', { page: 'network' })]], () => env.openApp('settings', { page: 'network' })),
      item('w-image', 'Appearance and Personalization', [], () => env.openApp('settings', { page: 'personalization' })),
      item('w-programs', 'Programs', [['Uninstall a program', () => { page = 'programs'; render(); }], ['Turn Windows features on or off', () => env.openApp('features')]], () => { page = 'programs'; render(); }),
      item('w-taskschd', 'Clock and Region', [['Change date, time, or number formats', () => env.openApp('settings', { page: 'time' })]], () => env.openApp('settings', { page: 'time' }))));
  }
  function firewall() {
    side.style.display = '';
    side.append(link('Control Panel Home', () => { page = 'home'; render(); }), link('Allow an app or feature through Windows Defender Firewall', () => fwRules()), link('Change notification settings', () => { sub = 'onoff'; render(); }), link('🛡 Turn Windows Defender Firewall on or off', () => { sub = 'onoff'; render(); }), link('🛡 Restore defaults', async () => { if (!(await admin(env, opts, 'Windows Defender Firewall'))) return; S.setFirewall(sys, ['Domain', 'Private', 'Public'], true); render(); }), link('Advanced settings', () => env.openApp('secpol', { node: 'fw' })), link('Troubleshoot my network', () => {}));
    const fw = sys.win.firewall;
    if (sub === 'onoff') {
      const radios = {};
      body.append(h('h2', null, 'Customize settings for each type of network'), h('p', null, 'You can modify the firewall settings for each type of network that you use.'));
      for (const k of ['Domain', 'Private', 'Public']) {
        const on = h('input', { type: 'radio', name: `fw-${k}`, checked: fw[k].enabled }); const off = h('input', { type: 'radio', name: `fw-${k}`, checked: !fw[k].enabled });
        radios[k] = on;
        body.append(h('fieldset', { style: { border: 0, margin: '16px 0', padding: 0 } }, h('h3', { style: { fontWeight: 400, color: '#1e3287', fontSize: '15px', margin: '0 0 8px' } }, `${k} network settings`),
          h('label', { style: { display: 'flex', gap: '8px', margin: '4px 0 4px 40px' } }, on, icon('w-ok', 18), 'Turn on Windows Defender Firewall'),
          h('label', { style: { display: 'flex', gap: '8px', margin: '4px 0 4px 40px' } }, off, icon('w-bad', 18), 'Turn off Windows Defender Firewall (not recommended)')));
      }
      body.append(h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '20px' } }, h('button', { class: 'w-btn primary', onclick: async () => {
        if (!(await admin(env, opts, 'Windows Defender Firewall'))) return;
        for (const k of Object.keys(radios)) S.setFirewall(sys, [k], radios[k].checked);
        sub = null; render();
      } }, 'OK'), h('button', { class: 'w-btn', onclick: () => { sub = null; render(); } }, 'Cancel')));
      return;
    }
    body.append(h('h2', null, 'Help protect your PC with Windows Defender Firewall'), h('p', null, 'Windows Defender Firewall can help prevent hackers or malicious software from gaining access to your PC through the Internet or a network.'));
    for (const [k, label] of [['Private', 'Private networks'], ['Public', 'Guest or public networks'], ['Domain', 'Domain networks']]) {
      const on = fw[k].enabled;
      body.append(h('div', { style: { border: '1px solid #ccd', margin: '10px 0', borderRadius: '2px' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: on ? '#e8f5e9' : '#fdecea', fontSize: '15px' } }, icon(on ? 'w-ok' : 'w-bad', 22), h('b', { style: { fontWeight: 400, flex: 1 } }, label), h('span', null, k === 'Private' ? 'Connected' : 'Not connected')),
        h('table', { style: { margin: '8px 20px', fontSize: '12px', borderSpacing: '10px 4px' } }, h('tr', null, h('td', null, 'Windows Defender Firewall state:'), h('td', null, on ? 'On' : 'Off')), h('tr', null, h('td', null, 'Incoming connections:'), h('td', null, 'Block all connections to apps that are not on the list of allowed apps')), h('tr', null, h('td', null, 'Notification state:'), h('td', null, 'Notify me when Windows Defender Firewall blocks a new app')))));
    }
  }
  async function fwRules() {
    const rules = sys.win.fwRules;
    await env.ui.modal((done) => {
      const box = h('div', { style: { maxHeight: '300px', overflow: 'auto', border: '1px solid #ccc' } });
      const draw = () => { clear(box); if (!rules.length) box.append(h('div', { style: { padding: '12px', color: '#666' } }, 'No custom rules.')); for (const r of rules.slice()) box.append(h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 10px', borderBottom: '1px solid #eee' } }, h('input', { type: 'checkbox', checked: r.enabled, onchange: async (e) => { if (!(await admin(env, opts, 'Windows Defender Firewall'))) { e.target.checked = r.enabled; return; } r.enabled = e.target.checked; sys.touch('win'); } }), h('span', { style: { flex: 1 } }, `${r.name}  (${r.dir} · ${r.action} · port ${r.port})`), h('button', { class: 'w-btn', onclick: async () => { if (!(await admin(env, opts, 'Windows Defender Firewall'))) return; sys.win.fwRules = sys.win.fwRules.filter((x) => x !== r); rules.splice(rules.indexOf(r), 1); sys.touch('win'); draw(); } }, 'Remove'))); };
      draw();
      return h('div', { class: 'dlg', style: { width: '560px' } }, h('div', { class: 'dt' }, 'Allowed apps'), h('div', { class: 'db', style: { display: 'block' } }, h('h3', null, 'Allow apps to communicate through Windows Defender Firewall'), box), h('div', { class: 'df' }, h('button', { class: 'btn primary', onclick: () => done(true) }, 'OK')));
    });
  }
  function programs() {
    side.style.display = '';
    side.append(link('Control Panel Home', () => { page = 'home'; render(); }), link('View installed updates', () => env.openApp('settings', { page: 'update' })), link('🛡 Turn Windows features on or off', () => env.openApp('features')));
    let sel = null;
    const list = () => S.listPrograms(sys).slice().sort((a, b) => a.name.localeCompare(b.name));
    const tb = h('div', { class: 'w-tb', style: { background: '#f5f9fd' } });
    const tbody = h('tbody');
    const drawTb = () => { clear(tb); [h('button', null, 'Organize ▾'), sel ? h('button', { onclick: () => un(sel), disabled: !!sel.system, title: sel.system ? 'This app is part of Windows' : 'Uninstall' }, 'Uninstall') : null, sel ? h('button', { disabled: true }, 'Change') : null].filter(Boolean).forEach((x) => tb.append(x)); };
    const draw = () => { clear(tbody); for (const p of list()) tbody.append(h('tr', { class: sel?.id === p.id ? 'sel' : '', onclick: () => { sel = p; drawTb(); draw(); }, ondblclick: () => un(p) }, h('td', null, icon(p.id === 'Google.Chrome' ? 'w-chrome' : 'w-programs', 16), p.name), h('td', null, p.publisher || ''), h('td', null, p.installed || ''), h('td', null, p.size ? `${p.size} MB` : ''), h('td', null, p.version))); };
    const un = async (p) => {
      if (p.system) { env.ui.alert({ title: 'Programs and Features', heading: 'This program cannot be uninstalled from here.', message: `${p.name} is part of Windows.`, icon: 'w-info' }); return; }
      const ok = await env.ui.confirm({ title: 'Programs and Features', heading: `Are you sure you want to uninstall ${p.name}?`, message: '', ok: 'Yes', cancel: 'No', icon: 'w-warn' });
      if (!ok || !(await admin(env, opts, `${p.name} Uninstall`))) return;
      try { S.uninstallProgram(sys, p); env.desktop?.renderIcons?.(); } catch (e) { env.ui.alert({ title: 'Programs and Features', heading: 'Uninstall failed', message: e.message, icon: 'w-bad' }); }
      sel = null; drawTb(); draw();
    };
    body.style.padding = '0';
    body.append(h('div', { style: { padding: '14px 22px 6px' } }, h('h2', null, 'Uninstall or change a program'), h('p', { style: { margin: 0 } }, 'To uninstall a program, select it from the list and then click Uninstall, Change, or Repair.')), tb,
      h('table', { class: 'w-tab' }, h('thead', null, h('tr', null, ['Name', 'Publisher', 'Installed On', 'Size', 'Version'].map((x) => h('th', null, x)))), tbody));
    drawTb(); draw();
  }
  render();
  return win;
}

// ----------------------------------------------------------------------- System Properties
function sysdm(env, opts) {
  if (!opts.elevated) { const { elevated, ...rest } = opts; void elevated; return elevate(env, { ...rest, app: 'sysdm' }); }
  const sys = env.sys;
  const rdpOn = S.rdpEnabled(sys);
  const ra = h('input', { type: 'checkbox', checked: Number(S.regGet(sys, RA, 'fAllowToGetHelp') ?? 1) === 1 });
  const dont = h('input', { type: 'radio', name: 'rdp', checked: !rdpOn });
  const allow = h('input', { type: 'radio', name: 'rdp', checked: rdpOn });
  const nla = h('input', { type: 'checkbox', checked: S.nlaRequired(sys), disabled: !rdpOn });
  dont.onchange = allow.onchange = () => { nla.disabled = !allow.checked; };
  const apply = () => {
    S.regSet(sys, RA, 'fAllowToGetHelp', ra.checked ? 1 : 0);
    S.regSet(sys, S.KEYS.ts, 'fDenyTSConnections', allow.checked ? 0 : 1);
    S.regSet(sys, S.KEYS.rdpTcp, 'UserAuthentication', nla.checked ? 1 : 0);
    if (allow.checked) { if (S.getService(sys, 'TermService').startType === 'Disabled') S.setStartType(sys, 'TermService', 'Manual'); S.startService(sys, 'TermService'); }
    else S.stopService(sys, 'TermService');
  };
  return sheet(env, { title: 'System Properties', width: 430, tabs: [
    { name: 'Computer Name', build: () => h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, h('div', null, 'Windows uses the following information to identify your computer on the network.'), h('div', null, h('b', null, 'Full computer name: '), sys.hostname), h('div', null, h('b', null, 'Workgroup: '), 'WORKGROUP')) },
    { name: 'Hardware', build: () => h('div', null, 'Device Manager lists all the hardware devices installed on your computer.') },
    { name: 'Advanced', build: () => h('div', null, 'You must be logged on as an Administrator to make most of these changes.') },
    { name: 'System Protection', build: () => h('div', null, 'Protection Settings: Local Disk (C:) (System) — Off') },
    { name: 'Remote', build: () => h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
      h('fieldset', null, h('legend', null, 'Remote Assistance'), h('label', null, ra, 'Allow Remote Assistance connections to this computer')),
      h('fieldset', null, h('legend', null, 'Remote Desktop'), h('div', { style: { marginBottom: '6px' } }, 'Choose an option, and then specify who can connect.'), h('label', null, dont, "Don't allow remote connections to this computer"), h('label', null, allow, 'Allow remote connections to this computer'),
        h('label', { style: { marginLeft: '20px' } }, nla, 'Allow connections only from computers running Remote Desktop with Network Level Authentication (recommended)'),
        h('div', { style: { textAlign: 'right' } }, h('button', { onclick: () => env.openApp('lusrmgr', { node: 'groups', elevated: true }) }, 'Select Users...')))) },
  ], onOk: apply, onApply: apply }).then((ok) => { void ok; });
}

// ----------------------------------------------------------------------- Windows Features
const FEATURE_TREE = [
  ['NetFx4-AdvSrvs', '.NET Framework 4.8 Advanced Services'], ['Microsoft-Hyper-V-All', 'Hyper-V'], ['IIS-WebServerRole', 'Internet Information Services'], ['IIS-FTPServer', 'Internet Information Services › FTP Server'],
  ['Printing-PrintToPDFServices-Features', 'Microsoft Print to PDF'], ['SMB1Protocol', 'SMB 1.0/CIFS File Sharing Support'], ['TelnetClient', 'Telnet Client'], ['TFTP', 'TFTP Client'], ['MicrosoftWindowsPowerShellV2Root', 'Windows PowerShell 2.0'],
];
function features(env, opts) {
  if (!opts.elevated) { const { elevated, ...rest } = opts; void elevated; return elevate(env, { ...rest, app: 'features' }); }
  const sys = env.sys;
  const boxes = FEATURE_TREE.filter(([k]) => sys.win.features[k]).map(([k, label]) => ({ k, label, c: h('input', { type: 'checkbox', checked: sys.win.features[k].state === 'Enabled' }) }));
  return env.ui.modal((done) => h('div', { class: 'w-dlg', style: { width: '440px' } },
    h('div', { class: 'wd-t' }, h('span', null, 'Windows Features'), h('span', { onclick: () => done(false) }, '✕')),
    h('div', { style: { display: 'flex', gap: '10px', padding: '12px' } }, icon('w-features', 32), h('div', null, h('b', null, 'Turn Windows features on or off'), h('div', { style: { fontSize: '11px', marginTop: '4px' } }, 'To turn a feature on, select its check box. To turn a feature off, clear its check box. A filled box means that only part of the feature is turned on.'))),
    h('div', { style: { margin: '0 12px', background: '#fff', border: '1px solid #828790', height: '260px', overflow: 'auto', padding: '4px' } }, boxes.map((b) => h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', padding: '3px 4px', marginLeft: b.label.includes('›') ? '22px' : 0 } }, b.c, icon('w-folder', 16), b.label.replace(/^.*› /, '')))),
    h('div', { class: 'wd-f' }, h('button', { class: 'primary', onclick: () => {
      let changed = false;
      for (const b of boxes) { const want = b.c.checked; if ((sys.win.features[b.k].state === 'Enabled') !== want) { S.setFeature(sys, b.k, want); changed = true; } }
      done(true);
      if (changed) env.ui.alert({ title: 'Windows Features', heading: 'Windows completed the requested changes.', message: 'Windows needs to reboot your PC to finish installing the requested changes.', icon: 'w-ok' });
    } }, 'OK'), h('button', { onclick: () => done(false) }, 'Cancel'))));
}
