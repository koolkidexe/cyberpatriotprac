// Original generic SVG icons (no third-party logos).
const COLORS = { terminal: '#3b3b3b', files: '#e0a83a', browser: '#e8742c', editor: '#4a90c2', score: '#87a752', settings: '#7a7a8c', users: '#a863b8', shield: '#c0504d', update: '#3a9a8a', software: '#d4772c', monitor: '#4f7fbf', doc: '#d9d9d9', folder: '#e0a83a', file: '#eeeeee', generic: '#7d8a99', mint: '#87a752' };
const GLYPH = { terminal: '>_', files: '▤', browser: '◎', editor: '✎', score: '★', settings: '⚙', users: '☻', shield: '⛨', update: '↻', software: '▣', monitor: '∿', doc: '≡', folder: '', file: '≡', generic: '◆', mint: 'm' };
export function icon(kind = 'generic') {
  const c = COLORS[kind] || COLORS.generic; const g = GLYPH[kind] ?? '◆';
  const fg = ['doc', 'file'].includes(kind) ? '#555' : '#fff';
  const body = kind === 'folder' ? `<path d="M6 16h20l4 5h28v33H6z" fill="${c}"/><path d="M6 26h52v28H6z" fill="#f0c25a"/>` : `<rect x="4" y="4" width="56" height="56" rx="${kind === 'doc' || kind === 'file' ? 6 : 14}" fill="${c}"/><text x="32" y="43" font-size="${g.length > 1 ? 24 : 32}" text-anchor="middle" fill="${fg}" font-family="DejaVu Sans,Arial,sans-serif" font-weight="bold">${g}</text>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`);
}
export const kindFor = (name = '') => (/terminal/.test(name) ? 'terminal' : /nemo|files/.test(name) ? 'files' : /firefox|browser/.test(name) ? 'browser' : /xed|editor|text/.test(name) ? 'editor' : /score|report/.test(name) ? 'score' : /user/.test(name) ? 'users' : /gufw|firewall/.test(name) ? 'shield' : /update/.test(name) ? 'update' : /install|software/.test(name) ? 'software' : /monitor/.test(name) ? 'monitor' : /settings/.test(name) ? 'settings' : 'generic');
