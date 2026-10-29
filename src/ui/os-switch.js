// "Switch operating system" UI shared by both desktops (tray button + simulator menu).
import { h } from './dom.js';

export const OS_LIST = [
  { id: 'mint', name: 'Linux Mint 21.3', sub: 'Cinnamon desktop · Mint Practice Round 1', color: '#8fa876' },
  { id: 'ubuntu', name: 'Ubuntu 22.04 LTS', sub: 'GNOME desktop · Ubuntu Practice Round 1', color: '#e95420' },
];

/** Popup content: one row per image, current one marked. Progress is saved separately per image. */
export function osSwitchContent(env, close) {
  const rows = OS_LIST.map((o) => {
    const cur = o.id === env.os;
    return h('div', { class: 'row os-row' + (cur ? ' cur' : ''), title: cur ? 'You are using this image right now' : `Reboot into ${o.name} (your progress here is saved)`,
      onclick: () => { if (!cur) { close?.(); env.switchOs(o.id); } } },
    h('span', { class: 'os-dot', style: { background: o.color } }),
    h('span', { style: { flex: 1 } }, h('div', { style: { fontWeight: 600 } }, o.name), h('div', { style: { fontSize: '11px', opacity: 0.7 } }, o.sub)),
    cur ? h('span', { class: 'badge green' }, 'Current') : h('button', { class: 'btn', title: `Switch to ${o.name}` }, 'Switch'));
  });
  return [h('h4', null, 'Switch operating system'), ...rows,
    h('div', { style: { fontSize: '11px', opacity: 0.65, marginTop: '6px', maxWidth: '300px' } }, 'Each image keeps its own progress. You can switch back at any time.')];
}
