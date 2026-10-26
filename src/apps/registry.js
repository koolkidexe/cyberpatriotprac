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
  monitor: () => import('./monitor.js'),
  login: () => import('./login-window.js'),
  startup: () => import('./startup.js'),
  printers: () => import('./generic.js'),
  generic: () => import('./generic.js'),
};
const ALIASES = { gufw: 'gufw' };

export async function loadApp(id) {
  const key = LOADERS[id] ? id : 'generic';
  const mod = await LOADERS[key]();
  return mod.open;
}
export { ALIASES };
