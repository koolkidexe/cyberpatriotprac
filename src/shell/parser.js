// A bash-subset parser: quoting, $VAR / ${VAR} / $(cmd) / $((expr)) / `cmd`, ~ and globs, pipes, redirections,
// && || ; &, and if / for / while / until / { } / ( ) compounds.
// parse(text) returns an AST; throws {incomplete:true} when more input is needed (unclosed quote, trailing |, open `if`...).

export class ParseError extends Error {
  constructor(msg, incomplete = false) { super(msg); this.incomplete = incomplete; }
}

const KEYWORDS = new Set(['if', 'then', 'elif', 'else', 'fi', 'for', 'in', 'do', 'done', 'while', 'until', '{', '}', '!']);
const OPS = ['&>>', '<<<', '2>>', '>>', '&&', '||', '2>&1', '>&2', '&>', '2>', ';;', '|', '&', ';', '(', ')', '>', '<'];

function isSpace(c) { return c === ' ' || c === '\t'; }

/** Tokenise into words and operators. A word is a list of parts: {k:'lit'|'var'|'cmd'|'arith'|'tilde', v, q}. */
export function tokenize(src) {
  const toks = [];
  let i = 0;
  const n = src.length;
  const readParen = (start) => {
    // src[start] is just after "$(" — find the matching ")"
    let depth = 1; let j = start; let q = null;
    while (j < n && depth > 0) {
      const c = src[j];
      if (q) { if (c === q) q = null; else if (c === '\\' && q === '"') j++; }
      else if (c === "'" || c === '"') q = c;
      else if (c === '(') depth++;
      else if (c === ')') depth--;
      j++;
    }
    if (depth) throw new ParseError('unexpected EOF while looking for matching `)\'', true);
    return [src.slice(start, j - 1), j];
  };
  const readVar = (parts, quoted) => {
    // src[i] === '$'
    const c = src[i + 1];
    if (c === '(' && src[i + 2] === '(') {
      const [body, j] = readParen(i + 2);
      parts.push({ k: 'arith', v: body.slice(1, body.endsWith(')') ? -1 : undefined), q: quoted }); i = j; return;
    }
    if (c === '(') { const [body, j] = readParen(i + 2); parts.push({ k: 'cmd', v: body, q: quoted }); i = j; return; }
    if (c === '{') {
      const j = src.indexOf('}', i);
      if (j < 0) throw new ParseError('unexpected EOF while looking for `}\'', true);
      parts.push({ k: 'var', v: src.slice(i + 2, j), q: quoted, braces: true }); i = j + 1; return;
    }
    const m = /^(\?|\$|#|@|\*|!|[0-9]|[A-Za-z_][A-Za-z0-9_]*)/.exec(src.slice(i + 1));
    if (m) { parts.push({ k: 'var', v: m[1], q: quoted }); i += 1 + m[1].length; return; }
    parts.push({ k: 'lit', v: '$', q: quoted }); i++;
  };

  while (i < n) {
    const c = src[i];
    if (isSpace(c)) { i++; continue; }
    if (c === '\\' && src[i + 1] === '\n') { i += 2; continue; }
    if (c === '#') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '\n') { toks.push({ t: 'op', v: '\n' }); i++; continue; }
    // operators (fd-number redirects only when the digit starts a word)
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) { toks.push({ t: 'op', v: op }); i += op.length; continue; }
    // a word
    const parts = [];
    let hasQuote = false;
    const lit = (ch, q) => { const last = parts[parts.length - 1]; if (last && last.k === 'lit' && last.q === q) last.v += ch; else parts.push({ k: 'lit', v: ch, q }); };
    if (c === '~') {
      const m = /^~([A-Za-z0-9_-]*)(?=\/|$|\s|[:;|&<>)])/.exec(src.slice(i));
      if (m) { parts.push({ k: 'tilde', v: m[1] }); i += m[0].length; }
    }
    while (i < n) {
      const ch = src[i];
      if (isSpace(ch) || ch === '\n') break;
      if (ch === '|' || ch === '&' || ch === ';' || ch === '<' || ch === '>' || ch === '(' || ch === ')') break;
      if (ch === '\\') { if (i + 1 >= n) throw new ParseError('trailing backslash', true); if (src[i + 1] === '\n') { i += 2; continue; } lit(src[i + 1], true); hasQuote = true; i += 2; continue; }
      if (ch === "'") {
        const j = src.indexOf("'", i + 1);
        if (j < 0) throw new ParseError("unexpected EOF while looking for matching `''", true);
        parts.push({ k: 'lit', v: src.slice(i + 1, j), q: true }); hasQuote = true; i = j + 1; continue;
      }
      if (ch === '"') {
        i++; hasQuote = true;
        let closed = false;
        const start = parts.length;
        while (i < n) {
          const d = src[i];
          if (d === '"') { closed = true; i++; break; }
          if (d === '\\' && i + 1 < n && '"\\$`\n'.includes(src[i + 1])) { if (src[i + 1] !== '\n') lit(src[i + 1], true); i += 2; continue; }
          if (d === '$') { readVar(parts, true); continue; }
          if (d === '`') { const j = src.indexOf('`', i + 1); if (j < 0) throw new ParseError('unexpected EOF while looking for matching ``\'', true); parts.push({ k: 'cmd', v: src.slice(i + 1, j), q: true }); i = j + 1; continue; }
          lit(d, true); i++;
        }
        if (!closed) throw new ParseError("unexpected EOF while looking for matching `\"'", true);
        if (parts.length === start) parts.push({ k: 'lit', v: '', q: true });
        continue;
      }
      if (ch === '$' && src[i + 1] === "'") {
        const j = src.indexOf("'", i + 2);
        if (j < 0) throw new ParseError("unexpected EOF while looking for matching `''", true);
        const raw = src.slice(i + 2, j).replace(/\\(n|t|r|e|\\|')/g, (_, x) => ({ n: '\n', t: '\t', r: '\r', e: '\u001b', '\\': '\\', "'": "'" }[x]));
        parts.push({ k: 'lit', v: raw, q: true }); hasQuote = true; i = j + 1; continue;
      }
      if (ch === '$') { readVar(parts, false); continue; }
      if (ch === '`') { const j = src.indexOf('`', i + 1); if (j < 0) throw new ParseError('unexpected EOF while looking for matching ``\'', true); parts.push({ k: 'cmd', v: src.slice(i + 1, j), q: false }); i = j + 1; continue; }
      lit(ch, false); i++;
    }
    const plain = parts.length === 1 && parts[0].k === 'lit' && !parts[0].q ? parts[0].v : null;
    // "2>file" style: a bare digit directly before a redirect operator
    toks.push({ t: 'word', parts, plain, hasQuote });
  }
  return toks;
}

