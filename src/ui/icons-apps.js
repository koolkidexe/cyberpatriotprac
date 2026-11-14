// Colour (48x48) application / folder / category / file-type icons.
// Each entry is (theme) => svg inner markup.  theme: 'mint' (Mint-Y: rounded gradient tiles, flat green folders)
// or 'yaru' (Ubuntu: round/flat logos, grey folders with an accent flap).
// A "§" in the markup is replaced with a unique number per rendered icon (so gradient ids never clash).

const S = (c, w, extra = '') => `fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra}`;
const FOLDER_MINT = '#8aae55';
const FOLDER_YARU = '#e95420';
const fvar = (d) => `fill="${d}" style="fill:var(--folder,${d})"`;
const lg = (id, c1, c2, x2 = 0, y2 = 1) => `<linearGradient id="${id}§" x1="0" y1="0" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`;

/** Mint-Y style rounded-square tile: vertical gradient, dark hairline edge and a faint inner highlight. */
export const T = (c1, c2 = c1, r = 9) => `<defs>${lg('t', c1, c2)}</defs><rect x="2" y="2" width="44" height="44" rx="${r}" fill="url(#t§)"/><rect x="3" y="3" width="42" height="42" rx="${r - 1}" fill="none" stroke="#fff" stroke-opacity=".16"/><rect x="2.500" y="2.500" width="43" height="43" rx="${r - 0.5}" fill="none" stroke="#000" stroke-opacity=".3"/>`;
const DARK_TILE = () => T('#3b3541', '#221e27');

// ---------------------------------------------------------------- folders
// Emblems are drawn in a -7..7 box around (0,0), stroke based, positioned on the folder front.
const EMB = {
  home: '<path d="M-6.500 0L0-6l6.500 6M-4.500-1.200V6h3.600V2.500h1.800V6h3.600V-1.200"/>',
  documents: '<path d="M-4.500-6.500h6l3.500 3.500v9.500h-9.500z"/><path d="M-2 0h4M-2 2.500h4" stroke-width="1.300"/>',
  downloads: '<path d="M0-6v8.500M-3.500-1.500L0 2l3.500-3.500M-5 6h10"/>',
  music: '<path d="M-2 4.500V-5l6-1.500v9"/><circle cx="-3.500" cy="4.500" r="1.800" fill="currentColor"/><circle cx="2.500" cy="2.700" r="1.800" fill="currentColor"/>',
  pictures: '<rect x="-6" y="-5" width="12" height="10" rx="1"/><path d="M-5.500 4l3.500-3.500 2.500 2.500 2-2 3 3"/>',
  videos: '<rect x="-6" y="-5" width="12" height="10" rx="1"/><path d="M-1.500-2.500l4 2.500-4 2.500z" fill="currentColor"/>',
  desktop: '<rect x="-6.500" y="-5.500" width="13" height="8.500" rx="1"/><path d="M-3 6h6M0 3v3"/>',
  templates: '<path d="M-5-6.500h10v13h-10z"/><path d="M-2.500-3h5M-2.500 0h5M-2.500 3h3"/>',
  public: '<circle cx="0" cy="-3" r="2.500"/><path d="M-5.500 6c0-3 2.500-4.500 5.500-4.500S5.500 3 5.500 6z"/>',
  recent: '<circle r="6"/><path d="M0-3v3.200l2.300 1.500"/>',
};
const emblem = (th, name, cy) => {
  if (!name || !EMB[name]) return '';
  const col = th === 'yaru' ? '#f4f4f4' : '#3b5a1a';
  const op = th === 'yaru' ? '.92' : '.5';
  return `<g transform="translate(24 ${cy})" color="${col}" fill="none" stroke="${col}" stroke-width="1.700" stroke-linecap="round" stroke-linejoin="round" opacity="${op}">${EMB[name]}</g>`;
};

