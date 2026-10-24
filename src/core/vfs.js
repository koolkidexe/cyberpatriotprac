// In-memory POSIX-like virtual filesystem with owners, modes, symlinks and permission checks.
import { posix, utf8Bytes } from './util.js';

export const ERRNO_MSG = {
  ENOENT: 'No such file or directory',
  EEXIST: 'File exists',
  ENOTDIR: 'Not a directory',
  EISDIR: 'Is a directory',
  ENOTEMPTY: 'Directory not empty',
  EACCES: 'Permission denied',
  EPERM: 'Operation not permitted',
  EINVAL: 'Invalid argument',
  ELOOP: 'Too many levels of symbolic links',
  EROFS: 'Read-only file system',
  EBUSY: 'Device or resource busy',
};

export class FsError extends Error {
  constructor(code, path) {
    super(`${code}: ${path}`);
    this.name = 'FsError';
    this.code = code;
    this.path = path;
  }
  get text() { return ERRNO_MSG[this.code] || this.code; }
}

/** Does `cred` ({uid,gids}) have permission bit `bit` (4=r, 2=w, 1=x) on `node`? */
export function hasPerm(node, cred, bit) {
  if (!cred) return true;
  if (cred.uid === 0) return bit !== 1 || node.t === 'd' || (node.mode & 0o111) !== 0;
  const shift = node.uid === cred.uid ? 6 : cred.gids && cred.gids.includes(node.gid) ? 3 : 0;
  return ((node.mode >> shift) & bit) !== 0;
}

let inoCounter = 1000;
const nextIno = () => ++inoCounter;

function devRead(kind) {
  if (kind === 'null') return '';
  if (kind === 'zero') return '\u0000'.repeat(256);
  let s = '';
  for (let i = 0; i < 256; i++) s += String.fromCharCode(33 + Math.floor(Math.random() * 90));
  return s;
}

const MUTATORS = ['writeFile', 'mkdir', 'symlink', 'unlink', 'rmdir', 'rename', 'copy', 'chmod', 'chown', 'touch'];

