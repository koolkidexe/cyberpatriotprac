// Mozilla Thunderbird (Windows): spaces toolbar, Home tab with "Set up an account", the ≡ app menu and
// Help > About Thunderbird, whose "Update to X" / "Restart to update Thunderbird" flow really upgrades the program.
import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { elevate } from '../ui/win-shell.js';
import * as S from '../win/state.js';

const ID = 'Mozilla.Thunderbird';

export function open(env, opts = {}) {
  const sys = env.sys;
  const prog = () => S.listPrograms(sys).find((p) => p.id === ID);
  if (!prog() || !sys.vfs.exists('/Program Files/Mozilla Thunderbird/thunderbird.exe')) {
    env.ui.alert({ title: 'Mozilla Thunderbird', heading: 'Windows cannot find thunderbird.exe', message: 'Mozilla Thunderbird is not installed on this computer.', icon: 'w-warn' });
    return null;
  }
  let tab = 'home';
  const main = h('div', { class: 'tb-main' });
  const bar = h('div', { class: 'tb-telem' }, h('span', null, 'Mozilla Thunderbird automatically sends some data to Mozilla so that we can improve your experience.'), h('button', { class: 'tb-btn', onclick: () => bar.remove() }, 'Choose What I Share'), h('span', { class: 'tb-x', title: 'Close', onclick: () => bar.remove() }, '✕'));
  const space = (ic, t, k) => h('div', { class: `tb-space${tab === k ? ' on' : ''}`, title: t, onclick: () => { tab = k; render(); } }, ic);
  const spaces = h('div', { class: 'tb-spaces' });
  const appMenu = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    env.ui.showMenu(r.right - 220, r.bottom, [
      { label: 'New Message', disabled: true }, { label: 'New Account', action: () => { tab = 'home'; render(); } }, 'sep',
      { label: 'Add-ons and Themes', disabled: true }, { label: 'Settings', action: () => { tab = 'settings'; render(); } }, { label: 'Account Settings', disabled: true }, 'sep',
      { label: 'Help ›', action: () => env.ui.showMenu(r.right - 440, r.bottom + 160, [{ label: 'Get Help', disabled: true }, { label: 'Share Ideas and Feedback…', disabled: true }, 'sep', { label: 'Troubleshoot Mode…', disabled: true }, { label: 'Troubleshooting Information', disabled: true }, 'sep', { label: 'About Thunderbird', action: about }]) },
      { label: 'Exit', action: () => win.close() },
    ]);
  };
  const tabs = h('div', { class: 'tb-tabs' });
  const root = h('div', { class: 'tb' },
    h('div', { class: 'tb-top' }, tabs, h('div', { style: { flex: 1 } }), h('input', { class: 'tb-search', placeholder: 'Search… Ctrl+K', title: 'Search' }), h('button', { class: 'tb-menu', title: 'Thunderbird menu', onclick: appMenu }, '≡')),
    bar, h('div', { class: 'tb-body' }, spaces, main));
  const win = env.wm.open({ title: 'Mozilla Thunderbird', icon: 'w-thunderbird', width: 1000, height: 640, appId: 'thunderbird', content: root });

  function render() {
    clear(spaces); clear(main); clear(tabs);
    spaces.append(space('✉', 'Mail', 'home'), space('👤', 'Address Book', 'ab'), space('📅', 'Calendar', 'cal'), space('☑', 'Tasks', 'tasks'), space('💬', 'Chat', 'chat'), h('div', { style: { flex: 1 } }), space('⚙', 'Settings', 'settings'));
    tabs.append(h('div', { class: 'tb-tab on' }, tab === 'home' ? 'Home' : tab === 'ab' ? 'Address Book' : tab === 'cal' ? 'Calendar' : tab === 'tasks' ? 'Tasks' : tab === 'chat' ? 'Chat' : 'Settings'));
    if (tab === 'home') home();
    else if (tab === 'cal') calendar();
    else if (tab === 'settings') settings();
    else main.append(h('div', { class: 'tb-empty' }, icon('w-thunderbird', 64), h('div', null, 'Nothing here yet. Set up an account first.')));
  }
  function home() {
    const p = prog();
    const card = (ic, t) => h('button', { class: 'tb-card', onclick: () => env.ui.alert({ title: 'Account Setup', heading: `${t} account setup`, message: 'This practice image has no network mail server, so there is nothing to connect to. Account setup is not needed for any scored task.', icon: 'w-info' }) }, h('span', { class: 'tb-ci' }, ic), t);
    main.append(h('div', { class: 'tb-folders' }, h('div', { class: 'tb-fh' }, 'Folders'), h('div', { class: 'tb-f on' }, '🏠 Local Folders'), h('div', { class: 'tb-f' }, '🗑 Trash'), h('div', { class: 'tb-f' }, '📤 Outbox')),
      h('div', { class: 'tb-home' },
        h('div', { class: 'tb-hero' }, icon('w-thunderbird', 54), h('div', null, h('div', { class: 'tb-h1' }, 'Thunderbird'), h('div', { class: 'tb-sub' }, `Version ${p.version}`))),
        h('div', { class: 'tb-sec' }, 'Set up an account'), h('div', { class: 'tb-cards' }, card('✉', 'Email'), card('📅', 'Calendar'), card('👤', 'Address Book'), card('💬', 'Chat'), card('📰', 'Newsgroups'), card('📡', 'Feeds')),
        h('div', { class: 'tb-sec' }, 'Import from Another Program'), h('div', { class: 'tb-p' }, 'Thunderbird lets you import mail messages, address book entries, feed subscriptions, settings, and/or filters from other mail programs and common address book formats.'),
        h('div', { class: 'tb-sec' }, 'About Mozilla Thunderbird'), h('div', { class: 'tb-p' }, 'Thunderbird is the leading open source, cross-platform email and calendaring client, free for business and personal use.')),
      h('div', { class: 'tb-events' }, h('div', { class: 'tb-fh' }, 'Events'), h('button', { class: 'tb-btn' }, '+ New Event'), h('div', { class: 'tb-p' }, 'Today'), h('div', { class: 'tb-p', style: { color: '#777' } }, 'No upcoming events')));
  }
  function calendar() {
    main.append(h('div', { class: 'tb-home' }, h('div', { class: 'tb-sec' }, 'Calendar'), h('div', { class: 'tb-p' }, 'Home (local calendar)'), h('button', { class: 'tb-btn' }, 'Create a new calendar')));
  }
  function settings() {
    const cb = (t, on) => h('label', { class: 'tb-p', style: { display: 'flex', gap: '8px' } }, h('input', { type: 'checkbox', checked: on }), t);
    main.append(h('div', { class: 'tb-home' }, h('div', { class: 'tb-h1', style: { fontSize: '22px' } }, 'General'),
      h('div', { class: 'tb-sec' }, 'Thunderbird Updates'), h('div', { class: 'tb-p' }, `Version ${prog().version}`), h('button', { class: 'tb-btn', onclick: about }, 'Check for Updates'),
      h('div', { class: 'tb-sec' }, 'Privacy & Security'), cb('Block remote content in messages', true), cb('Tell websites that I do not want to be tracked', false), cb('Warn me when I attempt to install add-ons', true)));
  }
  async function about() {
    const p = prog();
    let state = !p.latest || p.latest === p.version ? 'current' : 'available';
    const body = h('div');
    const draw = () => {
      clear(body);
      const q = prog();
      body.append(h('div', { style: { fontSize: '13px', marginBottom: '10px' } }, `${q.version} (64-bit)`));
      if (state === 'current') body.append(h('div', null, 'Thunderbird is up to date'));
      else if (state === 'available') body.append(h('button', { class: 'w-btn primary', onclick: async () => { state = 'downloading'; draw(); setTimeout(() => { state = 'ready'; draw(); }, 900); } }, `Update to ${q.latest}`));
      else if (state === 'downloading') body.append(h('div', null, 'Downloading update — ', h('progress', { max: 100, value: 60, style: { width: '160px' } })));
      else if (state === 'ready') body.append(h('button', { class: 'w-btn primary', onclick: async () => {
        done && done(true);
        if (!(await elevate(env, { what: 'Mozilla Maintenance Service' }))) return;
        S.upgradeProgram(sys, q); win.close();
        env.ui.toast({ title: 'Mozilla Thunderbird', message: `Thunderbird was updated to ${q.version}.`, kind: 'info' });
        setTimeout(() => env.openApp('thunderbird', {}), 300);
      } }, 'Restart to update Thunderbird'));
      body.append(h('p', { style: { fontSize: '12px', color: "#c9d4ea", marginTop: "14px" } }, 'Thunderbird is designed by MZLA Technologies Corporation, a global community working together to keep the Internet open, public and accessible to all.'), h('p', { style: { fontSize: '12px' } }, 'Update channel: release'));
    };
    let done = null;
    draw();
    await env.ui.modal((d) => { done = d; return h('div', { class: 'w-dlg', style: { width: '520px' } }, h('div', { class: 'wd-t' }, h('span', null, 'About Mozilla Thunderbird'), h('span', { onclick: () => d(false) }, '✕')),
      h('div', { style: { display: 'flex', gap: '18px', padding: '18px', background: 'linear-gradient(#1d3a6e,#12254a)', color: '#fff' } }, icon('w-thunderbird', 72), h('div', { style: { flex: 1 } }, h('div', { style: { fontSize: '26px', fontWeight: 300 } }, 'Thunderbird'), body))); });
  }
  render();
  return win;
}
