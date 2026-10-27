// Shared file helpers for GUI apps (trash, unique names, permissions text).
import { FsView } from '../core/vfs.js';
import * as users from '../core/users.js';
import { posix } from '../core/util.js';

export function uniqueName(fs, dir, name) {
  if (!fs.exists(`${dir}/${name}`)) return name;
  const m = /^(.*?)(\.[^.]*)?$/.exec(name);
  for (let i = 1; i < 1000; i++) { const n = `${m[1]} (copy ${i})${m[2] || ''}`; if (!fs.exists(`${dir}/${n}`)) return n; }
  return name + '.' + Date.now();
}

/** Make sure ~/.local/share/Trash/{files,info} exist (the trash is created lazily, as on a real system). */
export function ensureTrash(sys, cred, user) {
  const home = users.getUser(sys, user).home;
  const tdir = `${home}/.local/share/Trash`;
  for (const d of [`${home}/.local`, `${home}/.local/share`, tdir, `${tdir}/files`, `${tdir}/info`]) { if (!sys.vfs.exists(d)) sys.vfs.mkdir(d, { mode: 0o700, uid: cred.uid, gid: cred.gid }); }
  return `${tdir}/files`;
}

/** Move a path to the user's trash like nemo/gio does. */
export function trashPath(sys, cred, user, path) {
  const fs = new FsView(sys.vfs, cred);
  const home = users.getUser(sys, user).home;
  const tdir = `${home}/.local/share/Trash`;
  for (const d of [`${home}/.local`, `${home}/.local/share`, tdir, `${tdir}/files`, `${tdir}/info`]) { if (!sys.vfs.exists(d)) sys.vfs.mkdir(d, { mode: 0o700, uid: cred.uid, gid: cred.gid }); }
  const base = posix.basename(path);
  const name = uniqueName(fs, `${tdir}/files`, base);
  // a permission failure surfaces as FsError with the real reason
  fs.lstat(path);
  fs.rename(path, `${tdir}/files/${name}`);
  sys.vfs.writeFile(`${tdir}/info/${name}.trashinfo`, `[Trash Info]\nPath=${path}\nDeletionDate=${new Date(sys.now()).toISOString().slice(0, 19)}\n`, { uid: cred.uid, gid: cred.gid, mode: 0o600 });
}

export function modeString(mode, type) {
  const t = type === 'd' ? 'd' : type === 'l' ? 'l' : '-';
  const b = (m, r, w, x, sp, ch) => (m & r ? 'r' : '-') + (m & w ? 'w' : '-') + (sp ? (m & x ? ch : ch.toUpperCase()) : (m & x ? 'x' : '-'));
  return t + b(mode >> 6, 4, 2, 1, mode & 0o4000, 's') + b(mode >> 3, 4, 2, 1, mode & 0o2000, 's') + b(mode, 4, 2, 1, mode & 0o1000, 't');
}
