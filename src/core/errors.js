/** An error whose message is printed verbatim by the shell (prefixed by the command name when thrown by a command). */
export class CmdError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.name = 'CmdError';
    this.code = code;
  }
}