function folder(th, emb, solid = false) {
  if (th === 'yaru') {
    return `<defs>${lg('f', '#b3b3b3', '#8c8c8c')}${lg('a', '#ff7a4f', '#c8350f')}</defs>`
      + `<path d="M4 11.500a3.500 3.500 0 013.500-3.500h8.600c.9 0 1.700.4 2.300 1l1.600 2h20.500a3.500 3.500 0 013.500 3.500V38a3.500 3.500 0 01-3.500 3.500h-33A3.500 3.500 0 014 38z" ${fvar(FOLDER_YARU)}/>`
      + `<path d="M4 18.500a3.500 3.500 0 013.500-3.500h33a3.500 3.500 0 013.500 3.500V38a3.500 3.500 0 01-3.500 3.500h-33A3.500 3.500 0 014 38z" ${solid ? `${fvar(FOLDER_YARU)}` : 'fill="url(#f§)"'}/>`
      + (solid ? '<path d="M4 18.500A3.500 3.500 0 017.500 15h33a3.500 3.500 0 013.500 3.500V22H4z" fill="#fff" opacity=".16"/><path d="M4 36v2a3.500 3.500 0 003.500 3.500h33A3.500 3.500 0 0044 38v-2z" fill="#000" opacity=".16"/>'
        : '<path d="M4 18.500A3.500 3.500 0 017.500 15h33a3.500 3.500 0 013.500 3.500V20H4z" fill="#fff" opacity=".28"/><path d="M4 37v1a3.500 3.500 0 003.500 3.500h33A3.500 3.500 0 0044 38v-1z" fill="#000" opacity=".16"/>')
      + emblem(th, emb, 29.500);
  }
  return `<path d="M6 8.500A1.500 1.500 0 017.500 7h8.800c.5 0 .9.200 1.200.5L19.800 11H6z" fill="#fff"/>`
    + `<path d="M3 12.500a2 2 0 012-2h38a2 2 0 012 2V39a2.500 2.500 0 01-2.500 2.500h-37A2.500 2.500 0 013 39z" ${fvar(FOLDER_MINT)}/>`
    + '<path d="M5 10.500h38a2 2 0 012 2v1.500H3v-1.500a2 2 0 012-2z" fill="#fff" opacity=".5"/><path d="M3 37v2a2.500 2.500 0 002.500 2.500h37A2.500 2.500 0 0045 39v-2z" fill="#000" opacity=".1"/>'
    + emblem(th, emb, 27.500);
}
function folderOpen(th) {
  if (th === 'yaru') {
    return `<defs>${lg('f', '#c4c4c4', '#9a9a9a')}</defs><path d="M4 11.500A3.500 3.500 0 017.500 8h8.600c.9 0 1.700.4 2.300 1l1.600 2h18.500a3.500 3.500 0 013.500 3.500V36H4z" ${fvar(FOLDER_YARU)}/>`
      + '<path d="M9.500 19.500h37.200l-4.600 19.300a3.500 3.500 0 01-3.400 2.700H6.500a3.500 3.500 0 01-3.400-4.300z" fill="url(#f§)"/><path d="M9.500 19.500h37.200l-1.400 5.500H8.100z" fill="#fff" opacity=".22"/>';
  }
  return '<path d="M6 8.500A1.500 1.500 0 017.500 7h8.800c.5 0 .9.200 1.200.5L19.800 11H6z" fill="#fff"/>'
    + '<path d="M3 12.500a2 2 0 012-2h38a2 2 0 012 2V36H3z" fill="#6d8f3d"/>'
    + `<path d="M9 18h38l-4.500 21.200a2.500 2.500 0 01-2.400 2.300H5.500a2.500 2.500 0 01-2.400-3.100z" ${fvar(FOLDER_MINT)}/><path d="M9 18h38l-1.200 5H7.800z" fill="#fff" opacity=".25"/>`;
}

// ---------------------------------------------------------------- document sheets (file types)
const SHEET = '<path d="M11 4h18l9 9v29a2 2 0 01-2 2H11a2 2 0 01-2-2V6a2 2 0 012-2z" fill="#fbfbfb" stroke="#a3acb2" stroke-width="1.600"/><path d="M29 4v7.500a1.500 1.500 0 001.500 1.500H38" fill="#e3e8eb" stroke="#a3acb2" stroke-width="1.600" stroke-linejoin="round"/>';
const sheet = (inner) => SHEET + inner;

// ---------------------------------------------------------------- Firefox
// One hand-built geometry: globe (centre 24.500,27), fox wrapped round it, ears and flame tip.
const FF_BODY = 'M24 12.500c-7.700 0-13.800 6-13.800 13.700 0 8.500 6.600 14.300 14.200 14.300 7.300 0 12.600-4.600 13.600-11 .5-3.200-.1-6.200-1.700-8.700.7.100 1.300.4 1.900.9-.3-3.700-2.600-6.300-5-7.700.7-.8 1.500-1.500 2.400-2.100-2.600-.1-4.600.9-6 2.400-1.800-.9-3.600-1.800-5.600-1.800z';
const firefoxMono = (fg, hole) => `<path d="M11.500 14.500c-.4-2.400-.1-4.600.9-6.300 1.700.6 3.200 1.800 4.200 3.700z" fill="${fg}"/>`
  + `<path d="${FF_BODY}" fill="${fg}"/>`
  + `<circle cx="25.200" cy="27.300" r="7.400" fill="${hole}"/><circle cx="23.600" cy="28.500" r="5.100" fill="${fg}"/>`
  + `<path d="M32.500 20.500c2.800 2.300 4.100 5.200 3.800 8.300" ${S(hole, 1.700)}/><path d="M16 16.500c1.400-1.300 3.200-2.200 5.200-2.600" ${S(hole, 1.100, 'opacity=".5"')}/>`;
