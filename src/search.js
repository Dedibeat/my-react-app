/* ------------------ search expression parsing & evaluation ------------------ */
export function tokenizeSearch(input) {
  const tokens = [];
  const re = /\s*("([^"]+)"|\(|\)|\||-?[^()|\s"]+)\s*/g;
  let m;
  while ((m = re.exec(input)) !== null) {
    let t = m[1];
    const lower = t.toLowerCase();
    if (lower === 'and') tokens.push({type: 'AND'});
    else if (lower === 'or') tokens.push({type: 'OR'});
    else if (lower === 'not') tokens.push({type: 'NOT'});
    else if (t === '|') tokens.push({type: 'OR'});
    else if (t === '(') tokens.push({type: '('});
    else if (t === ')') tokens.push({type: ')'});
    else {
      if (t.startsWith('-')) {
        tokens.push({type: 'NOT'});
        t = t.slice(1);
      }
      const phrase = (m[2] !== undefined) ? m[2] : t;
      tokens.push({type: 'TERM', text: phrase.toLowerCase()});
    }
  }
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    if (i > 0) {
      const prev = tokens[i - 1];
      const cur = tokens[i];
      const prevIsAtom = prev.type === 'TERM' || prev.type === ')';
      const curIsAtom = cur.type === 'TERM' || cur.type === '(';
      const curIsUnary = cur.type === 'NOT';
      const needAnd = prevIsAtom && (curIsAtom || curIsUnary);
      if (needAnd) out.push({type: 'AND'});
    }
    out.push(tokens[i]);
  }
  return out;
}

function parseSearchTokens(tokens) {
  let i = 0;
  function peek() { return tokens[i]; }
  function consume(expectedType) {
    const t = tokens[i];
    if (!t || (expectedType && t.type !== expectedType)) return null;
    i++;
    return t;
  }
  function parseExpr() {
    let node = parseAnd();
    while (peek() && peek().type === 'OR') {
      consume('OR');
      const right = parseAnd();
      node = {type: 'OR', left: node, right};
    }
    return node;
  }
  function parseAnd() {
    let node = parseNot();
    while (peek() && peek().type === 'AND') {
      consume('AND');
      const right = parseNot();
      node = {type: 'AND', left: node, right};
    }
    return node;
  }
  function parseNot() {
    if (peek() && peek().type === 'NOT') {
      consume('NOT');
      const operand = parseNot();
      return {type: 'NOT', operand};
    }
    return parseFactor();
  }
  function parseFactor() {
    const t = peek();
    if (!t) return {type: 'TERM', text: ''};
    if (t.type === '(') {
      consume('(');
      const node = parseExpr();
      if (peek() && peek().type === ')') consume(')');
      return node;
    }
    if (t.type === 'TERM') {
      consume('TERM');
      return {type: 'TERM', text: t.text};
    }
    i++;
    return {type: 'TERM', text: ''};
  }
  return parseExpr();
}

export function parseSearch(input) {
  const tokens = tokenizeSearch(input);
  if (!tokens.length) return null;
  return parseSearchTokens(tokens);
}

export function evalSearchAst(node, hay) {
  if (!node) return true;
  switch (node.type) {
    case 'TERM':
      return node.text.length ? hay.includes(node.text) : true;
    case 'NOT':
      return !evalSearchAst(node.operand, hay);
    case 'AND':
      return evalSearchAst(node.left, hay) && evalSearchAst(node.right, hay);
    case 'OR':
      return evalSearchAst(node.left, hay) || evalSearchAst(node.right, hay);
    default:
      return true;
  }
}