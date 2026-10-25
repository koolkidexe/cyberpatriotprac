// Stand-in window for applications that exist on the image but are not simulated in detail.
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

const NAMES = { sources: 'Software Sources', printers: 'Print Settings', generic: 'Application' };

export function open(env, opts = {}) {
  const name = opts.title || (opts.name && opts.name !== 'generic' ? opts.name : null) || NAMES[opts.app] || 'Application';
  const content = h('div', { style: { padding: '28px', textAlign: 'center', color: '#4b5256', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px' } },
    icon(opts.icon || 'app', 56), h('h3', { style: { margin: 0 } }, name),
    h('p', { style: { maxWidth: '340px', margin: 0, lineHeight: 1.45 } }, 'This application is installed, but it is not part of the simulated competition surface, so it has no working window in the practice simulator.'));
  return env.wm.open({ title: name, icon: opts.icon || 'app', width: 460, height: 260, content, appId: 'generic' });
}