export class VFS {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.root = { t: 'd', mode: 0o755, uid: 0, gid: 0, mtime: now(), ino: 2, c: new Map() };
    /** Called (method, path) after any mutation succeeds; the System uses it to wake the scoring engine. */
    this.onChange = null;
    for (const m of MUTATORS) {
      const orig = this[m].bind(this);
      this[m] = (...args) => {
        const r = orig(...args);
        if (this.onChange) this.onChange(m, args[0]);
        return r;
      };
    }
  }

  // ------------------------------------------------------------ resolution
  /** Resolve `path` to {node, path} following symlinks. Throws FsError. */
  _resolve(path, { follow = true, cred = null } = {}) {
    let parts = posix.split(posix.normalize(path));
    let node = this.root;
    let cur = [];
    let links = 0;
    let i = 0;
    while (i < parts.length) {
      if (node.t !== 'd') throw new FsError('ENOTDIR', path);
      if (cred && !hasPerm(node, cred, 1)) throw new FsError('EACCES', path);
      const name = parts[i];
      const child = node.c.get(name);
      if (!child) return { node: null, path: '/' + [...cur, ...parts.slice(i)].join('/'), parent: node, name, missingAt: i === parts.length - 1 };
      const last = i === parts.length - 1;
      if (child.t === 'l' && (!last || follow)) {
        if (++links > 40) throw new FsError('ELOOP', path);
        const target = child.target;
        const base = '/' + cur.join('/');
        const newPath = posix.normalize(target, base || '/');
        parts = [...posix.split(newPath), ...parts.slice(i + 1)];
        node = this.root;
        cur = [];
        i = 0;
        continue;
      }
      node = child;
      cur.push(name);
      i++;
    }
    return { node, path: '/' + cur.join('/') };
  }

  /** Returns node or null (ENOENT). Throws for EACCES/ENOTDIR/ELOOP. */
  lookup(path, o = {}) {
    try {
      return this._resolve(path, o).node;
    } catch (e) {
      if (e instanceof FsError && e.code === 'ENOTDIR' && o.quiet) return null;
      throw e;
    }
  }

  realpath(path, o = {}) {
    const r = this._resolve(path, o);
    if (!r.node) throw new FsError('ENOENT', path);
    return r.path;
  }

  _need(path, o = {}) {
    const node = this.lookup(path, o);
    if (!node) throw new FsError('ENOENT', path);
    return node;
  }

  /** Returns {parent, name} for a path whose final component may not exist yet. */
  _parentOf(path, o = {}) {
    const norm = posix.normalize(path);
    if (norm === '/') throw new FsError('EEXIST', path);
    const dirPath = posix.dirname(norm);
    const parent = this._need(dirPath, o);
    if (parent.t !== 'd') throw new FsError('ENOTDIR', path);
    return { parent, name: posix.basename(norm), dirPath };
  }

  // ------------------------------------------------------------ queries
  exists(path, o = {}) {
    try { return !!this.lookup(path, o); } catch { return false; }
  }
  isDir(path, o = {}) {
    try { return this.lookup(path, o)?.t === 'd'; } catch { return false; }
  }
  isFile(path, o = {}) {
    try { return this.lookup(path, o)?.t === 'f'; } catch { return false; }
  }
  isLink(path) {
    try { return this.lookup(path, { follow: false })?.t === 'l'; } catch { return false; }
  }

  sizeOf(node) {
    if (node.t === 'd') return 4096;
    if (node.t === 'l') return node.target.length;
    if (typeof node.size === 'number') return node.size;
    return utf8Bytes(node.gen ? node.gen() : node.data || '').length;
  }

  stat(path, o = {}) {
    const node = this._need(path, o);
    return this.statNode(node, o.follow === false ? posix.normalize(path) : this.realpath(path, o));
  }

  statNode(node, path = '') {
    return {
      path,
      type: node.t === 'd' ? 'dir' : node.t === 'l' ? 'link' : 'file',
      t: node.t,
      mode: node.mode,
      uid: node.uid,
      gid: node.gid,
      size: this.sizeOf(node),
      mtime: node.mtime,
      ino: node.ino || (node.ino = nextIno()),
      nlink: node.t === 'd' ? 2 + [...node.c.values()].filter((c) => c.t === 'd').length : 1,
      target: node.target,
    };
  }

  readdir(path, o = {}) {
    const node = this._need(path, o);
    if (node.t !== 'd') throw new FsError('ENOTDIR', path);
    if (o.cred && !hasPerm(node, o.cred, 4)) throw new FsError('EACCES', path);
    return [...node.c.keys()];
  }

  readFile(path, o = {}) {
    const node = this._need(path, o);
    if (node.t === 'd') throw new FsError('EISDIR', path);
    if (o.cred && !hasPerm(node, o.cred, 4)) throw new FsError('EACCES', path);
    if (node.dev) return devRead(node.dev);
    return node.gen ? node.gen() : node.data;
  }

  readlink(path) {
    const node = this._need(path, { follow: false });
    if (node.t !== 'l') throw new FsError('EINVAL', path);
    return node.target;
  }

  // ------------------------------------------------------------ mutations
  writeFile(path, data, o = {}) {
    const r = this._resolve(path, { cred: o.cred });
    let node = r.node;
    if (node) {
      if (node.t === 'd') throw new FsError('EISDIR', path);
      if (o.cred && !hasPerm(node, o.cred, 2)) throw new FsError('EACCES', path);
      if (node.dev) return node; // /dev/null and friends swallow writes
      if (node.set) { node.set(o.append ? (node.gen ? node.gen() : node.data) + data : data); return node; }
      if (node.ro) throw new FsError('EACCES', path);
      node.data = o.append ? node.data + data : data;
      delete node.size;
      node.mtime = o.mtime ?? this.now();
      return node;
    }
    // create
    const { parent } = this._parentOf(path, { cred: o.cred });
    if (o.cred && (!hasPerm(parent, o.cred, 2) || !hasPerm(parent, o.cred, 1))) throw new FsError('EACCES', path);
    node = {
      t: 'f',
      mode: o.mode ?? 0o644,
      uid: o.uid ?? o.cred?.uid ?? 0,
      gid: o.gid ?? o.cred?.gid ?? 0,
      mtime: o.mtime ?? this.now(),
      ino: nextIno(),
      data,
    };
    if (o.size != null) node.size = o.size;
    parent.c.set(posix.basename(posix.normalize(path)), node);
    parent.mtime = this.now();
    return node;
  }

  mkdir(path, o = {}) {
    const norm = posix.normalize(path);
    if (o.parents) {
      let cur = '';
      for (const part of posix.split(norm)) {
        cur += '/' + part;
        const n = this.lookup(cur, { cred: o.cred });
        if (n) { if (n.t !== 'd') throw new FsError('ENOTDIR', cur); continue; }
        this.mkdir(cur, { ...o, parents: false });
      }
      return;
    }
    const existing = this.lookup(norm, { cred: o.cred, follow: false });
    if (existing) throw new FsError('EEXIST', path);
    const { parent } = this._parentOf(norm, { cred: o.cred });
    if (o.cred && (!hasPerm(parent, o.cred, 2) || !hasPerm(parent, o.cred, 1))) throw new FsError('EACCES', path);
    parent.c.set(posix.basename(norm), {
      t: 'd', mode: o.mode ?? 0o755, uid: o.uid ?? o.cred?.uid ?? 0, gid: o.gid ?? o.cred?.gid ?? 0,
      mtime: this.now(), ino: nextIno(), c: new Map(),
    });
    parent.mtime = this.now();
  }

  symlink(target, path, o = {}) {
    const norm = posix.normalize(path);
    if (this.lookup(norm, { follow: false, cred: o.cred })) throw new FsError('EEXIST', path);
    const { parent } = this._parentOf(norm, { cred: o.cred });
    if (o.cred && !hasPerm(parent, o.cred, 2)) throw new FsError('EACCES', path);
    parent.c.set(posix.basename(norm), {
      t: 'l', mode: 0o777, uid: o.uid ?? o.cred?.uid ?? 0, gid: o.gid ?? o.cred?.gid ?? 0, mtime: this.now(), ino: nextIno(), target,
    });
  }

  _checkSticky(parent, node, o) {
    if (!o.cred || o.cred.uid === 0) return;
    if (parent.mode & 0o1000 && node.uid !== o.cred.uid && parent.uid !== o.cred.uid) throw new FsError('EACCES', '');
  }

  unlink(path, o = {}) {
    const norm = posix.normalize(path);
    const node = this._need(norm, { follow: false, cred: o.cred });
    if (node.t === 'd') throw new FsError('EISDIR', path);
    const { parent } = this._parentOf(norm, { cred: o.cred });
    if (o.cred && (!hasPerm(parent, o.cred, 2) || !hasPerm(parent, o.cred, 1))) throw new FsError('EACCES', path);
    try { this._checkSticky(parent, node, o); } catch { throw new FsError('EACCES', path); }
    parent.c.delete(posix.basename(norm));
    parent.mtime = this.now();
  }

  rmdir(path, o = {}) {
    const norm = posix.normalize(path);
    const node = this._need(norm, { follow: false, cred: o.cred });
    if (node.t !== 'd') throw new FsError('ENOTDIR', path);
    if (node.c.size) throw new FsError('ENOTEMPTY', path);
    const { parent } = this._parentOf(norm, { cred: o.cred });
    if (o.cred && (!hasPerm(parent, o.cred, 2) || !hasPerm(parent, o.cred, 1))) throw new FsError('EACCES', path);
    parent.c.delete(posix.basename(norm));
    parent.mtime = this.now();
  }

  /** rm -rf (no permission checks unless cred given; errors are thrown on the first failure). */
  rmrf(path, o = {}) {
    const norm = posix.normalize(path);
    const node = this.lookup(norm, { follow: false, cred: o.cred });
    if (!node) return;
    if (node.t === 'd') {
      for (const name of [...node.c.keys()]) this.rmrf(posix.join(norm, name), o);
      this.rmdir(norm, o);
    } else this.unlink(norm, o);
  }

  rename(from, to, o = {}) {
    const src = posix.normalize(from);
    const node = this._need(src, { follow: false, cred: o.cred });
    const { parent: sp } = this._parentOf(src, { cred: o.cred });
    let dst = posix.normalize(to);
    const dstNode = this.lookup(dst, { cred: o.cred });
    if (dstNode && dstNode.t === 'd' && node.t !== 'l') dst = posix.join(dst, posix.basename(src));
    if (dst === src) return;
    if (node.t === 'd' && (dst + '/').startsWith(src + '/')) throw new FsError('EINVAL', to);
    const { parent: dp } = this._parentOf(dst, { cred: o.cred });
    if (o.cred && (!hasPerm(sp, o.cred, 2) || !hasPerm(dp, o.cred, 2))) throw new FsError('EACCES', from);
    const existing = dp.c.get(posix.basename(dst));
    if (existing) {
      if (existing.t === 'd' && existing.c.size) throw new FsError('ENOTEMPTY', to);
      if (existing.t === 'd' && node.t !== 'd') throw new FsError('EISDIR', to);
    }
    sp.c.delete(posix.basename(src));
    dp.c.set(posix.basename(dst), node);
    sp.mtime = dp.mtime = this.now();
  }

  copy(from, to, o = {}) {
    const src = posix.normalize(from);
    const node = this._need(src, { follow: !!o.followLinks, cred: o.cred });
    let dst = posix.normalize(to);
    const dn = this.lookup(dst, { cred: o.cred });
    if (dn && dn.t === 'd') dst = posix.join(dst, posix.basename(src));
    if (node.t === 'd') {
      if (!o.recursive) throw new FsError('EISDIR', from);
      if ((dst + '/').startsWith(src + '/')) throw new FsError('EINVAL', to);
      if (!this.lookup(dst)) this.mkdir(dst, { mode: o.preserve ? node.mode : node.mode, uid: o.preserve ? node.uid : undefined, gid: o.preserve ? node.gid : undefined, cred: o.cred });
      for (const [name] of node.c) this.copy(posix.join(src, name), posix.join(dst, name), o);
      return;
    }
    if (node.t === 'l') { this.symlink(node.target, dst, { cred: o.cred }); return; }
    if (o.cred && !hasPerm(node, o.cred, 4)) throw new FsError('EACCES', from);
    const data = node.gen ? node.gen() : node.data;
    const f = this.writeFile(dst, data, { cred: o.cred, mode: o.preserve ? node.mode : o.mode ?? (node.mode & 0o777), uid: o.preserve ? node.uid : undefined, gid: o.preserve ? node.gid : undefined });
    if (node.size != null) f.size = node.size;
  }

  chmod(path, mode, o = {}) {
    const node = this._need(path, { cred: o.cred });
    if (o.cred && o.cred.uid !== 0 && o.cred.uid !== node.uid) throw new FsError('EPERM', path);
    node.mode = mode;
    node.mtime = node.mtime;
  }

  chown(path, uid, gid, o = {}) {
    const node = this._need(path, { cred: o.cred, follow: o.follow !== false });
    if (o.cred && o.cred.uid !== 0) throw new FsError('EPERM', path);
    if (uid != null && uid >= 0) node.uid = uid;
    if (gid != null && gid >= 0) node.gid = gid;
  }

  touch(path, o = {}) {
    const node = this.lookup(path, { cred: o.cred });
    if (node) { if (o.cred && !hasPerm(node, o.cred, 2) && o.cred.uid !== node.uid) throw new FsError('EACCES', path); node.mtime = o.mtime ?? this.now(); return; }
    this.writeFile(path, '', o);
  }

  // ------------------------------------------------------------ traversal
  /** Depth-first walk (no symlink following). Yields [path, node]. The starting path is included. */
  *walk(path = '/', { cred = null } = {}) {
    const start = posix.normalize(path);
    const node = this.lookup(start, { follow: false });
    if (!node) return;
    yield [start, node];
    if (node.t === 'd') {
      if (cred && (!hasPerm(node, cred, 4) || !hasPerm(node, cred, 1))) return;
      for (const name of [...node.c.keys()].sort()) {
        yield* this.walk(posix.join(start, name), { cred });
      }
    }
  }

  // ------------------------------------------------------------ persistence
  toJSON() {
    const ser = (n) => {
      if (n.gen) return null; // virtual files are rebuilt at boot
      const base = { t: n.t, m: n.mode, u: n.uid, g: n.gid, s: n.mtime };
      if (n.t === 'd') {
        const c = {};
        for (const [k, v] of n.c) { const sv = ser(v); if (sv) c[k] = sv; }
        return { ...base, c };
      }
      if (n.t === 'l') return { ...base, x: n.target };
      const f = { ...base, d: n.data };
      if (n.size != null) f.z = n.size;
      if (n.dev) f.v = n.dev;
      return f;
    };
    return ser(this.root);
  }

  static fromJSON(obj, now) {
    const v = new VFS(now);
    const de = (j) => {
      if (j.t === 'd') {
        const n = { t: 'd', mode: j.m, uid: j.u, gid: j.g, mtime: j.s, ino: nextIno(), c: new Map() };
        for (const k of Object.keys(j.c)) n.c.set(k, de(j.c[k]));
        return n;
      }
      if (j.t === 'l') return { t: 'l', mode: j.m, uid: j.u, gid: j.g, mtime: j.s, ino: nextIno(), target: j.x };
      const n = { t: 'f', mode: j.m, uid: j.u, gid: j.g, mtime: j.s, ino: nextIno(), data: j.d };
      if (j.z != null) n.size = j.z;
      if (j.v) n.dev = j.v;
      return n;
    };
    v.root = de(obj);
    return v;
  }
}

