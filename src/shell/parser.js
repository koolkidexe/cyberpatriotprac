// Bash-like lexer and parser. Produces a small AST that Shell.exec* walks.
// Supported: quotes, escapes, $VAR/${VAR}/$(cmd)/`cmd`/$((arith)), pipes, && || ; &, redirections,
// for / while / until / if compound commands, ( ) subshells and { } groups.

export class ParseError extends Error {}

const OPS = ['2>&1', '&>>', '2>>', '&>', '>>', '||', '&&', '2>', '>&', '<', '>', '|', ';', '&', '(', ')'];
const RESERVED = new Set(['for', 'in', 'do', 'done', 'if', 'then', 'elif', 'else', 'fi', 'while', 'until', '{', '}', '!']);

/** Find the index of the ")" matching an already-opened "(" at `i` (text[i] is the first char after "("). */
function matchParen(s, i) {
  let depth = 1;
  let q = null;
  for (; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; else if (c === '\\' && q === '"') i++; continue; }
    if (c === "'" || c === '"') q = c;
    else if (c === '\\') i++;
    else if (c === '(') depth++;
    else if (c === ')') { if (--depth === 0) return i; }
  }
  throw new ParseError('syntax error: unexpected end of file');
}

export function tokenize(src) {
  const toks = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (c === '\n') { toks.push({ t: 'op', v: ';', nl: true }); i++; continue; }
    if (c === '#') { while (i < n && src[i] !== '\n') i++; continue; }
    // operators ("2>" only counts when it starts a word)
    let matched = null;
    for (const op of OPS) {
      if (src.startsWith(op, i)) {
        if (op[0] === '2' && i > 0 && !/[\s;&|(]/.test(src[i - 1])) continue;
        matched = op; break;
      }
    }
    if (matched) { toks.push({ t: 'op', v: matched }); i += matched.length; continue; }
    // a word
    const segs = [];
    let lit = '';
    const flush = () => { if (lit) { segs.push({ k: 'lit', v: lit }); lit = ''; } };
    while (i < n) {
      const ch = src[i];
      if (ch === ' ' || ch === '\t' || ch === '\n') break;
      if (ch === ';' || ch === '|' || ch === '&' || ch === '(' || ch === ')' || ch === '<' || ch === '>') break;
      if (ch === '\\') {
        if (src[i + 1] === '\n') { i += 2; continue; }
        flush(); segs.push({ k: 'sq', v: src[i + 1] ?? '\\' }); i += 2; continue;
      }
      if (ch === "'") {
        flush();
        const j = src.indexOf("'", i + 1);
        if (j < 0) throw new ParseError("unexpected EOF while looking for matching `''");
        segs.push({ k: 'sq', v: src.slice(i + 1, j), word: true }); i = j + 1; continue;
      }
      if (ch === '"') {
        flush();
        i++;
        let buf = '';
        const fl = () => { if (buf) { segs.push({ k: 'dq', v: buf }); buf = ''; } };
        let closed = false;
        while (i < n) {
          const d = src[i];
          if (d === '"') { closed = true; i++; break; }
          if (d === '\\' && i + 1 < n && '"\\$`\n'.includes(src[i + 1])) { if (src[i + 1] !== '\n') { fl(); segs.push({ k: 'sq', v: src[i + 1] }); } i += 2; continue; }
          if (d === '$' && src[i + 1] === '(') {
            fl();
            if (src[i + 2] === '(') { const j = matchParen(src, i + 2); segs.push({ k: 'arith', v: src.slice(i + 3, j - 1), quoted: true }); i = j + 1; continue; }
            const j = matchParen(src, i + 2); segs.push({ k: 'cmd', v: src.slice(i + 2, j), quoted: true }); i = j + 1; continue;
          }
          if (d === '`') { fl(); const j = src.indexOf('`', i + 1); if (j < 0) throw new ParseError('unexpected EOF while looking for matching ``\''); segs.push({ k: 'cmd', v: src.slice(i + 1, j), quoted: true }); i = j + 1; continue; }
          buf += d; i++;
        }
        if (!closed) throw new ParseError('unexpected EOF while looking for matching `"\'');
        fl();
        segs.push({ k: 'dqmark' }); // ensures "" counts as a present (empty) word
        continue;
      }
      if (ch === '$' && src[i + 1] === '(') {
        flush();
        if (src[i + 2] === '(') { const j = matchParen(src, i + 2); segs.push({ k: 'arith', v: src.slice(i + 3, j - 1) }); i = j + 1; continue; }
        const j = matchParen(src, i + 2); segs.push({ k: 'cmd', v: src.slice(i + 2, j) }); i = j + 1; continue;
      }
      if (ch === '`') { flush(); const j = src.indexOf('`', i + 1); if (j < 0) throw new ParseError('unexpected EOF while looking for matching ``\''); segs.push({ k: 'cmd', v: src.slice(i + 1, j) }); i = j + 1; continue; }
      lit += ch; i++;
    }
    flush();
    toks.push({ t: 'word', segs });
  }
  return toks;
}

