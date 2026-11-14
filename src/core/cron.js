// Cron: parsing system and user crontabs into a flat list of entries.

const MACROS = new Set(['@reboot', '@yearly', '@annually', '@monthly', '@weekly', '@daily', '@midnight', '@hourly']);

function parseLines(text, withUser, source, defaultUser) {
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line)) continue; // environment assignment
    const parts = line.split(/\s+/);
    let schedule;
    let rest;
    if (MACROS.has(parts[0])) { schedule = parts[0]; rest = parts.slice(1); }
    else if (parts.length >= 6) { schedule = parts.slice(0, 5).join(' '); rest = parts.slice(5); }
    else continue;
    let user = defaultUser;
    if (withUser) { user = rest[0]; rest = rest.slice(1); }
    if (!rest.length) continue;
    out.push({ source, user, schedule, command: rest.join(' '), raw: line });
  }
  return out;
}

export const userCrontabPath = (user) => `/var/spool/cron/crontabs/${user}`;

/** Every active cron entry on the system. */
export function cronEntries(sys) {
  const v = sys.vfs;
  const out = [];
  if (v.isFile('/etc/crontab')) out.push(...parseLines(v.readFile('/etc/crontab'), true, '/etc/crontab'));
  if (v.isDir('/etc/cron.d')) {
    for (const name of v.readdir('/etc/cron.d').sort()) {
      if (name.startsWith('.') || name.endsWith('~') || name.includes('.dpkg-')) continue;
      const p = `/etc/cron.d/${name}`;
      if (v.isFile(p)) out.push(...parseLines(v.readFile(p), true, p));
    }
  }
  if (v.isDir('/var/spool/cron/crontabs')) {
    for (const name of v.readdir('/var/spool/cron/crontabs').sort()) {
      const p = `/var/spool/cron/crontabs/${name}`;
      if (v.isFile(p)) out.push(...parseLines(v.readFile(p), false, p, name));
    }
  }
  // scripts dropped into the periodic directories also run
  for (const period of ['hourly', 'daily', 'weekly', 'monthly']) {
    const dir = `/etc/cron.${period}`;
    if (!v.isDir(dir)) continue;
    for (const name of v.readdir(dir).sort()) {
      const p = `${dir}/${name}`;
      if (v.isFile(p) && (v.stat(p).mode & 0o111) !== 0 && !name.includes('.')) out.push({ source: p, user: 'root', schedule: `@${period}`, command: p, raw: p });
    }
  }
  return out;
}
