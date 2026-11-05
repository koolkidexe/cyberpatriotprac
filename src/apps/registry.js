// App id -> lazy module. Every app module exports `open(env, opts)`.
const LOADERS = {
  terminal: () => import('./terminal.js'),
  nemo: () => import('./files.js'),
  xed: () => import('./editor.js'),
  firefox: () => import('./browser.js'),
  chromium: () => import('./browser.js'),
  users: () => import('./users-app.js'),
  settings: () => import('./settings.js'),
  gufw: () => import('./gufw.js'),
  update: () => import('./update.js'),
  software: () => import('./software.js'),
  sources: () => import('./generic.js'),
  swprops: () => import('./swprops.js'),
  monitor: () => import('./monitor.js'),
  login: () => import('./login-window.js'),
  startup: () => import('./startup.js'),
  printers: () => import('./generic.js'),
  generic: () => import('./generic.js'),
  // Windows 11
  chrome: () => import('./browser.js'), thunderbird: () => import('./win-thunderbird.js'), uacsettings: () => import('./win-control.js'),
  explorer: () => import('./win-explorer.js'),
  notepad: () => import('./win-notepad.js'),
  compmgmt: () => import('./win-mmc.js'), lusrmgr: () => import('./win-mmc.js'), services: () => import('./win-mmc.js'), shares: () => import('./win-mmc.js'), taskschd: () => import('./win-mmc.js'), secpol: () => import('./win-mmc.js'),
  settings_win: () => import('./win-settings.js'), security: () => import('./win-settings.js'),
  control: () => import('./win-control.js'), firewall: () => import('./win-control.js'), programs: () => import('./win-control.js'), sysdm: () => import('./win-control.js'), features: () => import('./win-control.js'),
  taskmgr: () => import('./win-tools.js'), regedit: () => import('./win-tools.js'),
  gpedit: () => import('./win-mmc.js'), notepadpp: () => import('./win-npp.js'), wireshark: () => import('./win-wireshark.js'),
  run: () => import('../ui/win-run.js'),
  elevate: () => Promise.resolve({ open: (env, o) => { const { app, ...rest } = o; void app; return env.elevate?.(rest); } }),
};
const WIN_ONLY = { settings: 'settings_win' };
const ALIASES = { gufw: 'gufw' };

export async function loadApp(id, os) {
  if (os === 'windows' && WIN_ONLY[id]) id = WIN_ONLY[id];
  const key = LOADERS[id] ? id : 'generic';
  const mod = await LOADERS[key]();
  return mod.open;
}
export { ALIASES };
