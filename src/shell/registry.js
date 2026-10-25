// Command registry. Command modules call def()/builtin() when imported.
export const REGISTRY = { builtins: {}, commands: {} };
/** Register an external command. `bin` (optional) is the file that must exist for the command to run. */
export const def = (names, fn, { bin } = {}) => { for (const n of [].concat(names)) REGISTRY.commands[n] = { fn, bin }; };
export const builtin = (names, fn) => { for (const n of [].concat(names)) REGISTRY.builtins[n] = fn; };