const firefoxColour = () => `<defs>${lg('fa', '#ffe226', '#ff8a14', 0.9, 1)}<linearGradient id="fb§" x1="0.8" y1="0" x2="0.1" y2="1"><stop offset="0" stop-color="#ff9a1e"/><stop offset=".55" stop-color="#ff3d3d"/><stop offset="1" stop-color="#d4156a"/></linearGradient>${lg('fc', '#9059ff', '#3b1b94')}</defs>`
  + '<path d="M11.500 14.500c-.4-2.400-.1-4.600.9-6.300 1.700.6 3.200 1.800 4.200 3.700z" fill="#ff9a1e"/>'
  + `<path d="${FF_BODY}" fill="url(#fb§)"/>`
  + '<path d="M24 12.500c-7.700 0-13.800 6-13.800 13.700 0 1.200.2 2.400.5 3.500C12.500 22.500 17 18 22.500 18c3 0 5.500 1.200 7.500 3 .2-3-.8-5.400-2.400-7.500C26.700 12.900 25.400 12.500 24 12.500z" fill="url(#fa§)" opacity=".9"/>'
  + '<circle cx="24.800" cy="27.500" r="9.300" fill="url(#fc§)"/><path d="M16.200 28.500c.4-4.700 4.500-8 9.300-7.700-4.200 1.600-6.300 4.600-5.200 8.500 1 3.500 4.600 5.400 8.600 4.400-2.700 3.500-9 3.600-11.500-.8-.8-1.300-1.200-2.700-1.200-4.400z" fill="#c3a2ff" opacity=".55"/>'
  + '<path d="M33 19.700c2.600 2.400 3.700 5.600 3.300 8.800" fill="none" stroke="#ffd23a" stroke-width="1.600" stroke-linecap="round" opacity=".8"/>';

// ---------------------------------------------------------------- toggles (Mint "Preferences" look)
const toggles = (top, bottom, topKnobRight = true, bottomKnobRight = false) => `<rect x="8" y="11" width="32" height="11" rx="5.500" fill="${top}"/><circle cx="${topKnobRight ? 34.500 : 13.500}" cy="16.500" r="4" fill="#fff"/><rect x="8" y="26" width="32" height="11" rx="5.500" fill="${bottom}"/><circle cx="${bottomKnobRight ? 34.500 : 13.500}" cy="31.500" r="4" fill="#fff"/>`;
const dots = (n, x0, y0, step, r, fill) => `<g fill="${fill}">${Array.from({ length: n * n }, (_, k) => `<circle cx="${(x0 + (k % n) * step).toFixed(2)}" cy="${(y0 + Math.floor(k / n) * step).toFixed(2)}" r="${r}"/>`).join('')}</g>`;

