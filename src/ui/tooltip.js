// Hover tooltips for the simulated desktop. Any element with a `title` attribute gets a themed bubble
// (native title tooltips are suppressed) so hovering over panel icons, buttons, menu items etc. explains them.
import { h } from './dom.js';

export function initTooltips(root = document) {
  let tip = null; let timer = null; let cur = null;
  const hide = () => { clearTimeout(timer); timer = null; if (tip) { tip.remove(); tip = null; } cur = null; };
  const show = (el) => {
    const text = el.getAttribute('data-tip');
    if (!text) return;
    tip = h('div', { id: 'tooltip' }, text);
    (document.getElementById('screen') || document.body).append(tip);
    const r = el.getBoundingClientRect(); const t = tip.getBoundingClientRect();
    const sw = window.innerWidth; const sh = window.innerHeight;
    let x = r.left + r.width / 2 - t.width / 2; x = Math.max(4, Math.min(sw - t.width - 4, x));
    let y = r.bottom + 8; if (y + t.height > sh - 4 || r.top > sh * 0.6) y = r.top - t.height - 8; if (y < 4) y = 4;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  };
  root.addEventListener('mouseover', (e) => {
    autoTip(e.target);
    const el = e.target.closest?.('[title], [data-tip]');
    if (!el || el === cur) return;
    hide();
    const t = el.getAttribute('title');
    if (t) { el.setAttribute('data-tip', t); el.removeAttribute('title'); }
    cur = el;
    timer = setTimeout(() => show(el), 450);
  });
  root.addEventListener('mouseout', (e) => { if (cur && !cur.contains(e.relatedTarget)) hide(); });
  root.addEventListener('mousedown', hide, true);
  root.addEventListener('keydown', hide, true);
}

// Fallback so every control has a tip: a control that was built without a title gets one from its text,
// its current value or its role. Controls that have a hand-written title keep it.
const CONTROL = 'button, select, input:not([type=hidden]), [role=switch], .sw, .tab, .mi, .li, .seg, .dicon, .ti, .tile, .pl, .opt, .dot, .cat, .app';
function autoTip(target) {
  const el = target?.closest?.(CONTROL);
  if (!el || el.closest('[title], [data-tip]') || el.matches('textarea, .term *')) return;
  const text = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
  let tip = '';
  if (el.matches('select')) tip = `Choose an option (now: ${el.options[el.selectedIndex]?.text || ''})`;
  else if (el.matches('input[type=checkbox], input[type=radio]')) tip = el.closest('label')?.textContent.trim() || (el.checked ? 'Selected' : 'Not selected');
  else if (el.matches('input')) tip = el.placeholder || 'Type here';
  else if (el.matches('.sw, [role=switch]')) tip = el.classList.contains('on') ? 'On — click to turn off' : 'Off — click to turn on';
  else if (el.matches('.tab')) tip = `Show the “${text}” tab`;
  else if (el.matches('.mi')) tip = `${text} menu`;
  else if (text && text.length <= 40) tip = /^[+＋]$/.test(text) ? 'Add' : /^[−－-]$/.test(text) ? 'Remove' : text;
  else if (text) tip = text.slice(0, 60) + '…';
  if (tip) el.setAttribute('title', tip);
}
