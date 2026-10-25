// Scoring engine. A vulnerability is "found" while its check passes; if the fix is undone the points
// disappear again (just like the real scoring service). Penalties are checks that pass while something
// bad is true. The engine only reads system state, so terminal and GUI changes score identically.

export class ScoringEngine {
  constructor(sys, scenario, saved = null) {
    this.sys = sys;
    this.scenario = scenario;
    this.state = saved || { found: {}, penalties: {}, elapsedMs: 0, startedAt: sys.now() };
    this.handlers = new Map();
    this.timer = null;
    this.tickTimer = null;
    this.debounce = null;
    this.mode = 'instant'; // 'instant' (~1.5s after a change) | 'realistic' (every 60s)
    this.lastTick = sys.now();
    this.unsub = null;
  }

  on(evt, fn) {
    if (!this.handlers.has(evt)) this.handlers.set(evt, new Set());
    this.handlers.get(evt).add(fn);
    return () => this.handlers.get(evt).delete(fn);
  }
  emit(evt, data) { for (const fn of this.handlers.get(evt) || []) { try { fn(data); } catch (e) { console.error(e); } } }

  _run(item) {
    try { return !!item.check(this.sys); } catch (e) { return false; }
  }

  /** Re-check everything now. Returns what changed. */
  evaluate() {
    const now = this.sys.now();
    const delta = { gained: [], lost: [], penalized: [], cleared: [] };
    for (const v of this.scenario.vulns) {
      const ok = this._run(v);
      const had = this.state.found[v.id];
      if (ok && !had) { this.state.found[v.id] = now; delta.gained.push(v); }
      else if (!ok && had) { delete this.state.found[v.id]; delta.lost.push(v); }
    }
    for (const p of this.scenario.penalties) {
      const bad = this._run(p);
      const had = this.state.penalties[p.id];
      if (bad && !had) { this.state.penalties[p.id] = now; delta.penalized.push(p); }
      else if (!bad && had) { delete this.state.penalties[p.id]; delta.cleared.push(p); }
    }
    this.lastEval = now;
    if (delta.gained.length || delta.lost.length || delta.penalized.length || delta.cleared.length) {
      this.emit('score', { ...delta, score: this.score() });
    }
    this.emit('evaluated', delta);
    return delta;
  }

  score() {
    let s = 0;
    for (const v of this.scenario.vulns) if (this.state.found[v.id]) s += v.points;
    for (const p of this.scenario.penalties) if (this.state.penalties[p.id]) s -= p.points;
    return s;
  }
  maxScore() { return this.scenario.vulns.reduce((a, v) => a + v.points, 0); }

  elapsedMs() { return this.state.elapsedMs + (this.timer ? Math.max(0, this.sys.now() - this.lastTick) : 0); }

  report() {
    const found = this.scenario.vulns.filter((v) => this.state.found[v.id]).sort((a, b) => this.state.found[a.id] - this.state.found[b.id]);
    const pens = this.scenario.penalties.filter((p) => this.state.penalties[p.id]);
    const byCat = {};
    for (const v of this.scenario.vulns) { const c = (byCat[v.category] ||= { total: 0, found: 0, points: 0, max: 0 }); c.total++; c.max += v.points; if (this.state.found[v.id]) { c.found++; c.points += v.points; } }
    return {
      title: this.scenario.title,
      image: this.scenario.imageName,
      teamId: this.scenario.teamId,
      generatedAt: this.sys.now(),
      elapsedMs: this.elapsedMs(),
      score: this.score(),
      maxScore: this.maxScore(),
      foundCount: found.length,
      totalCount: this.scenario.vulns.length,
      found: found.map((v) => ({ id: v.id, title: v.title, points: v.points, category: v.category })),
      penalties: pens.map((p) => ({ id: p.id, title: p.title, points: p.points })),
      penaltyPoints: pens.reduce((a, p) => a + p.points, 0),
      gainPoints: found.reduce((a, v) => a + v.points, 0),
      categories: byCat,
    };
  }

  // ---------------------------------------------------------------- scheduling (browser)
  setMode(mode) { this.mode = mode; this._reschedule(); }

  start() {
    if (this.timer) return;
    this.lastTick = this.sys.now();
    this.unsub = this.sys.on('change', () => { if (this.mode === 'instant') this._debounced(); });
    this.timer = setInterval(() => this._tick(), 1000);
    this._reschedule();
    this.evaluate();
  }
  stop() {
    clearInterval(this.timer); clearInterval(this.tickTimer); clearTimeout(this.debounce);
    this.timer = this.tickTimer = this.debounce = null;
    this.unsub?.();
  }
  _debounced() {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.evaluate(), 1200);
  }
  _reschedule() {
    clearInterval(this.tickTimer);
    this.tickTimer = setInterval(() => this.evaluate(), this.mode === 'instant' ? 5000 : 60000);
  }
  _tick() {
    const now = this.sys.now();
    this.state.elapsedMs += now - this.lastTick;
    this.lastTick = now;
    this.emit('tick', this.state.elapsedMs);
  }

  serialize() { return JSON.parse(JSON.stringify(this.state)); }
}

export function fmtElapsed(ms) {
  const m = Math.floor(ms / 60000);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
