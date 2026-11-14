import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VFS, FsView, FsError } from '../src/core/vfs.js';
import { hashPassword, verifyPassword, compareVersions, sha256hex, posix, modeToString } from '../src/core/util.js';

test('sha256 matches known vectors', () => {
  assert.equal(sha256hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('password hashing verifies and is salted', () => {
  const h = hashPassword('hunter2', 'abcd1234');
  assert.match(h, /^\$y\$j9T\$abcd1234\$.{43}$/);
  assert.ok(verifyPassword('hunter2', h));
  assert.ok(!verifyPassword('hunter3', h));
  assert.notEqual(hashPassword('hunter2', 'zzzz'), h);
});

test('version comparison', () => {
  assert.equal(compareVersions('1.0', '1.0'), 0);
  assert.equal(compareVersions('130.0+linuxmint1', '131.0+linuxmint1'), -1);
  assert.equal(compareVersions('1:9.6p1-3', '9.9'), 1);
  assert.equal(compareVersions('1.0~rc1', '1.0'), -1);
  assert.equal(compareVersions('2.10', '2.9'), 1);
});

test('paths', () => {
  assert.equal(posix.normalize('a/../b/./c', '/x'), '/x/b/c');
  assert.equal(posix.normalize('/../..'), '/');
  assert.equal(posix.dirname('/a/b/c'), '/a/b');
  assert.equal(posix.basename('/a/b/c/'), 'c');
  assert.equal(modeToString(0o640), '-rw-r-----');
  assert.equal(modeToString(0o4755), '-rwsr-xr-x');
  assert.equal(modeToString(0o1777, 'd'), 'drwxrwxrwt');
});

test('basic file operations', () => {
  const v = new VFS();
  v.mkdir('/home/bob/docs', { parents: true });
  v.writeFile('/home/bob/docs/a.txt', 'hello');
  assert.equal(v.readFile('/home/bob/docs/a.txt'), 'hello');
  v.writeFile('/home/bob/docs/a.txt', ' world', { append: true });
  assert.equal(v.readFile('/home/bob/docs/a.txt'), 'hello world');
  assert.deepEqual(v.readdir('/home/bob/docs'), ['a.txt']);
  v.rename('/home/bob/docs/a.txt', '/home/bob/b.txt');
  assert.ok(!v.exists('/home/bob/docs/a.txt'));
  assert.ok(v.exists('/home/bob/b.txt'));
  assert.throws(() => v.rmdir('/home/bob'), (e) => e.code === 'ENOTEMPTY');
  v.rmrf('/home/bob');
  assert.ok(!v.exists('/home/bob'));
  assert.throws(() => v.readFile('/nope'), (e) => e instanceof FsError && e.code === 'ENOENT');
});

test('symlinks resolve and loops are detected', () => {
  const v = new VFS();
  v.mkdir('/usr/bin', { parents: true });
  v.writeFile('/usr/bin/tool', 'x');
  v.symlink('usr/bin', '/bin');
  assert.equal(v.readFile('/bin/tool'), 'x');
  assert.equal(v.realpath('/bin/tool'), '/usr/bin/tool');
  v.symlink('/loop2', '/loop1');
  v.symlink('/loop1', '/loop2');
  assert.throws(() => v.readFile('/loop1'), (e) => e.code === 'ELOOP');
  assert.ok(v.isLink('/bin'));
});

test('permission checks via FsView', () => {
  const v = new VFS();
  v.mkdir('/etc');
  v.writeFile('/etc/shadow', 'secret', { mode: 0o640, uid: 0, gid: 42 });
  v.mkdir('/home/alice', { parents: true, uid: 1000, gid: 1000, mode: 0o700 });
  v.writeFile('/home/alice/n.txt', 'mine', { uid: 1000, gid: 1000, mode: 0o600 });
  const alice = new FsView(v, { uid: 1000, gid: 1000, gids: [1000] });
  const bob = new FsView(v, { uid: 1001, gid: 1001, gids: [1001] });
  const shadowGrp = new FsView(v, { uid: 5, gid: 42, gids: [42] });
  assert.throws(() => alice.readFile('/etc/shadow'), (e) => e.code === 'EACCES');
  assert.equal(shadowGrp.readFile('/etc/shadow'), 'secret');
  assert.equal(alice.readFile('/home/alice/n.txt'), 'mine');
  assert.throws(() => bob.readFile('/home/alice/n.txt'), (e) => e.code === 'EACCES');
  assert.throws(() => bob.writeFile('/home/alice/x', 'y'), (e) => e.code === 'EACCES');
  assert.throws(() => alice.writeFile('/etc/new', 'y'), (e) => e.code === 'EACCES');
  alice.writeFile('/home/alice/ok.txt', 'y');
  assert.equal(v.stat('/home/alice/ok.txt').uid, 1000);
});

test('JSON round trip preserves tree, modes and links', () => {
  const v = new VFS();
  v.mkdir('/a/b', { parents: true, mode: 0o750, uid: 5, gid: 6 });
  v.writeFile('/a/b/f', 'data', { mode: 0o600 });
  v.symlink('/a/b/f', '/a/link');
  v.writeFile('/a/virt', '', {});
  v.lookup('/a/virt').gen = () => 'generated';
  const j = JSON.parse(JSON.stringify(v.toJSON()));
  const w = VFS.fromJSON(j);
  assert.equal(w.readFile('/a/b/f'), 'data');
  assert.equal(w.stat('/a/b').mode, 0o750);
  assert.equal(w.readlink('/a/link'), '/a/b/f');
  assert.ok(!w.exists('/a/virt'), 'generated files are not persisted');
});