// Convert "2" followed by ">" into a single redirect token (the OPS table handles 2> / 2>> / 2>&1 directly).

class Parser {
  constructor(toks) { this.toks = toks; this.p = 0; }
  peek() { return this.toks[this.p]; }
  next() { return this.toks[this.p++]; }
  isOp(v) { const t = this.peek(); return t && t.t === 'op' && t.v === v; }
  isKw(v) { const t = this.peek(); return t && t.t === 'word' && t.plain === v && !t.hasQuote; }
  skipNewlines() { while (this.isOp('\n')) this.p++; }
  skipSeps() { while (this.isOp('\n') || this.isOp(';')) this.p++; }
  eof() { return this.p >= this.toks.length; }

  /** Parse commands until one of `stop` keywords (or ")" for subshells) is next. */
  parseList(stop = []) {
    const items = [];
    this.skipSeps();
    while (!this.eof()) {
      if (stop.some((k) => (k === ')' ? this.isOp(')') : this.isKw(k)))) break;
      const node = this.parseAndOr();
      let bg = false;
      if (this.isOp('&')) { this.next(); bg = true; }
      else if (this.isOp(';') || this.isOp('\n')) this.next();
      else if (!this.eof() && !stop.some((k) => (k === ')' ? this.isOp(')') : this.isKw(k)))) throw new ParseError(`syntax error near unexpected token \`${this.tokText(this.peek())}'`);
      items.push({ node, bg });
      this.skipSeps();
    }
    return { type: 'list', items };
  }
  tokText(t) { return t ? (t.t === 'op' ? (t.v === '\n' ? 'newline' : t.v) : t.plain ?? t.parts.map((x) => x.v).join('')) : 'newline'; }

  parseAndOr() {
    const first = this.parsePipeline();
    const rest = [];
    while (this.isOp('&&') || this.isOp('||')) {
      const op = this.next().v;
      this.skipNewlines();
      if (this.eof()) throw new ParseError('unexpected EOF after ' + op, true);
      rest.push({ op, pipe: this.parsePipeline() });
    }
    return { type: 'andor', first, rest };
  }

  parsePipeline() {
    let neg = false;
    if (this.isKw('!')) { this.next(); neg = true; }
    const cmds = [this.parseCommand()];
    while (this.isOp('|')) {
      this.next(); this.skipNewlines();
      if (this.eof()) throw new ParseError('unexpected EOF after |', true);
      cmds.push(this.parseCommand());
    }
    return { type: 'pipeline', neg, cmds };
  }

  expectKw(k) {
    if (this.eof()) throw new ParseError(`unexpected EOF while looking for \`${k}'`, true);
    if (!this.isKw(k)) throw new ParseError(`syntax error near unexpected token \`${this.tokText(this.peek())}'`);
    this.next();
  }

