// Entry point for the simulated shell: loads every command module and registers stub binaries
// for installed packages that have no dedicated implementation (so `which vsftpd` etc. behave).
import { Shell, nullIo, DEFAULT_PATH } from './shell.js';
import { commands, cmd } from './registry.js';
import './commands/builtins.js';
import './commands/text.js';
import './commands/files.js';
import './commands/users.js';
import './commands/system.js';
import './commands/pkg.js';
import './commands/net.js';
import { PACKAGES } from '../images/catalog.js';

const ALIAS_BINS = { nc: 'netcat-traditional', netcat: 'netcat-traditional' };

function stub(binName, pkgName) {
  cmd(binName, (ctx) => {
    const v = PACKAGES[pkgName]?.v ?? '';
    if (ctx.args.includes('--version') || ctx.args.includes('-V') || ctx.args.includes('-v')) { ctx.out(`${binName} (${pkgName}) ${v}\n`); return 0; }
    if (ctx.args.includes('--help') || ctx.args.includes('-h')) { ctx.out(`Usage: ${binName} [OPTION]...\n`); return 0; }
    return 0;
  }, { pkg: pkgName, noHelp: true });
}

for (const d of Object.values(PACKAGES)) {
  for (const b of d.bins || []) {
    const base = b.split('/').pop();
    if (!commands.has(base)) stub(base, d.name);
  }
}
for (const [alias, pkgName] of Object.entries(ALIAS_BINS)) if (!commands.has(alias)) stub(alias, pkgName);

export function createShell(sys, opts = {}) { return new Shell(sys, opts); }
export { Shell, nullIo, DEFAULT_PATH, commands };
