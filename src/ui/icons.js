// Inline SVG icon set. icon('folder', 32) returns an element.
// The themed set in icons-apps.js (Mint-Y tiles or Yaru) is used first; G below is the fallback for names it lacks.
import { APPS } from './icons-apps.js';

let theme = 'mint';
let uniq = 0;
/** 'mint' (Mint-Y) or 'yaru' (Ubuntu). */
export function setIconTheme(t) { theme = t === 'yaru' ? 'yaru' : 'mint'; }
export const iconTheme = () => theme;
const G = {
  folder: ['#8fa876', '<path d="M6 14c0-2 1-3 3-3h9l4 4h17c2 0 3 1 3 3v17c0 2-1 3-3 3H9c-2 0-3-1-3-3z" fill="#fff" opacity=".92"/><path d="M6 20h36v15c0 2-1 3-3 3H9c-2 0-3-1-3-3z" fill="#fff"/>'],
  'folder-open': ['#7e9a66', '<path d="M6 14c0-2 1-3 3-3h9l4 4h17c2 0 3 1 3 3v3H6z" fill="#fff" opacity=".7"/><path d="M4 22h40l-4 15c-.4 1.500-1.500 2-3 2H9c-1.500 0-2.500-.6-3-2z" fill="#fff"/>'],
  file: ['#eceff1', '<path d="M12 6h16l9 9v27c0 1-1 2-2 2H12c-1 0-2-1-2-2V8c0-1 1-2 2-2z" fill="#fff" stroke="#9aa5ab" stroke-width="2"/><path d="M28 6v9h9" fill="#dfe5e8" stroke="#9aa5ab" stroke-width="2"/><path d="M16 24h17M16 29h17M16 34h11" stroke="#b0bbc1" stroke-width="2"/>'],
  text: ['#eceff1', '<path d="M12 6h16l9 9v27c0 1-1 2-2 2H12c-1 0-2-1-2-2V8c0-1 1-2 2-2z" fill="#fff" stroke="#9aa5ab" stroke-width="2"/><path d="M28 6v9h9" fill="#dfe5e8" stroke="#9aa5ab" stroke-width="2"/><path d="M16 22h17M16 27h17M16 32h17M16 37h9" stroke="#6b7a82" stroke-width="2"/>'],
  html: ['#eceff1', '<path d="M12 6h16l9 9v27c0 1-1 2-2 2H12c-1 0-2-1-2-2V8c0-1 1-2 2-2z" fill="#fff" stroke="#9aa5ab" stroke-width="2"/><path d="M28 6v9h9" fill="#dfe5e8" stroke="#9aa5ab" stroke-width="2"/><path d="M20 24l-4 5 4 5M28 24l4 5-4 5" fill="none" stroke="#e8710a" stroke-width="2.500" stroke-linecap="round" stroke-linejoin="round"/>'],
  terminal: ['#2e3436', '<rect x="7" y="9" width="34" height="30" rx="3" fill="#1b1e20" stroke="#8fa876" stroke-width="2"/><path d="M13 19l7 5-7 5" fill="none" stroke="#8fa876" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M24 31h10" stroke="#fff" stroke-width="3" stroke-linecap="round"/>'],
  chromium: ['#f1f3f4', '<circle cx="24" cy="24" r="16" fill="#db4437"/><path d="M24 24L10 16a16 16 0 0114-8z" fill="#db4437"/><path d="M24 24l14 0a16 16 0 01-14 16z" fill="#f4b400"/><path d="M24 24L10 32a16 16 0 01-.1-16z" fill="#0f9d58"/><circle cx="24" cy="24" r="7" fill="#fff"/><circle cx="24" cy="24" r="5" fill="#4285f4"/>'],
  cyberpatriot: ['#0f2a4a', '<path d="M24 6l15 5v11c0 9-6 16-15 20C15 38 9 31 9 22V11z" fill="#fff"/><path d="M24 9.500l12 4v8.500c0 7.500-5 13.500-12 16.500C17 35.500 12 29.500 12 22v-8.500z" fill="#1f4e8c"/><path d="M24 14l2.400 5.100 5.600.7-4.100 3.900 1 5.500L24 26.400 19.100 29.200l1-5.500-4.100-3.900 5.600-.7z" fill="#f2c230"/>'],
  firefox: ['#2b3a67', '<circle cx="24" cy="24" r="15" fill="#ff9500"/><path d="M24 9c8 0 15 6 15 15s-7 15-15 15" fill="#e8421c" opacity=".75"/><circle cx="24" cy="24" r="9" fill="#3a5bd9"/><path d="M15 24h18M24 15c-4 5-4 13 0 18M24 15c4 5 4 13 0 18" stroke="#fff" stroke-width="1.600" fill="none" opacity=".85"/>'],
  gear: ['#6c7a89', '<path d="M24 14a10 10 0 100 20 10 10 0 000-20zm0 6.500a3.500 3.500 0 110 7 3.500 3.500 0 010-7z" fill="#fff"/><g stroke="#fff" stroke-width="5" stroke-linecap="round"><path d="M24 7v5M24 36v5M7 24h5M36 24h5M12 12l3.500 3.500M32.500 32.500L36 36M36 12l-3.500 3.500M15.500 32.500L12 36"/></g>'],
  shield: ['#3f8f5b', '<path d="M24 6l15 5v11c0 9-6 16-15 20C15 38 9 31 9 22V11z" fill="#fff"/><path d="M17 24l5 5 9-10" fill="none" stroke="#3f8f5b" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'],
  users: ['#5a7ea8', '<circle cx="18" cy="17" r="6" fill="#fff"/><path d="M6 38c0-7 5-11 12-11s12 4 12 11z" fill="#fff"/><circle cx="33" cy="19" r="5" fill="#fff" opacity=".75"/><path d="M28 29c7-1 14 2 14 9H32c0-3-1-6-4-9z" fill="#fff" opacity=".75"/>'],
  refresh: ['#3b7dd8', '<path d="M36 18a13 13 0 00-23-2" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M12 30a13 13 0 0023 2" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M38 9v10H28zM10 39V29h10z" fill="#fff"/>'],
  bag: ['#8fa876', '<path d="M10 17h28l-2 23c0 1-1 2-2 2H14c-1 0-2-1-2-2z" fill="#fff"/><path d="M17 17v-3a7 7 0 0114 0v3" fill="none" stroke="#fff" stroke-width="3.500"/><path d="M19 27l5 5 6-8" fill="none" stroke="#8fa876" stroke-width="3.500" stroke-linecap="round" stroke-linejoin="round"/>'],
  pulse: ['#c0392b', '<rect x="7" y="9" width="34" height="26" rx="3" fill="#fff"/><path d="M10 26h6l3-8 5 12 4-9 2 5h8" fill="none" stroke="#c0392b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 40h12" stroke="#fff" stroke-width="3" stroke-linecap="round"/>'],
  login: ['#4b5c74', '<rect x="7" y="9" width="34" height="23" rx="3" fill="#fff"/><circle cx="24" cy="17" r="4" fill="#4b5c74"/><path d="M16 28c0-5 4-7 8-7s8 2 8 7z" fill="#4b5c74"/><path d="M16 38h16" stroke="#fff" stroke-width="3" stroke-linecap="round"/>'],
  startup: ['#d9822b', '<path d="M24 7c7 4 10 12 8 21l-5 5h-6l-5-5c-2-9 1-17 8-21z" fill="#fff"/><circle cx="24" cy="19" r="3.500" fill="#d9822b"/><path d="M16 31l-5 7 8-2M32 31l5 7-8-2" fill="#fff" opacity=".8"/>'],
  update: ['#3b7dd8', '<circle cx="24" cy="24" r="15" fill="#fff"/><path d="M24 13v12l8 5" fill="none" stroke="#3b7dd8" stroke-width="3.500" stroke-linecap="round" stroke-linejoin="round"/>'],
  lock: ['#1f2123', '<rect x="11" y="21" width="26" height="19" rx="3" fill="#fff"/><path d="M16 21v-5a8 8 0 0116 0v5" fill="none" stroke="#fff" stroke-width="4"/><circle cx="24" cy="30" r="3" fill="#6c7a89"/>'],
  power: ['#d9322a', '<path d="M24 8v14" stroke="#fff" stroke-width="4.500" stroke-linecap="round"/><path d="M15 15a14 14 0 1018 0" fill="none" stroke="#fff" stroke-width="4.500" stroke-linecap="round"/>'],
  logout: ['#1f2123', '<path d="M18 8h-6c-2 0-3 1-3 3v26c0 2 1 3 3 3h6" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M22 24h17m-6-7l7 7-7 7" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'],
  trash: ['#7f8c8d', '<path d="M12 14h24l-2 25c0 1-1 2-2 2H16c-1 0-2-1-2-2z" fill="#fff"/><path d="M10 14h28M19 14v-4h10v4" stroke="#fff" stroke-width="3.500" stroke-linecap="round" fill="none"/><path d="M20 21v14M28 21v14" stroke="#7f8c8d" stroke-width="2.500"/>'],
  computer: ['#6c7a89', '<rect x="8" y="9" width="32" height="22" rx="2.500" fill="#dfe5e8"/><rect x="11" y="12" width="26" height="16" fill="#4a5560"/><path d="M18 38h12M24 31v7" stroke="#fff" stroke-width="3.500" stroke-linecap="round"/>'],
  home: ['#8fa876', '<path d="M6 24L24 8l18 16" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 22v17h8v-10h8v10h8V22L24 12z" fill="#fff"/>'],
  disk: ['#7f8c8d', '<rect x="7" y="14" width="34" height="20" rx="3" fill="#fff"/><circle cx="35" cy="24" r="2.500" fill="#7f8c8d"/><path d="M12 24h14" stroke="#7f8c8d" stroke-width="3" stroke-linecap="round"/>'],
  music: ['#9b59b6', '<path d="M19 33V12l18-4v21" fill="none" stroke="#fff" stroke-width="3.500" stroke-linejoin="round"/><circle cx="15" cy="34" r="5" fill="#fff"/><circle cx="33" cy="30" r="5" fill="#fff"/>'],
  video: ['#2c3e50', '<rect x="7" y="11" width="34" height="26" rx="3" fill="#fff"/><path d="M20 18l12 6-12 6z" fill="#2c3e50"/>'],
  image: ['#2e86c1', '<rect x="7" y="9" width="34" height="30" rx="3" fill="#fff"/><circle cx="17" cy="19" r="4" fill="#2e86c1"/><path d="M9 36l11-11 7 7 5-5 9 9z" fill="#2e86c1" opacity=".85"/>'],
  net: ['#5a7ea8', '<path d="M6 19a26 26 0 0136 0M12 26a17 17 0 0124 0M18 33a8 8 0 0112 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/><circle cx="24" cy="38" r="2.800" fill="#fff"/>'],
  volume: ['#5a7ea8', '<path d="M8 19h7l9-7v24l-9-7H8z" fill="#fff"/><path d="M31 18a9 9 0 010 12M35 13a15 15 0 010 22" fill="none" stroke="#fff" stroke-width="3.500" stroke-linecap="round"/>'],
  app: ['#7f8c8d', '<g fill="#fff"><rect x="9" y="9" width="12" height="12" rx="2"/><rect x="27" y="9" width="12" height="12" rx="2"/><rect x="9" y="27" width="12" height="12" rx="2"/><rect x="27" y="27" width="12" height="12" rx="2" opacity=".6"/></g>'],
  printer: ['#7f8c8d', '<rect x="14" y="7" width="20" height="12" fill="#fff"/><rect x="7" y="19" width="34" height="16" rx="3" fill="#fff"/><rect x="14" y="30" width="20" height="11" fill="#dfe5e8" stroke="#7f8c8d" stroke-width="2"/>'],
  calc: ['#16a085', '<rect x="10" y="6" width="28" height="36" rx="3" fill="#fff"/><rect x="14" y="10" width="20" height="8" fill="#16a085"/><g fill="#16a085"><circle cx="17" cy="26" r="2.500"/><circle cx="24" cy="26" r="2.500"/><circle cx="31" cy="26" r="2.500"/><circle cx="17" cy="34" r="2.500"/><circle cx="24" cy="34" r="2.500"/><circle cx="31" cy="34" r="2.500"/></g>'],
  mail: ['#2e86c1', '<rect x="6" y="11" width="36" height="26" rx="3" fill="#fff"/><path d="M8 14l16 12 16-12" fill="none" stroke="#2e86c1" stroke-width="3"/>'],
  warn: ['#e0a100', '<path d="M24 7l19 33H5z" fill="#fff"/><path d="M24 19v10" stroke="#e0a100" stroke-width="4" stroke-linecap="round"/><circle cx="24" cy="34" r="2.500" fill="#e0a100"/>'],
  info: ['#3b7dd8', '<circle cx="24" cy="24" r="17" fill="#fff"/><path d="M24 22v12" stroke="#3b7dd8" stroke-width="4" stroke-linecap="round"/><circle cx="24" cy="15" r="2.800" fill="#3b7dd8"/>'],
  error: ['#c0392b', '<circle cx="24" cy="24" r="17" fill="#fff"/><path d="M17 17l14 14M31 17L17 31" stroke="#c0392b" stroke-width="4.500" stroke-linecap="round"/>'],
  question: ['#3b7dd8', '<circle cx="24" cy="24" r="17" fill="#fff"/><path d="M18 20c0-4 3-6 6-6s6 2 6 5c0 4-6 4-6 9" fill="none" stroke="#3b7dd8" stroke-width="3.800" stroke-linecap="round"/><circle cx="24" cy="35" r="2.600" fill="#3b7dd8"/>'],
  key: ['#d9822b', '<circle cx="17" cy="24" r="8" fill="#fff"/><circle cx="17" cy="24" r="3" fill="#d9822b"/><path d="M24 24h17M35 24v6M40 24v4" stroke="#fff" stroke-width="4" stroke-linecap="round"/>'],
  score: ['#3f8f5b', '<rect x="8" y="8" width="32" height="32" rx="4" fill="#fff"/><path d="M14 30l6-6 5 4 9-11" fill="none" stroke="#3f8f5b" stroke-width="3.800" stroke-linecap="round" stroke-linejoin="round"/>'],
};
const ALIAS = {
  aisleriot: 'cards', 'gnome-aisleriot': 'cards', bulky: 'folder', celluloid: 'cat-sound-video', hypnotix: 'cat-sound-video', drawing: 'cat-graphics', pix: 'image', xreader: 'file',
  'libreoffice-calc': 'lo-calc', 'libreoffice-writer': 'lo-writer', 'libreoffice-common': 'libreoffice', 'libreoffice-startcenter': 'libreoffice', 'libreoffice-impress': 'lo-impress',
  cinnamon: 'gear', 'gnome-system-monitor': 'pulse', mintbackup: 'disk', mintreport: 'info', mintsources: 'refresh', mintstick: 'disk', mintwelcome: 'info', onboard: 'key', printer: 'printer',
  'system-config-printer': 'printer', sticky: 'text', timeshift: 'update', 'transmission-gtk': 'net', warpinator: 'net', ophcrack: 'key', seahorse: 'key', wireshark: 'net',
  nautilus: 'folder', gedit: 'text', 'gnome-control-center': 'gear', 'update-manager': 'update', 'software-properties-gtk': 'refresh', 'gnome-software': 'bag', eog: 'image', evince: 'file', totem: 'video', 'gnome-screenshot': 'image', 'gnome-disk-utility': 'disk', 'gnome-startup-applications': 'startup',
  'utilities-terminal': 'terminal', 'gnome-terminal': 'terminal', 'preferences-system': 'gear', 'cinnamon-settings': 'gear', 'preferences-desktop': 'gear', 'system-software-install': 'bag', mintinstall: 'bag',
  mintupdate: 'update', 'system-software-update': 'update', gufw: 'shield', 'security-high': 'shield', 'text-html': 'html', 'text-x-generic': 'text', 'accessories-text-editor': 'text', xed: 'text', 'text-editor': 'text',
  'system-file-manager': 'folder', nemo: 'folder', 'folder-home': 'home', 'user-trash': 'trash', 'user-trash-full': 'trash', 'application-x-executable': 'app', 'applications-internet': 'firefox',
  'org.gnome.SystemMonitor': 'pulse', 'utilities-system-monitor': 'pulse', 'system-users': 'users', 'user-info': 'users', 'cs-user': 'users', 'cs-login': 'login', 'preferences-system-login': 'login',
  'system-run': 'startup', 'cs-startup-programs': 'startup', 'audio-x-generic': 'music', 'video-x-generic': 'video', 'image-x-generic': 'image', 'network-wireless': 'net', 'network-wired': 'net', 'audio-volume-high': 'volume',
  'system-shutdown': 'power', 'system-lock-screen': 'lock', 'system-log-out': 'logout', 'drive-harddisk': 'disk', 'printer': 'printer', 'accessories-calculator': 'calc', 'gnome-calculator': 'calc', 'thunderbird': 'mail',
  'dialog-warning': 'warn', 'dialog-information': 'info', 'dialog-error': 'error', 'dialog-question': 'question', 'dialog-password': 'key', 'text-x-script': 'text', firefox: 'firefox', chromium: 'chromium',
};

