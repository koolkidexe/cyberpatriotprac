// Wireshark 4.4: welcome page, packet list with the default colouring rules, display filters, packet details and
// bytes panes. Reads the simulator's capture files (attack.pcap), which hold the packets Base64-encoded.
import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import * as S from '../win/state.js';

const ID = 'WiresharkFoundation.Wireshark';
const COLORS = { TCP: '#e7e6ff', HTTP: '#e4ffc7', DNS: '#daeeff', DHCP: '#daeeff', ARP: '#faf0d7', ICMP: '#fce0ff' };
const SYN = '#a0a0a0';

export function parseCapture(text) {
  if (!text?.startsWith('PCAPSIM1:')) return null;
  const b = text.slice(9);
  const json = typeof atob === 'function' ? decodeURIComponent(escape(atob(b))) : Buffer.from(b, 'base64').toString('utf8');
  return JSON.parse(json).packets.map(([time, src, dst, proto, len, info], i) => ({ no: i + 1, time, src, dst, proto, len, info }));
}
/** Small display-filter language: ip.addr/ip.src/ip.dst == x, tcp.port == n, protocol names, &&, ||, !. */
export function filterFn(expr) {
  const e = expr.trim();
  if (!e) return () => true;
  const term = (t) => {
    t = t.trim();
    if (t.startsWith('!')) { const f = term(t.slice(1)); return f && ((p) => !f(p)); }
    let m = /^(ip\.addr|ip\.src|ip\.dst|ip\.src_host|ip\.dst_host)\s*(==|eq|!=)\s*([\d.]+)$/i.exec(t);
    if (m) { const [, f, op, v] = m; const test = (p) => (/addr/i.test(f) ? p.src === v || p.dst === v : /src/i.test(f) ? p.src === v : p.dst === v); return op === '!=' ? (p) => !test(p) : test; }
    m = /^(tcp\.port|tcp\.dstport|tcp\.srcport)\s*(==|eq)\s*(\d+)$/i.exec(t);
    if (m) { const v = m[3]; return (p) => p.proto !== 'ARP' && new RegExp(`(^|\\D)${v}(\\D|$)`).test(p.info.split('[')[0]); }
    m = /^tcp\.flags\.syn\s*==\s*1$/i.exec(t);
    if (m) return (p) => /\[SYN/.test(p.info);
    if (/^(tcp|udp|http|dns|arp|dhcp|icmp|ip)$/i.test(t)) { const v = t.toUpperCase(); return (p) => (v === 'IP' ? p.proto !== 'ARP' : v === 'TCP' ? ['TCP', 'HTTP'].includes(p.proto) : v === 'UDP' ? ['DNS', 'DHCP'].includes(p.proto) : p.proto === v); }
    m = /^frame contains\s+"(.*)"$/i.exec(t);
    if (m) return (p) => p.info.toLowerCase().includes(m[1].toLowerCase());
    return null;
  };
  const ors = e.split(/\s*(?:\|\||\bor\b)\s*/i).map((o) => o.split(/\s*(?:&&|\band\b)\s*/i).map(term));
  if (ors.some((a) => a.some((f) => !f))) return null;
  return (p) => ors.some((a) => a.every((f) => f(p)));
}

export function open(env, opts = {}) {
  const sys = env.sys;
  if (!S.listPrograms(sys).some((p) => p.id === ID) || !sys.vfs.exists('/Program Files/Wireshark/Wireshark.exe')) { env.ui.alert({ title: 'Wireshark', heading: 'Windows cannot find Wireshark.exe', message: 'Wireshark is not installed on this computer.', icon: 'w-warn' }); return null; }
  let packets = null; let file = null; let sel = null; let shown = [];
  const fIn = h('input', { class: 'ws-filter', placeholder: 'Apply a display filter … <Ctrl-/>', title: 'Display filter, e.g. ip.addr == 10.0.0.5, tcp.port == 80, http, tcp.flags.syn == 1', onkeydown: (e) => { if (e.key === 'Enter') applyFilter(); } });
  const list = h('div', { class: 'ws-list' });
  const detail = h('div', { class: 'ws-detail' });
  const bytes = h('div', { class: 'ws-bytes' });
  const status = h('div', { class: 'ws-status' });
  const body = h('div', { class: 'ws-body' });
  const menu = (label, items) => h('div', { class: 'npp-mi', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); env.ui.showMenu(r.left, r.bottom, items()); } }, label);
  const root = h('div', { class: 'ws' },
    h('div', { class: 'npp-menu' }, menu('File', () => [{ label: 'Open…', hint: 'Ctrl+O', action: openDlg }, { label: 'Close', action: () => { packets = null; file = null; draw(); } }, 'sep', { label: 'Quit', action: () => win.close() }]), menu('Edit', () => []), menu('View', () => []), menu('Go', () => []), menu('Capture', () => [{ label: 'Start (not available in the simulator)', disabled: true }]), menu('Analyze', () => [{ label: 'Display Filters…', action: () => fIn.focus() }]), menu('Statistics', () => [{ label: 'Conversations', action: conversations }, { label: 'Protocol Hierarchy', action: hierarchy }]), menu('Telephony', () => []), menu('Wireless', () => []), menu('Tools', () => []), menu('Help', () => [{ label: 'About Wireshark', action: () => env.ui.alert({ title: 'About Wireshark', heading: 'Wireshark 4.4.5 (v4.4.5-0-g3b1c2a0)', message: 'Simulated packet analyzer.', icon: 'w-wireshark' }) }])),
    h('div', { class: 'ws-tools' }, h('button', { title: 'Open a capture file', onclick: openDlg }, '📂'), h('button', { title: 'Close this capture file', onclick: () => { packets = null; file = null; draw(); } }, '✕'), h('button', { title: 'Reload', onclick: () => file && load(file) }, '⟳'), h('span', { class: 'npp-sep' }), h('button', { title: 'Start capturing packets (not simulated)', disabled: true }, '◢')),
    h('div', { class: 'ws-fbar' }, h('span', { class: 'ws-fi' }, '▤'), fIn, h('button', { title: 'Apply display filter', onclick: applyFilter }, '→'), h('button', { title: 'Clear filter', onclick: () => { fIn.value = ''; applyFilter(); } }, '✕')),
    body, status);
  const win = env.wm.open({ title: 'The Wireshark Network Analyzer', icon: 'w-wireshark', width: 1080, height: 660, appId: 'wireshark', content: root });

  function load(path) {
    const t = sys.vfs.isFile(path) ? sys.vfs.readFile(path) : null;
    let pk = null; try { pk = parseCapture(t); } catch { pk = null; }
    if (!pk) { env.ui.alert({ title: 'Wireshark', heading: `The file "${S.toWin(path)}" isn't a capture file in a format Wireshark understands.`, message: '', icon: 'w-warn' }); return; }
    packets = pk; file = path; sel = null; fIn.value = ''; shown = pk; draw();
  }
  function applyFilter() {
    if (!packets) return;
    const f = filterFn(fIn.value);
    fIn.classList.toggle('bad', !f); fIn.classList.toggle('good', !!f && !!fIn.value.trim());
    if (!f) { status.textContent = `"${fIn.value}" is not a valid display filter.`; return; }
    shown = packets.filter(f); sel = null; draw();
  }
  async function openDlg() {
    const p = await env.ui.prompt({ title: 'Wireshark · Open Capture File', message: 'File name:', value: `C:\\Users\\${env.user}\\Documents\\Captures\\attack.pcap` });
    if (p) load(S.resolve(sys, S.fromWin(p, `/Users/${env.user}`)));
  }
  function draw() {
    clear(body);
    win.setTitle(file ? file.split('/').pop() : 'The Wireshark Network Analyzer');
    if (!packets) {
      const recent = '/Users/' + env.user + '/Documents/Captures/attack.pcap';
      body.append(h('div', { class: 'ws-welcome' }, h('h2', null, 'Welcome to Wireshark'), h('h3', null, 'Open'),
        sys.vfs.exists(recent) ? h('a', { class: 'w-link', onclick: () => load(recent) }, `${S.toWin(recent)} (${Math.round(sys.vfs.stat(recent).size / 1024)} KB)`) : h('div', { class: 'sub' }, 'No recent files'),
        h('h3', null, 'Capture'), h('div', { class: 'sub' }, '…using this filter: ', h('input', { class: 'ws-filter', style: { width: '320px' }, placeholder: 'Enter a capture filter …', disabled: true })),
        h('div', { class: 'ws-iface' }, 'Ethernet0  ', h('span', { class: 'sub' }, '⁓⁓⁓___⁓___⁓'), h('br'), 'Adapter for loopback traffic capture'), h('p', { class: 'sub' }, 'Live capture is not part of the simulation. Open a saved capture file instead.')));
      status.textContent = 'Ready to load or capture';
      return;
    }
    const tbody = h('tbody');
    for (const p of shown) {
      const bg = /\[SYN\]/.test(p.info) ? SYN : COLORS[p.proto] || '#fff';
      tbody.append(h('tr', { class: sel === p ? 'sel' : '', style: { background: sel === p ? '' : bg }, onclick: () => { sel = p; draw(); } },
        h('td', { style: { textAlign: 'right' } }, p.no), h('td', null, p.time), h('td', null, p.src), h('td', null, p.dst), h('td', null, p.proto), h('td', { style: { textAlign: 'right' } }, p.len), h('td', null, p.info)));
    }
    clear(list);
    list.append(h('table', { class: 'ws-tab' }, h('thead', null, h('tr', null, ['No.', 'Time', 'Source', 'Destination', 'Protocol', 'Length', 'Info'].map((x) => h('th', null, x)))), tbody));
    clear(detail); clear(bytes);
    if (sel) {
      const port = /(\d+) → (\d+)/.exec(sel.info);
      const tree = [`Frame ${sel.no}: ${sel.len} bytes on wire (${sel.len * 8} bits), ${sel.len} bytes captured (${sel.len * 8} bits) on interface \\Device\\NPF_{8C3A}, id 0`,
        sel.proto === 'ARP' ? 'Ethernet II, Src: VMware_3e:12:9a, Dst: Broadcast (ff:ff:ff:ff:ff:ff)' : 'Ethernet II, Src: VMware_3e:12:9a (00:0c:29:3e:12:9a), Dst: VMware_c0:00:08 (00:50:56:c0:00:08)',
        ...(sel.proto === 'ARP' ? ['Address Resolution Protocol (request)'] : [`Internet Protocol Version 4, Src: ${sel.src}, Dst: ${sel.dst}`]),
        ...(['TCP', 'HTTP'].includes(sel.proto) ? [`Transmission Control Protocol, Src Port: ${port ? port[1] : 80}, Dst Port: ${port ? port[2] : ''}`] : ['DNS', 'DHCP'].includes(sel.proto) ? ['User Datagram Protocol'] : []),
        ...(sel.proto === 'HTTP' ? [`Hypertext Transfer Protocol: ${sel.info}`] : sel.proto === 'DNS' ? [`Domain Name System: ${sel.info}`] : [])];
      for (const t of tree) detail.append(h('div', { class: 'ws-node' }, '› ', t));
      const raw = Array.from(`${sel.src}>${sel.dst} ${sel.info}`).slice(0, 96).map((c) => c.charCodeAt(0) & 0xff);
      for (let i = 0; i < raw.length; i += 16) { const row = raw.slice(i, i + 16); bytes.append(h('div', null, `${i.toString(16).padStart(4, '0')}  ${row.map((b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(48)}  ${row.map((b) => (b > 31 && b < 127 ? String.fromCharCode(b) : '.')).join('')}`)); }
    } else detail.append(h('div', { class: 'sub', style: { padding: '6px' } }, 'Select a packet to see its details.'));
    body.append(list, detail, bytes);
    status.textContent = `${S.toWin(file)}    Packets: ${packets.length} · Displayed: ${shown.length} (${packets.length ? ((shown.length / packets.length) * 100).toFixed(1) : 0}%)    Profile: Default`;
  }
  function conversations() {
    if (!packets) return;
    const m = new Map();
    for (const p of packets) { if (p.proto === 'ARP') continue; const k = [p.src, p.dst].sort().join(' ↔ '); m.set(k, (m.get(k) || 0) + 1); }
    env.ui.alert({ title: 'Conversations · IPv4', heading: `${m.size} conversations`, message: [...m].map(([k, n]) => `${k}    ${n} packets`).join('\n'), icon: 'w-wireshark' });
  }
  function hierarchy() { if (!packets) return; const m = {}; for (const p of packets) m[p.proto] = (m[p.proto] || 0) + 1; env.ui.alert({ title: 'Protocol Hierarchy Statistics', heading: 'Frame', message: Object.entries(m).map(([k, n]) => `${k}: ${n} packets (${((n / packets.length) * 100).toFixed(1)}%)`).join('\n'), icon: 'w-wireshark' }); }
  draw();
  if (opts.path) load(opts.path); else if (opts.args?.[0]) load(S.resolve(sys, S.fromWin(opts.args[0], `/Users/${env.user}`)));
  return win;
}