/** A VFS view bound to a credential: every operation enforces permissions as that user. */
export class FsView {
  constructor(vfs, cred) {
    this.vfs = vfs;
    this.cred = cred;
  }
  _o(o = {}) { return { ...o, cred: this.cred }; }
  lookup(p, o) { return this.vfs.lookup(p, this._o(o)); }
  exists(p, o) { return this.vfs.exists(p, this._o(o)); }
  isDir(p) { return this.vfs.isDir(p, this._o()); }
  isFile(p) { return this.vfs.isFile(p, this._o()); }
  stat(p, o) { return this.vfs.stat(p, this._o(o)); }
  lstat(p) { return this.vfs.stat(p, this._o({ follow: false })); }
  readdir(p) { return this.vfs.readdir(p, this._o()); }
  readFile(p) { return this.vfs.readFile(p, this._o()); }
  readlink(p) { return this.vfs.readlink(p); }
  realpath(p) { return this.vfs.realpath(p, this._o()); }
  writeFile(p, d, o) { return this.vfs.writeFile(p, d, this._o(o)); }
  mkdir(p, o) { return this.vfs.mkdir(p, this._o(o)); }
  symlink(t, p) { return this.vfs.symlink(t, p, this._o()); }
  unlink(p) { return this.vfs.unlink(p, this._o()); }
  rmdir(p) { return this.vfs.rmdir(p, this._o()); }
  rmrf(p) { return this.vfs.rmrf(p, this._o()); }
  rename(a, b) { return this.vfs.rename(a, b, this._o()); }
  copy(a, b, o) { return this.vfs.copy(a, b, this._o(o)); }
  chmod(p, m) { return this.vfs.chmod(p, m, this._o()); }
  chown(p, u, g, o) { return this.vfs.chown(p, u, g, this._o(o)); }
  touch(p, o) { return this.vfs.touch(p, this._o(o)); }
  walk(p) { return this.vfs.walk(p, { cred: this.cred }); }
  sizeOf(n) { return this.vfs.sizeOf(n); }
}
