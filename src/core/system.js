// The simulated machine: filesystem + processes + package/service state. Everything a command or a
// GUI app can change lives here, so the scoring engine sees one consistent world.
import { VFS } from './vfs.js';
import { randomSalt, fmtSyslog } from './util.js';
import { SYSCTL_DEFAULTS } from './sysctl.js';

export class System {
  constructor({ now = () => Date.now(), rng = Math.random, hostname = 'mint' } = {}) {
    this._now = now;
    this.rng = rng;
    this.vfs = new VFS(() => this.now());
    this.vfs.onChange = () => this.touch('fs');
    this.hostname = hostname;
    this.misc = {};       // persisted odds and ends (initial password hashes, GUI-only state, ...)
    this.pkgState = {};   // name -> { installed, version, auto, config }
    this.svcState = {};   // unit name -> { active: 'active'|'inactive'|'failed', enabled: 'enabled'|'disabled'|'masked', since }
    this.processes = [];  // see spawn()
    this.nextPid = 1;
    this.ufw = { rules: [], defaults: { incoming: 'deny', outgoing: 'allow', routed: 'disabled' }, logging: 'low' };
    this.sysctl = { ...SYSCTL_DEFAULTS };
    this.respawn = [];    // processes that cron brings back after being killed
    this.bootTime = this.now();
    this.sudoTs = {};     // not persisted: user -> last sudo auth time
    this.listeners = new Map();
    this.counters = { touches: 0 };
    this.dirty = false;
  }

  now() { return this._now(); }
  salt() { return randomSalt(22, this.rng); }

  // ------------------------------------------------------------------ events
  on(evt, fn) {
    if (!this.listeners.has(evt)) this.listeners.set(evt, new Set());
    this.listeners.get(evt).add(fn);
    return () => this.listeners.get(evt)?.delete(fn);
  }
  emit(evt, data) {
    for (const fn of this.listeners.get(evt) || []) {
      try { fn(data); } catch (e) { console.error(e); }
    }
  }
  /** Something changed; the scoring engine and UI listen for this. */
  touch(kind = 'misc') {
    this.counters.touches++;
    this.dirty = true;
    this.emit('change', kind);
  }

  // ------------------------------------------------------------------ processes
  spawn({ user = 'root', cmd, comm, ppid = 1, tty = '?', stat = 'Ss', listen = [], svc = null, respawnId = null, start = this.now(), cpu, mem } = {}) {
    const pid = this.nextPid++;
    const p = {
      pid, ppid, user, cmd, comm: comm || cmd.split(' ')[0].split('/').pop(), tty, stat, start,
      cpu: cpu ?? +(this.rng() * 0.3).toFixed(1), mem: mem ?? +(0.1 + this.rng() * 0.8).toFixed(1),
      vsz: 20000 + Math.floor(this.rng() * 200000), rss: 2000 + Math.floor(this.rng() * 30000), listen, svc, respawnId,
    };
    this.processes.push(p);
    this.touch('proc');
    return p;
  }

  findProc(pid) { return this.processes.find((p) => p.pid === pid) || null; }

  killProc(pid) {
    const i = this.processes.findIndex((p) => p.pid === pid);
    if (i < 0) return false;
    const [p] = this.processes.splice(i, 1);
    if (p.svc && this.svcState[p.svc]) {
      // the main process of a service died
      const others = this.processes.filter((q) => q.svc === p.svc);
      if (!others.length) {
        const st = this.svcState[p.svc];
        st.active = 'inactive';
        st.since = this.now();
      }
    }
    this.touch('proc');
    return true;
  }

  /** Every listening socket, derived from the process table. */
  sockets() {
    const out = [];
    for (const p of this.processes) for (const l of p.listen || []) out.push({ ...l, pid: p.pid, user: p.user, comm: p.comm });
    return out;
  }

  // ------------------------------------------------------------------ cron-driven respawns
  /** Called periodically by the UI (and by tests): processes whose cron job still exists come back. */
  runCronTick(cronEntries) {
    let changed = false;
    for (const r of this.respawn) {
      const alive = this.processes.some((p) => p.respawnId === r.id);
      if (alive) continue;
      if (cronEntries.some((e) => e.command.includes(r.match))) {
        this.spawn({ ...r.proc, respawnId: r.id });
        changed = true;
      }
    }
    return changed;
  }

  // ------------------------------------------------------------------ logging
  /** Append a syslog-style line to a file under /var/log. */
  log(file, program, message, pid) {
    const path = `/var/log/${file}`;
    const line = `${fmtSyslog(this.now())} ${this.hostname} ${program}${pid ? `[${pid}]` : ''}: ${message}\n`;
    try {
      this.vfs.writeFile(path, line, { append: true, mode: 0o640, uid: 104, gid: 4 });
    } catch { /* logging must never break a command */ }
  }

  // ------------------------------------------------------------------ persistence
  snapshot() {
    return {
      v: 1,
      hostname: this.hostname,
      bootTime: this.bootTime,
      nextPid: this.nextPid,
      pkgState: this.pkgState,
      svcState: this.svcState,
      processes: this.processes,
      ufw: this.ufw,
      sysctl: this.sysctl,
      respawn: this.respawn,
      misc: this.misc,
      vfs: this.vfs.toJSON(),
    };
  }

  static restore(snap, opts = {}) {
    const s = new System({ ...opts, hostname: snap.hostname });
    s.vfs = VFS.fromJSON(snap.vfs, () => s.now());
    s.vfs.onChange = () => s.touch('fs');
    s.misc = snap.misc || {};
    s.bootTime = snap.bootTime;
    s.nextPid = snap.nextPid;
    s.pkgState = snap.pkgState;
    s.svcState = snap.svcState;
    s.processes = snap.processes;
    s.ufw = snap.ufw;
    s.sysctl = snap.sysctl;
    s.respawn = snap.respawn;
    return s;
  }
}