export const APPS = {
  // ---- folders
  folder: (th) => folder(th),
  'folder-open': (th) => folderOpen(th),
  home: (th) => folder(th, 'home'),
  'folder-home': (th) => folder(th, 'home'),
  'folder-documents': (th) => folder(th, 'documents'),
  'folder-downloads': (th) => folder(th, 'downloads'),
  'folder-music': (th) => folder(th, 'music'),
  'folder-pictures': (th) => folder(th, 'pictures'),
  'folder-videos': (th) => folder(th, 'videos'),
  'folder-desktop': (th) => folder(th, 'desktop', th === 'yaru'),
  'folder-templates': (th) => folder(th, 'templates'),
  'folder-public': (th) => folder(th, 'public'),
  'folder-recent': (th) => folder(th, 'recent'),

  // ---- system-ish
  computer: () => '<defs>' + lg('m', '#6d7484', '#555b69') + '</defs><rect x="5" y="6" width="38" height="28" rx="2" fill="#464b58"/><rect x="6.800" y="7.800" width="34.400" height="24.400" rx="1" fill="url(#m§)"/><path d="M6.800 7.800h34.400v6H6.800z" fill="#fff" opacity=".06"/><path d="M20 34h8v5h-8z" fill="#f7f7f7"/><rect x="13" y="38" width="22" height="3.500" rx="1.200" fill="#fafafa"/><path d="M13 40.200h22v1.300H13z" fill="#000" opacity=".12"/>',
  disc: () => '<defs><linearGradient id="d§" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7f7f7"/><stop offset=".45" stop-color="#d4d6da"/><stop offset=".7" stop-color="#f0f0f0"/><stop offset="1" stop-color="#b9bcc2"/></linearGradient></defs><circle cx="24" cy="24" r="19.500" fill="url(#d§)"/><circle cx="24" cy="24" r="19.500" fill="none" stroke="#000" stroke-opacity=".2"/><circle cx="24" cy="24" r="7.500" fill="#e8e8ea"/><circle cx="24" cy="24" r="5" fill="#6a6e76"/><circle cx="24" cy="24" r="2.300" fill="#23252a"/>',
  'show-desktop': () => '<rect x="4" y="7" width="40" height="34" rx="1.500" fill="#8aae55"/><path d="M4 8.500A1.500 1.500 0 015.500 7h37A1.500 1.500 0 0144 8.500V14H4z" fill="#68873f"/><rect x="7" y="9.500" width="3" height="2.200" fill="#fff"/>',
  'mint-logo': () => '<ellipse cx="24" cy="24" rx="19.500" ry="19.500" fill="none" stroke="#fff" stroke-width="3.400"/><path d="M13.500 15.500v15.800c0 1.200 1 2 2 2H31c3 0 5-2 5-5v-4.800c0-2.700-1.800-4.400-4.200-4.400-1.600 0-2.800.8-3.500 1.800-.7-1-1.800-1.800-3.400-1.800-2.600 0-4.400 1.700-4.400 4.400" ' + S('#fff', 3.200) + '/><path d="M20.500 24.200v7" ' + S('#fff', 3.200) + '/>',
  swap: () => `${T('#4a7fc1', '#35639f')}<path d="M10 18h25M29 11.500l7 6.500-7 6.500" ${S('#fff', 3.600)}/><path d="M38 31H13M19 24.500L12 31l7 6.500" ${S('#fff', 3.600)}/>`,
  gear: (th) => (th === 'yaru'
    ? '<defs>' + lg('g', '#dedede', '#b9b9b9') + '</defs><circle cx="24" cy="24" r="19.500" fill="none" stroke="#9c9c9c" stroke-width="4.600" stroke-dasharray="5.100 5.100" transform="rotate(7.500 24 24)"/><circle cx="24" cy="24" r="17.500" fill="url(#g§)"/><circle cx="24" cy="24" r="12" fill="none" stroke="#7a7a7a" stroke-width="2.200"/><circle cx="24" cy="24" r="9" fill="#e9e9e9" stroke="#8d8d8d" stroke-width="1.400"/><circle cx="24" cy="24" r="4.200" fill="#8a8a8a"/><circle cx="24" cy="24" r="2" fill="#e9e9e9"/>'
    : `${T('#f4f4f2', '#d8d8d4')}${toggles('#77b43f', '#a9a9a6')}`),
  software: () => `${T('#f1f1ee', '#d6d6d2')}<circle cx="24" cy="24" r="16" fill="#6cb23a"/><circle cx="24" cy="24" r="16" fill="none" stroke="#000" stroke-opacity=".12"/>${dots(4, 17.500, 17.500, 4.700, 1.500, '#fff')}`,
  bag: (th) => APPS[th === 'yaru' ? 'ubuntu-software' : 'software'](th),
  'ubuntu-software': () => `${T('#ee3d52', '#cf2238', 10)}<path d="M13 37L24 14l11 23M17.500 29.500h13" ${S('#fff', 4.600)}/><path d="M18.500 16.500V15a5.500 5.500 0 0111 0v1.500" ${S('#fff', 2.800)}/>`,
  lock: () => `${DARK_TILE()}<rect x="12" y="21" width="24" height="18" rx="2.500" fill="#fff"/><path d="M16.500 21v-4.500a7.500 7.500 0 0115 0V21" ${S('#fff', 3.800)}/><circle cx="24" cy="29.500" r="2.200" fill="#3b3541"/>`,
  logout: () => `${DARK_TILE()}<path d="M31.500 15.500A11.500 11.500 0 1035.500 24" ${S('#fff', 3.600)}/><path d="M24.500 24H37" ${S('#fff', 3.600)}/>`,
  power: () => `${T('#ea3a2e', '#bd1d14')}<path d="M24 10.500v12.500" ${S('#fff', 4)}/><path d="M15.500 16.500a12 12 0 1017 0" ${S('#fff', 4)}/>`,
  update: () => `${T('#4a90e2', '#2f6fc0')}<path d="M35.500 19a12.500 12.500 0 00-22.500-2" ${S('#fff', 3.800)}/><path d="M12.500 29a12.500 12.500 0 0022.500 2" ${S('#fff', 3.800)}/><path d="M37.500 9.500v10.500H27zM10.500 38.500V28H21z" fill="#fff"/>`,
  refresh: () => APPS.update(),
  shield: () => `${T('#4aa86b', '#2f8650')}<path d="M24 8l13 4.500v10c0 8-5.500 13.500-13 17-7.500-3.500-13-9-13-17v-10z" fill="#fff"/><path d="M17.500 24l5 5 8.500-9.500" ${S('#2f8650', 4)}/>`,
  users: () => `${T('#5b8cc4', '#41689f')}<circle cx="18" cy="17.500" r="6" fill="#fff"/><path d="M7 38c0-7 5-11 11-11s11 4 11 11z" fill="#fff"/><circle cx="33" cy="20" r="4.800" fill="#fff" opacity=".7"/><path d="M28.500 29c6.500-.8 12.500 2 12.500 9H31c0-3-1-6-2.500-9z" fill="#fff" opacity=".7"/>`,
  login: () => `${T('#58698a', '#3f4d6a')}<rect x="8" y="10" width="32" height="22" rx="3" fill="#fff"/><circle cx="24" cy="18" r="4" fill="#4a5a7a"/><path d="M16 28c0-5 4-7 8-7s8 2 8 7z" fill="#4a5a7a"/><path d="M16 38h16" ${S('#fff', 3)}/>`,
  startup: () => `${T('#ee9a38', '#cf7a1a')}<path d="M24 8c7 4 10 12 8 21l-5 5h-6l-5-5c-2-9 1-17 8-21z" fill="#fff"/><circle cx="24" cy="19.500" r="3.500" fill="#d98524"/><path d="M16 31l-5 7 8-2M32 31l5 7-8-2" fill="#fff" opacity=".8"/>`,
  pulse: () => `${T('#d8503e', '#b5301f')}<rect x="8" y="10" width="32" height="24" rx="3" fill="#fff"/><path d="M11 26h6l3-8 5 12 4-9 2 5h7" ${S('#c8402f', 3)}/><path d="M18 40h12" ${S('#fff', 3)}/>`,
  disk: () => `${T('#8b999a', '#6c7b7c')}<rect x="7" y="15" width="34" height="19" rx="3" fill="#fff"/><circle cx="35" cy="24.500" r="2.500" fill="#7c8a8b"/><path d="M12 24.500h14" ${S('#7c8a8b', 3)}/>`,
  printer: () => `${T('#8b999a', '#6c7b7c')}<path d="M15 8h14l4 4v8H15z" fill="#fff"/><rect x="7" y="19" width="34" height="16" rx="3" fill="#fff"/><rect x="14" y="29" width="20" height="12" fill="#e6ebee" stroke="#7c8a8b" stroke-width="2"/><circle cx="35" cy="24" r="1.500" fill="#7c8a8b"/>`,
  net: () => `${T('#5f8dc0', '#436f9f')}<path d="M7 20a24 24 0 0134 0M13 26.500a15 15 0 0122 0M19 33a7 7 0 0110 0" ${S('#fff', 3.800)}/><circle cx="24" cy="38" r="2.600" fill="#fff"/>`,
  volume: () => `${T('#5f8dc0', '#436f9f')}<path d="M9 20h6.500l9-7v22l-9-7H9z" fill="#fff"/><path d="M31 19a8 8 0 010 10M35 14a14 14 0 010 20" ${S('#fff', 3.400)}/>`,
  app: () => `${T('#8b999a', '#6c7b7c')}<g fill="#fff"><rect x="10" y="10" width="11" height="11" rx="2"/><rect x="27" y="10" width="11" height="11" rx="2"/><rect x="10" y="27" width="11" height="11" rx="2"/><rect x="27" y="27" width="11" height="11" rx="2" opacity=".6"/></g>`,
  key: () => `${T('#ee9a38', '#cf7a1a')}<circle cx="17" cy="24" r="8" fill="#fff"/><circle cx="17" cy="24" r="3" fill="#d98524"/><path d="M24 24h16M34 24v6M39 24v4" ${S('#fff', 4)}/>`,
  score: () => `${T('#4aa86b', '#2f8650')}<rect x="9" y="9" width="30" height="30" rx="4" fill="#fff"/><path d="M14 30l6-6 5 4 9-11" ${S('#2f8650', 3.800)}/>`,
  cyberpatriot: () => `${T('#143761', '#0b2140')}<path d="M24 7l15 5v10c0 9-6 16-15 20C15 38 9 31 9 22V12z" fill="#fff"/><path d="M24 10.500l12 4v8c0 7.500-5 13.500-12 16.500C17 35.500 12 29.500 12 22.500v-8z" fill="#1f4e8c"/><path d="M24 15l2.400 5.100 5.600.7-4.100 3.900 1 5.500L24 27.600l-4.900 2.600 1-5.500-4.100-3.900 5.600-.7z" fill="#f2c230"/>`,
  trash: (th) => '<defs>' + lg('b', '#e6e6e6', '#bdbdbd') + '</defs><path d="M10.500 14h27l-2.200 25.500a2.800 2.800 0 01-2.800 2.500H15.500a2.800 2.800 0 01-2.800-2.500z" fill="url(#b§)" stroke="#8d8d8d" stroke-width="1.200"/><rect x="7.500" y="9.500" width="33" height="5" rx="2" fill="#d2d2d2" stroke="#8d8d8d" stroke-width="1.200"/><path d="M19 9.500V8a1.500 1.500 0 011.500-1.500h7A1.500 1.500 0 0129 8v1.500" fill="none" stroke="#8d8d8d" stroke-width="2"/>'
    + (th === 'yaru' ? '<path d="M21.500 34.500l-2.500-4.200 2.300-3.800h3M26.500 34.800h-5M29.300 29l2.200 3.900-3.300 1.800" fill="none" stroke="#4fa23a" stroke-width="2.200" stroke-linecap="round" stroke-linejoin="round"/>' : '<path d="M20 21v15M24 21v15M28 21v15" stroke="#9b9b9b" stroke-width="2" stroke-linecap="round"/>'),
  reshuffle: () => `${T('#3e8ed0', '#2a6fae')}<path d="M35 19a12 12 0 00-21.500-4.500" ${S('#fff', 3.600)}/><path d="M13 29a12 12 0 0021.500 4.500" ${S('#fff', 3.600)}/><path d="M36.500 10v9.500H27M11.500 38v-9.500H21" ${S('#fff', 3.600)}/>`,
  cards: () => `${T('#2f8a4e', '#1e6b39')}<rect x="10" y="12" width="18" height="25" rx="2.5" fill="#fff" transform="rotate(-12 19 24)"/><rect x="20" y="11" width="18" height="25" rx="2.5" fill="#fff" stroke="#1e6b39" stroke-width="1" transform="rotate(10 29 23)"/><path d="M29.500 18.500c-2-2.500-5.500-.5-4 2.500l4 4.500 4-4.500c1.500-3-2-5-4-2.500z" fill="#d63a2f" transform="rotate(10 29 23)"/>`,
  appgrid: () => dots(3, 11.500, 11.500, 12.500, 3.300, '#fff'),

  // ---- browsers / mail / media
  firefox: (th) => (th === 'yaru' ? firefoxColour() : `${T('#ff8248', '#ec5a22')}${firefoxMono('#fff', '#f2662f')}`),
  chromium: () => {
    const p = (a) => [24 + 19.500 * Math.cos((a * Math.PI) / 180), 24 + 19.500 * Math.sin((a * Math.PI) / 180)].map((n) => n.toFixed(2));
    const sec = (a1, a2, c) => { const [x1, y1] = p(a1); const [x2, y2] = p(a2); return `<path d="M24 24L${x1} ${y1}A19.500 19.500 0 0 1 ${x2} ${y2}Z" fill="${c}"/>`; };
    return `<circle cx="24" cy="24" r="19.500" fill="#fff"/>${sec(-150, -30, '#e8453c')}${sec(-30, 90, '#f9bb2a')}${sec(90, 210, '#1fa463')}<path d="M24 24l-17-9.800a19.500 19.500 0 000 .1z" fill="none"/><circle cx="24" cy="24" r="10.500" fill="#fff"/><circle cx="24" cy="24" r="8" fill="#4285f4"/><circle cx="24" cy="24" r="19.500" fill="none" stroke="#000" stroke-opacity=".12"/>`;
  },
  mail: () => `${T('#4a98d8', '#2f78bb')}<rect x="7" y="12" width="34" height="24" rx="3" fill="#fff"/><path d="M9 15l15 11 15-11" ${S('#3a86c8', 3)}/>`,
  thunderbird: () => '<defs>' + lg('tb', '#3b9cf0', '#1757b8') + '</defs><path d="M24 4.500c-8.300 0-14.800 5.500-17 12.500-1.500 4.800-.6 10.800 3 15.200 4 4.800 11 8.300 17.500 7.300C35.500 38.500 42 32 42 22.500 42 12.500 34 4.500 24 4.500z" fill="url(#tb§)"/><path d="M10.500 21.500c1.500-6 6.500-10 12-10.500C17 13 13.500 17 12 22.500z" fill="#fff" opacity=".18"/><rect x="14" y="21" width="24" height="16" rx="2.500" fill="#fff"/><path d="M15 23l11 8.500L37 23" ' + S('#2a7ad0', 2.200) + '/><path d="M12.500 20c-3-1.500-4.500 1-3 3.500" ' + S('#fff', 1.800, 'opacity=".5"') + '/>',
  music: () => sheet('<path d="M20 33V17l11-2.500V30" fill="none" stroke="#9b59b6" stroke-width="2.600" stroke-linejoin="round"/><circle cx="17" cy="33" r="3.800" fill="#9b59b6"/><circle cx="28" cy="30.500" r="3.800" fill="#9b59b6"/>'),
  video: () => sheet('<rect x="15" y="17" width="18" height="16" rx="2" fill="#3b4a5c"/><path d="M15 21.500h18M15 28.500h18" stroke="#fff" stroke-width="1" stroke-dasharray="2 2.500"/><path d="M22 21.500l6 3.500-6 3.500z" fill="#fff"/>'),
  image: () => sheet('<rect x="14.500" y="17" width="19" height="16" rx="1.500" fill="#cfe6f7" stroke="#4b93c9" stroke-width="1.400"/><circle cx="20" cy="22" r="2.300" fill="#f5b83a"/><path d="M15 32l6.500-6.500 4.500 4.500 3-3 4.500 5z" fill="#4faa5a"/>'),
  rhythmbox: () => '<defs>' + lg('r', '#fffdf6', '#e9e2cc') + '</defs><rect x="8" y="4" width="32" height="40" rx="5" fill="url(#r§)" stroke="#b9ad88" stroke-width="1.200"/><circle cx="24" cy="26" r="13" fill="#262626"/><circle cx="24" cy="26" r="11" fill="#f5c211"/><circle cx="24" cy="26" r="5.200" fill="#262626"/><circle cx="24" cy="26" r="1.800" fill="#f5c211"/><rect x="19" y="9" width="10" height="1.800" rx=".9" fill="#7a7260"/>',
  writer: () => '<path d="M11 4h19l9 9v29a2 2 0 01-2 2H11a2 2 0 01-2-2V6a2 2 0 012-2z" fill="#fbfdff" stroke="#9fb7cc" stroke-width="1.500"/><path d="M30 4v7.500a1.500 1.500 0 001.500 1.500H39" fill="#dbe7f1" stroke="#9fb7cc" stroke-width="1.500" stroke-linejoin="round"/><rect x="14" y="15" width="12" height="10" rx="1" fill="#2b88d8"/><path d="M17 20h6M17 22.500h4" stroke="#fff" stroke-width="1.200" stroke-linecap="round"/><path d="M14 30h21M14 34h21M14 38h13" stroke="#6fa8dc" stroke-width="1.800" stroke-linecap="round"/>',
  calc: () => `${T('#34b57a', '#1f9660')}<rect x="11" y="7" width="26" height="34" rx="3" fill="#fff"/><rect x="15" y="11" width="18" height="8" rx="1" fill="#1f9660"/><g fill="#1f9660"><circle cx="18" cy="26" r="2.300"/><circle cx="24" cy="26" r="2.300"/><circle cx="30" cy="26" r="2.300"/><circle cx="18" cy="33" r="2.300"/><circle cx="24" cy="33" r="2.300"/><circle cx="30" cy="33" r="2.300"/></g>`,
  text: () => sheet('<path d="M15 20h18M15 25h18M15 30h18M15 35h10" stroke="#6b7a82" stroke-width="2" stroke-linecap="round"/>'),
  gedit: () => `${T('#f7f7f5', '#e0e0dc')}<path d="M12 8h18l7 7v25H12z" fill="#fff" stroke="#b3bcc1" stroke-width="1.400"/><path d="M16 21h17M16 26h17M16 31h11" stroke="#8c979d" stroke-width="2" stroke-linecap="round"/><path d="M33 16l-14 14-2 6 6-2 14-14z" fill="#e9a330" stroke="#a36d10" stroke-width="1.200" stroke-linejoin="round"/>`,
  xed: () => APPS.gedit(),
  file: () => sheet('<path d="M15 24h18M15 29h18M15 34h11" stroke="#b9c3c9" stroke-width="2" stroke-linecap="round"/>'),
  html: () => sheet('<path d="M20 22l-5 6 5 6M28 22l5 6-5 6" fill="none" stroke="#e8710a" stroke-width="2.600" stroke-linecap="round" stroke-linejoin="round"/>'),

  // ---- dialog icons
  warn: () => '<path d="M24 5.500l19.500 34a1.800 1.800 0 01-1.600 2.700H6.100A1.800 1.800 0 014.500 39.500z" fill="#eca800" stroke="#b98200" stroke-width="1.200" stroke-linejoin="round"/><path d="M24 17.500v11" stroke="#fff" stroke-width="4" stroke-linecap="round"/><circle cx="24" cy="34.500" r="2.500" fill="#fff"/>',
  info: () => '<circle cx="24" cy="24" r="18.500" fill="#3b82d6"/><circle cx="24" cy="24" r="18.500" fill="none" stroke="#000" stroke-opacity=".15"/><path d="M24 21.500v12" stroke="#fff" stroke-width="4" stroke-linecap="round"/><circle cx="24" cy="14.500" r="2.800" fill="#fff"/>',
  error: () => '<circle cx="24" cy="24" r="18.500" fill="#d23b2c"/><circle cx="24" cy="24" r="18.500" fill="none" stroke="#000" stroke-opacity=".15"/><path d="M17 17l14 14M31 17L17 31" stroke="#fff" stroke-width="4.500" stroke-linecap="round"/>',
  question: () => '<circle cx="24" cy="24" r="18.500" fill="#3b82d6"/><circle cx="24" cy="24" r="18.500" fill="none" stroke="#000" stroke-opacity=".15"/><path d="M18 20c0-4 3-6 6-6s6 2 6 5c0 4-6 4-6 9" fill="none" stroke="#fff" stroke-width="3.800" stroke-linecap="round"/><circle cx="24" cy="35" r="2.600" fill="#fff"/>',

  // ---- Calendar / Library / LibreOffice family (Mint menu)
  calendar: () => `<defs>${lg('c', '#ffffff', '#e4e4e1')}</defs><rect x="2" y="2" width="44" height="44" rx="9" fill="url(#c§)"/><path d="M2 11a9 9 0 019-9h26a9 9 0 019 9v6H2z" fill="#e5362b"/><path d="M2 11a9 9 0 019-9h26a9 9 0 019 9v1H2z" fill="#fff" opacity=".16"/><g fill="#c4c4c0"><rect x="9" y="23" width="6" height="5" rx="1"/><rect x="21" y="23" width="6" height="5" rx="1"/><rect x="33" y="23" width="6" height="5" rx="1"/><rect x="9" y="32" width="6" height="5" rx="1"/><rect x="21" y="32" width="6" height="5" rx="1"/></g><rect x="2.500" y="2.500" width="43" height="43" rx="8.500" fill="none" stroke="#000" stroke-opacity=".3"/>`,
  library: () => `${T('#ee4338', '#c4251c')}<path d="M11 17a2.500 2.500 0 012.500-2.500h11.500l11.500 11.500-11 11L13 25.500a2.500 2.500 0 01-.7-1.700z" fill="#fff"/><circle cx="18.500" cy="20" r="2.400" fill="#d92f25"/><path d="M27 12l12 12" stroke="#fff" stroke-width="2.200" stroke-linecap="round" opacity=".75"/>`,
  libreoffice: () => `${T('#7b7b7b', '#565656')}<path d="M14 8h13l8 8v24H14z" fill="#fff"/><path d="M27 8v8h8z" fill="#cdcdcd"/>`,
  'lo-base': () => `${T('#b543cc', '#8a1fa3')}<ellipse cx="24" cy="14.500" rx="10" ry="4" fill="#fff"/><path d="M14 19c0 2.200 4.500 4 10 4s10-1.800 10-4v4.500c0 2.200-4.500 4-10 4s-10-1.800-10-4zM14 28.500c0 2.200 4.500 4 10 4s10-1.800 10-4V33c0 2.200-4.500 4-10 4s-10-1.800-10-4z" fill="#fff"/>`,
  'lo-calc': () => `${T('#3cc43a', '#20961f')}<rect x="9.500" y="12" width="29" height="24" rx="2" fill="#fff"/><path d="M9.500 20h29M9.500 28h29M19.200 12v24M28.800 12v24" stroke="#2fa92d" stroke-width="2.200"/>`,
  'lo-draw': () => `${T('#f4c23a', '#d29a10')}<circle cx="19" cy="19" r="7" fill="none" stroke="#fff" stroke-width="2.600"/><path d="M12 38l8-13 8 13z" fill="none" stroke="#fff" stroke-width="2.600" stroke-linejoin="round"/><rect x="27" y="23" width="11" height="11" fill="none" stroke="#fff" stroke-width="2.600"/>`,
  'lo-impress': () => `${T('#dc6a2a', '#b34410')}<rect x="9" y="12" width="21" height="14" fill="none" stroke="#fff" stroke-width="2.600"/><rect x="18" y="22" width="21" height="14" fill="#c5521b" stroke="#fff" stroke-width="2.600"/>`,
  'lo-math': () => `${T('#858585', '#5e5e5e')}<path d="M9.500 27l3-2 4 10 6-20H39" ${S('#fff', 2.600)}/><path d="M26 25l8 9M34 25l-8 9" ${S('#fff', 2.600)}/>`,
  'lo-writer': () => `${T('#2a9ae8', '#0f6fbd')}<path d="M12 14h24M12 20h24M12 26h24M12 32h14" ${S('#fff', 3)}/>`,

  // ---- Mint menu categories
  'cat-all': () => dots(4, 10, 10, 9.300, 2.300, '#d4d4d4'),
  'cat-accessories': () => `${T('#6cb4fa', '#3b8be0')}<circle cx="17" cy="35" r="4.500" fill="none" stroke="#fff" stroke-width="2.800"/><circle cx="31" cy="35" r="4.500" fill="none" stroke="#fff" stroke-width="2.800"/><path d="M19 31L32 10M29 31L16 10" ${S('#fff', 3)}/>`,
  'cat-graphics': () => `<defs><linearGradient id="gA§" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6a2cc9"/><stop offset=".5" stop-color="#e0267a"/><stop offset="1" stop-color="#f6a21d"/></linearGradient><linearGradient id="gB§" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2ec4e8" stop-opacity="0"/><stop offset=".55" stop-color="#2ec4e8" stop-opacity="0"/><stop offset="1" stop-color="#37d34c" stop-opacity=".95"/></linearGradient></defs><rect x="2" y="2" width="44" height="44" rx="9" fill="url(#gA§)"/><rect x="2" y="2" width="44" height="44" rx="9" fill="url(#gB§)"/><rect x="3" y="3" width="42" height="42" rx="8" fill="none" stroke="#fff" stroke-opacity=".16"/><rect x="2.500" y="2.500" width="43" height="43" rx="8.500" fill="none" stroke="#000" stroke-opacity=".3"/>`,
  'cat-internet': () => `${T('#4cbcf2', '#2490dc')}<path d="M16.500 37a8.500 8.500 0 01-1.600-16.800 10.500 10.500 0 0120-.5A7.700 7.700 0 0134 37z" fill="#fff"/>`,
  'cat-office': () => `${T('#46832f', '#2d5f1c')}<rect x="10" y="13" width="18" height="21" fill="#fff"/><path d="M31 17h7M31 23h7M31 29h7" stroke="#fff" stroke-width="2.200"/><path d="M13 18h8v5h-8zM13 28h12" stroke="#2d5f1c" stroke-width="2.200" fill="#2d5f1c"/>`,
  'cat-sound-video': () => `${T('#f23a54', '#cc1f38')}<path d="M17 12l19 12-19 12z" fill="#fff"/>`,
  'cat-admin': () => `${T('#f1f1ee', '#d4d4d0')}${toggles('#b7b7b4', '#b7b7b4', false, true)}`,
  'cat-prefs': () => `${T('#f4f4f2', '#d8d8d4')}${toggles('#77b43f', '#a9a9a6', true, false)}`,
  'cat-places': (th) => folder(th),
  'cat-recent': (th) => folder(th, 'recent'),
};
