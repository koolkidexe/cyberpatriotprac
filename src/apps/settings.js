// System Settings (cinnamon-settings): tile grid that launches the real simulated panels.
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

const TILES = [
  ['Users and Groups', 'users', 'users'], ['Login Window', 'login', 'login'], ['Startup Applications', 'startup', 'startup'],
  ['Firewall', 'shield', 'gufw'], ['Update Manager', 'update', 'update'], ['Software Sources', 'refresh', 'sources'],
  ['Printers', 'printer', 'printers'], ['System Monitor', 'pulse', 'monitor'], ['Terminal', 'terminal', 'terminal'],
];

export function open(env) {
  const grid = h('div', { class: 'tiles' }, TILES.map(([n, ic, app]) => h('div', { class: 'tile', ondblclick: () => env.openApp(app), onclick: () => env.openApp(app) }, icon(ic, 40), n)));
  return env.wm.open({ title: 'System Settings', icon: 'gear', width: 620, height: 400, appId: 'settings', content: h('div', { class: 'app-body' }, grid) });
}