  parseCommand() {
    const t = this.peek();
    if (!t) throw new ParseError('unexpected EOF', true);
    if (t.t === 'op' && t.v === '(') {
      this.next();
      const body = this.parseList([')']);
      if (this.eof()) throw new ParseError('unexpected EOF while looking for `)\'', true);
      this.next();
      return this.withRedirs({ type: 'group', body });
    }
    if (t.t === 'word' && !t.hasQuote) {
      if (t.plain === '{') { this.next(); const body = this.parseList(['}']); this.expectKw('}'); return this.withRedirs({ type: 'group', body }); }
      if (t.plain === 'if') return this.withRedirs(this.parseIf());
      if (t.plain === 'for') return this.withRedirs(this.parseFor());
      if (t.plain === 'while' || t.plain === 'until') return this.withRedirs(this.parseWhile());
    }
    return this.parseSimple();
  }

  parseIf() {
    this.next();
    const clauses = [];
    let els = null;
    let cond = this.parseList(['then']); this.expectKw('then');
    let body = this.parseList(['elif', 'else', 'fi']);
    clauses.push({ cond, body });
    for (;;) {
      if (this.isKw('elif')) { this.next(); cond = this.parseList(['then']); this.expectKw('then'); body = this.parseList(['elif', 'else', 'fi']); clauses.push({ cond, body }); continue; }
      if (this.isKw('else')) { this.next(); els = this.parseList(['fi']); }
      break;
    }
    this.expectKw('fi');
    return { type: 'if', clauses, else: els };
  }

  parseFor() {
    this.next();
    const v = this.next();
    if (!v || v.t !== 'word') throw new ParseError('syntax error: for needs a variable name');
    let words = null;
    this.skipNewlines();
    if (this.isKw('in')) {
      this.next(); words = [];
      while (!this.eof() && this.peek().t === 'word' && !this.isKw('do')) words.push(this.next());
      if (this.isOp(';') || this.isOp('\n')) this.next();
    } else if (this.isOp(';')) this.next();
    this.skipNewlines();
    this.expectKw('do');
    const body = this.parseList(['done']);
    this.expectKw('done');
    return { type: 'for', var: v.plain, words, body };
  }

  parseWhile() {
    const until = this.next().plain === 'until';
    const cond = this.parseList(['do']); this.expectKw('do');
    const body = this.parseList(['done']); this.expectKw('done');
    return { type: 'while', until, cond, body };
  }

  withRedirs(node) { node.redirs = []; this.readRedirs(node.redirs); return node; }

  readRedirs(into) {
    for (;;) {
      const t = this.peek();
      if (!t || t.t !== 'op') return;
      if (['>', '>>', '<', '2>', '2>>', '&>', '&>>', '<<<'].includes(t.v)) {
        this.next();
        const target = this.next();
        if (!target || target.t !== 'word') throw new ParseError("syntax error near unexpected token `newline'");
        into.push({ op: t.v, target });
      } else if (t.v === '2>&1' || t.v === '>&2') { this.next(); into.push({ op: t.v }); }
      else return;
    }
  }

  parseSimple() {
    const node = { type: 'simple', assigns: [], words: [], redirs: [] };
    for (;;) {
      const t = this.peek();
      if (!t) break;
      if (t.t === 'op') {
        if (['>', '>>', '<', '2>', '2>>', '&>', '&>>', '<<<', '2>&1', '>&2'].includes(t.v)) { this.readRedirs(node.redirs); continue; }
        break;
      }
      if (!node.words.length && !t.hasQuote) {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(t.parts[0]?.k === 'lit' && !t.parts[0].q ? t.parts[0].v : '');
        if (m) {
          this.next();
          const first = { ...t.parts[0], v: t.parts[0].v.slice(m[0].length) };
          const parts = [first, ...t.parts.slice(1)].filter((x) => !(x.k === 'lit' && x.v === '' && !x.q));
          node.assigns.push({ name: m[1], word: { t: 'word', parts, plain: null } });
          continue;
        }
      }
      if (!node.words.length && !t.hasQuote && KEYWORDS.has(t.plain) && t.plain !== '!') {
        if (['then', 'else', 'elif', 'fi', 'do', 'done', '}', 'in'].includes(t.plain)) throw new ParseError(`syntax error near unexpected token \`${t.plain}'`);
      }
      node.words.push(this.next());
    }
    if (!node.words.length && !node.assigns.length && !node.redirs.length) {
      throw new ParseError(`syntax error near unexpected token \`${this.tokText(this.peek())}'`);
    }
    return node;
  }
}

export function parse(src) {
  const toks = tokenize(src);
  const p = new Parser(toks);
  const ast = p.parseList();
  if (!p.eof()) throw new ParseError(`syntax error near unexpected token \`${p.tokText(p.peek())}'`);
  return ast;
}