const plain = (tok) => (tok.t === 'word' && tok.segs.length === 1 && tok.segs[0].k === 'lit' ? tok.segs[0].v : null);
const isAssign = (tok) => {
  if (tok.t !== 'word' || !tok.segs.length || tok.segs[0].k !== 'lit') return null;
  const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(tok.segs[0].v);
  if (!m) return null;
  return { name: m[1], rest: m[2] };
};

export function parse(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (t, v) => t && t.t === 'op' && t.v === v;
  const isKw = (t, v) => t && plain(t) === v;
  const skipSemis = () => { while (peek() && isOp(peek(), ';')) p++; };

  function parseList(stops = []) {
    const items = [];
    skipSemis();
    while (peek()) {
      const t = peek();
      if (isOp(t, ')') || stops.some((s) => isKw(t, s))) break;
      const node = parseAndOr(stops);
      let bg = false;
      if (peek() && isOp(peek(), '&')) { bg = true; p++; }
      else if (peek() && isOp(peek(), ';')) p++;
      items.push({ node, bg });
      skipSemis();
    }
    return { type: 'list', items };
  }

  function parseAndOr(stops) {
    const first = parsePipeline(stops);
    const rest = [];
    while (peek() && (isOp(peek(), '&&') || isOp(peek(), '||'))) {
      const op = peek().v; p++;
      while (peek() && isOp(peek(), ';') && peek().nl) p++;
      rest.push([op, parsePipeline(stops)]);
    }
    return rest.length ? { type: 'andor', first, rest } : first;
  }

  function parsePipeline(stops) {
    let neg = false;
    if (peek() && isKw(peek(), '!')) { neg = true; p++; }
    const cmds = [parseCommand(stops)];
    while (peek() && isOp(peek(), '|')) {
      p++;
      while (peek() && isOp(peek(), ';') && peek().nl) p++;
      cmds.push(parseCommand(stops));
    }
    return cmds.length === 1 && !neg ? cmds[0] : { type: 'pipe', cmds, neg };
  }

  function expectKw(k) {
    skipSemis();
    if (!isKw(peek(), k)) throw new ParseError(`syntax error: expected '${k}'`);
    p++;
  }

  function parseRedirs(node) {
    const redirs = [];
    while (peek() && peek().t === 'op' && ['>', '>>', '<', '2>', '2>>', '&>', '&>>', '2>&1', '>&'].includes(peek().v)) {
      const op = peek().v; p++;
      if (op === '2>&1') { redirs.push({ op }); continue; }
      const target = peek();
      if (!target || target.t !== 'word') throw new ParseError("syntax error near unexpected token `newline'");
      p++;
      redirs.push({ op, target });
    }
    if (redirs.length) return { type: 'redir', node, redirs };
    return node;
  }

  function parseCommand(stops) {
    const t = peek();
    if (!t) throw new ParseError("syntax error: unexpected end of file");
    if (isKw(t, 'for')) {
      p++;
      const vt = peek(); p++;
      const name = vt && plain(vt);
      if (!name) throw new ParseError("syntax error near unexpected token `for'");
      let words = null;
      skipSemis();
      if (isKw(peek(), 'in')) {
        p++; words = [];
        while (peek() && peek().t === 'word' && !(isOp(peek(), ';'))) words.push(toks[p++]);
      }
      skipSemis();
      expectKw('do');
      const body = parseList(['done']);
      expectKw('done');
      return parseRedirs({ type: 'for', name, words, body });
    }
    if (isKw(t, 'while') || isKw(t, 'until')) {
      const until = isKw(t, 'until'); p++;
      const cond = parseList(['do']);
      expectKw('do');
      const body = parseList(['done']);
      expectKw('done');
      return parseRedirs({ type: 'while', until, cond, body });
    }
    if (isKw(t, 'if')) {
      p++;
      const branches = [];
      let els = null;
      let cond = parseList(['then']);
      expectKw('then');
      let body = parseList(['elif', 'else', 'fi']);
      branches.push([cond, body]);
      for (;;) {
        skipSemis();
        if (isKw(peek(), 'elif')) { p++; cond = parseList(['then']); expectKw('then'); body = parseList(['elif', 'else', 'fi']); branches.push([cond, body]); continue; }
        if (isKw(peek(), 'else')) { p++; els = parseList(['fi']); }
        break;
      }
      expectKw('fi');
      return parseRedirs({ type: 'if', branches, els });
    }
    if (isOp(t, '(')) {
      p++;
      const body = parseList();
      if (!isOp(peek(), ')')) throw new ParseError("syntax error: expected ')'");
      p++;
      return parseRedirs({ type: 'subshell', body });
    }
    if (isKw(t, '{')) {
      p++;
      const body = parseList(['}']);
      expectKw('}');
      return parseRedirs({ type: 'group', body });
    }
    return parseSimple(stops);
  }

  function parseSimple(stops) {
    const assigns = [];
    const words = [];
    const redirs = [];
    while (peek()) {
      const t = peek();
      if (t.t === 'op') {
        if (['>', '>>', '<', '2>', '2>>', '&>', '&>>', '2>&1', '>&'].includes(t.v)) {
          p++;
          if (t.v === '2>&1') { redirs.push({ op: t.v }); continue; }
          const target = peek();
          if (!target || target.t !== 'word') throw new ParseError("syntax error near unexpected token `newline'");
          p++;
          redirs.push({ op: t.v, target });
          continue;
        }
        break;
      }
      if (words.length === 0) {
        const kw = plain(t);
        if (kw && RESERVED.has(kw) && stops.includes(kw)) break;
        if (kw && ['then', 'do', 'done', 'fi', 'else', 'elif', 'esac', '}'].includes(kw) && !stops.includes(kw)) throw new ParseError(`syntax error near unexpected token \`${kw}'`);
        const a = isAssign(t);
        if (a) {
          p++;
          const segs = [{ k: 'lit', v: a.rest }, ...t.segs.slice(1)].filter((s) => s.v !== '' || s.k !== 'lit');
          assigns.push({ name: a.name, word: { t: 'word', segs } });
          continue;
        }
      } else if (stops.length && plain(t) && stops.includes(plain(t)) && false) break;
      words.push(t); p++;
    }
    if (!words.length && !assigns.length && !redirs.length) {
      const t = peek();
      throw new ParseError(`syntax error near unexpected token \`${t ? (t.t === 'op' ? t.v : plain(t) || 'word') : 'newline'}'`);
    }
    return { type: 'simple', assigns, words, redirs };
  }

  const ast = parseList();
  if (p < toks.length) {
    const t = toks[p];
    throw new ParseError(`syntax error near unexpected token \`${t.t === 'op' ? t.v : plain(t) || 'word'}'`);
  }
  return ast;
}
