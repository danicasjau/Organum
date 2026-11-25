/**
 * Safe recursive-descent arithmetic expression evaluator for NumberField.
 * Supports +, -, *, /, parentheses, unary +/-, and decimal numbers.
 * Never uses eval() or Function().
 */
export function evalNumericExpression(input: string): number | null {
  const src = input.trim();
  if (!src) return null;
  let pos = 0;

  const skipWs = () => {
    while (pos < src.length && /\s/.test(src[pos]!)) pos++;
  };

  const parseExpr = (): number | null => {
    let left = parseTerm();
    if (left === null) return null;
    while (true) {
      skipWs();
      const ch = src[pos];
      if (ch === '+' || ch === '-') {
        pos++;
        const right = parseTerm();
        if (right === null) return null;
        left = ch === '+' ? left + right : left - right;
      } else {
        break;
      }
    }
    return left;
  };

  const parseTerm = (): number | null => {
    let left = parseFactor();
    if (left === null) return null;
    while (true) {
      skipWs();
      const ch = src[pos];
      if (ch === '*' || ch === '/') {
        pos++;
        const right = parseFactor();
        if (right === null) return null;
        if (ch === '/') {
          if (right === 0) return null;
          left = left / right;
        } else {
          left = left * right;
        }
      } else {
        break;
      }
    }
    return left;
  };

  const parseFactor = (): number | null => {
    skipWs();
    const ch = src[pos];
    if (ch === '+' || ch === '-') {
      pos++;
      const inner = parseFactor();
      if (inner === null) return null;
      return ch === '-' ? -inner : inner;
    }
    if (ch === '(') {
      pos++;
      const inner = parseExpr();
      if (inner === null) return null;
      skipWs();
      if (src[pos] !== ')') return null;
      pos++;
      return inner;
    }
    const rest = src.slice(pos);
    const numMatch = rest.match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
    if (!numMatch) return null;
    pos += numMatch[0].length;
    const n = Number(numMatch[0]);
    return Number.isFinite(n) ? n : null;
  };

  const result = parseExpr();
  skipWs();
  if (result === null || pos !== src.length || !Number.isFinite(result)) {
    return null;
  }
  return result;
}

