// CyberPatriot-style scoring engine. Each vulnerability is a pure check over the System; the engine
// re-evaluates after changes, keeps the set of "found" items, and emits gain/loss/penalty events.
import { fmtDate } from './util.js';

export class ScoringEngine {
  /**
   * @param sys System
   * @param scenario {id,title,os,vulns[],penalties[],timeLimitMin}
   * @param opts {delayMs: seconds-to-ms delay before a fix is credited (realistic mode), now}
   */
  constructor(sys, scenario, { delayMs = 0, now = () => sys.now() } = {}) {
    this.sys = sys;
    this.scenario = scenario;
    this.delayMs = delayMs;
    this.now = now;
    this.found = new Map();      // id -> {at}
    this.penalized = new Map();  // id -> {at}
    this.pending = new Map();    // id -> firstSeen (waiting out the scoring delay)
    this.startedAt = now();
    this.listeners = new Map();
    this._timer = null;
    this._interval = null;
    this._evaluating = false;
    this.history = [];           // last N events, newest last
  }

  // ------------------------------------------------------------ events
  on(evt, fn) {
    if (!this.listeners.has(evt)) this.listeners.set(evt, new Set());
    this.listeners.get(evt).add(fn);
    return () => this.listeners.get(evt).delete(fn);
  }
  emit(evt, data) {
    const ev = { type: evt, ...data, at: this.now() };
    if (evt !== 'update') { this.history.push(ev); if (this.history.length > 200) this.history.shift(); }
    for (const fn of this.listeners.get(evt) || []) { try { fn(ev); } catch (e) { console.error(e); } }
  }

  // ------------------------------------------------------------ evaluation
  _run(item) {
    try { return !!item.check(this.sys); } catch { return false; }
  }

  /** Re-check everything. Returns the events produced by this pass. */
  evaluate() {
    if (this._evaluating) return [];
    this._evaluating = true;
    const events = [];
    const t = this.now();
    try {
      for (const v of this.scenario.vulns) {
        const ok = this._run(v);
        if (ok) {
          if (this.found.has(v.id)) continue;
          if (!this.pending.has(v.id)) this.pending.set(v.id, t);
          if (t - this.pending.get(v.id) >= this.delayMs) {
            this.pending.delete(v.id);
            this.found.set(v.id, { at: t });
            events.push({ type: 'gain', id: v.id, points: v.points, title: v.title });
          }
        } else {
          this.pending.delete(v.id);
          if (this.found.has(v.id)) {
            this.found.delete(v.id);
            events.push({ type: 'loss', id: v.id, points: -v.points, title: v.title });
          }
        }
      }
      for (const p of this.scenario.penalties) {
        const bad = this._run(p);
        if (bad && !this.penalized.has(p.id)) {
          this.penalized.set(p.id, { at: t });
          events.push({ type: 'penalty', id: p.id, points: -p.points, title: p.title });
        } else if (!bad && this.penalized.has(p.id)) {
          this.penalized.delete(p.id);
          events.push({ type: 'penalty-cleared', id: p.id, points: p.points, title: p.title });
        }
      }
    } finally {
      this._evaluating = false;
    }
    for (const e of events) this.emit(e.type, e);
    if (events.length) this.emit('update', { events });
    return events;
  }

  /** Nothing is pending credit (used by tests with delay>0 to fast-forward). */
  get waiting() { return this.pending.size; }

  // ------------------------------------------------------------ scores
  get score() {
    let s = 0;
    for (const v of this.scenario.vulns) if (this.found.has(v.id)) s += v.points;
    for (const p of this.scenario.penalties) if (this.penalized.has(p.id)) s -= p.points;
    return s;
  }
  get maxScore() { return this.scenario.vulns.reduce((a, v) => a + v.points, 0); }
  get foundCount() { return this.found.size; }
  get totalCount() { return this.scenario.vulns.length; }

  report() {
    const items = this.scenario.vulns.filter((v) => this.found.has(v.id)).map((v) => ({ id: v.id, category: v.category, title: v.title, points: v.points }));
    const pens = this.scenario.penalties.filter((p) => this.penalized.has(p.id)).map((p) => ({ id: p.id, title: p.title, points: -p.points }));
    const elapsed = this.now() - this.startedAt;
    return { title: this.scenario.title, score: this.score, maxScore: this.maxScore, found: items.length, total: this.totalCount, items, penalties: pens, elapsedMs: elapsed, timeLimitMin: this.scenario.timeLimitMin, generated: fmtDate(this.now()) };
  }

  // ------------------------------------------------------------ report file (like /opt/CyberPatriot/ScoringReport.html)
  reportHtml() {
    const r = this.report();
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const hh = Math.floor(r.elapsedMs / 3600000), mm = Math.floor((r.elapsedMs % 3600000) / 60000);
    let h = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Scoring Report</title></head><body style="font-family:sans-serif">`;
    h += `<h2 style="text-align:center">${esc(r.title)}</h2><p style="text-align:center"><b>Report Generated At:</b> ${esc(r.generated)}</p>`;
    h += `<p style="text-align:center">Approximate Elapsed Time: ${hh} hr(s) ${mm} min(s)</p>`;
    h += `<h3 style="text-align:center">${r.found} out of ${r.total} scored security issues fixed, for a total of ${r.score} points out of ${r.maxScore}</h3>`;
    if (r.penalties.length) { h += `<h3 style="color:#b00">${r.penalties.length} penalties assessed, for a loss of ${-r.penalties.reduce((a, p) => a + p.points, 0)} points:</h3>`; for (const p of r.penalties) h += `<p style="color:#b00">${esc(p.title)} - ${-p.points} pts</p>`; }
    h += '<h3 style="color:#06a">Security issues fixed:</h3>';
    for (const i of r.items) h += `<p>${esc(i.title)} - ${i.points} pts</p>`;
    return h + '</body></html>';
  }

  // ------------------------------------------------------------ live wiring
  /** Start reacting to system changes (debounced) and ticking cron + periodic re-checks. */
  attach({ debounceMs = 250, tickMs = 5000, onTick } = {}) {
    this.detach();
    this._off = this.sys.on('change', () => {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this.evaluate(), debounceMs);
    });
    this._interval = setInterval(() => { onTick?.(); this.evaluate(); }, tickMs);
    this.evaluate();
  }
  detach() {
    this._off?.();
    clearTimeout(this._timer);
    clearInterval(this._interval);
  }

  // ------------------------------------------------------------ persistence
  serialize() {
    return { v: 1, found: [...this.found], penalized: [...this.penalized], pending: [...this.pending], startedAt: this.startedAt, delayMs: this.delayMs };
  }
  restore(s) {
    this.found = new Map(s.found); this.penalized = new Map(s.penalized); this.pending = new Map(s.pending || []);
    this.startedAt = s.startedAt; this.delayMs = s.delayMs ?? this.delayMs;
  }
}