let customLogo = null;
/** Use a user-supplied image (e.g. assets/cyberpatriot-logo.png) for the CyberPatriot icon. */
export function setCustomLogo(url) { customLogo = url; }

export function iconSvg(name, size = 32) {
  if (name === 'cyberpatriot' && customLogo) return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="23.5" fill="#fff"/><image href="${customLogo}" x="0" y="0" width="48" height="48" preserveAspectRatio="xMidYMid meet"/></svg>`;
  const themed = APPS[name] ? name : APPS[ALIAS[name]] && !G[name] ? ALIAS[name] : null;
  if (themed) {
    const id = ++uniq;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true">${APPS[themed](theme).replace(/§/g, '_' + id)}</svg>`;
  }
  const key = G[name] ? name : ALIAS[name] || 'app';
  const [bg, body] = G[key];
  const folderish = key === 'folder' || key === 'folder-open' || key === 'home';
  const tile = ['folder', 'folder-open', 'file', 'text', 'html', 'info', 'error', 'question', 'warn'].includes(key) && key !== 'folder' && key !== 'folder-open' ? '' : `<rect x="1" y="1" width="46" height="46" rx="10" fill="${bg}"${folderish ? ` style="fill:var(--folder,${bg})"` : ''}/>`;
  const flat = ['file', 'text', 'html', 'info', 'error', 'question', 'warn'].includes(key);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true">${flat ? '' : tile}${body}</svg>`;
}
export function icon(name, size = 32) {
  const s = document.createElement('span');
  s.className = 'ico';
  s.style.width = s.style.height = size + 'px';
  s.innerHTML = iconSvg(name, size);
  return s;
}
const XDG = { Documents: 'folder-documents', Downloads: 'folder-downloads', Music: 'folder-music', Pictures: 'folder-pictures', Videos: 'folder-videos', Desktop: 'folder-desktop', Templates: 'folder-templates', Public: 'folder-public' };
export function fileIconName(name, isDir) {
  if (isDir) return XDG[name] || 'folder';
  if (/^Forensics Question \d+\.txt$/i.test(name) || /^(README|Scenario README|ScoringReport|Scoring Report)(\.(html?|txt|desktop))?$/i.test(name)) return 'cyberpatriot';
  if (/\.(mp3|ogg|wav|flac|m4a)$/i.test(name)) return 'music';
  if (/\.(mp4|mkv|avi|mov|webm)$/i.test(name)) return 'video';
  if (/\.(png|jpe?g|gif|bmp|svg)$/i.test(name)) return 'image';
  if (/\.html?$/i.test(name)) return 'html';
  if (/\.desktop$/i.test(name)) return 'app';
  return /\.(txt|md|conf|cfg|log|sh|py|csv|ini|b64|list)$/i.test(name) || !/\./.test(name) ? 'text' : 'file';
}
