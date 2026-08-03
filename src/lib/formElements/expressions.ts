/**
 * A small, hand-written, sandboxed expression language for Custom
 * Validation Functions and Calculation fields — deliberately NOT
 * `eval`/`new Function`/`Function(...)`. There is no way for an
 * admin-authored expression to reach the DOM, `window`, `fetch`, or any
 * closure variable: the only data it can ever see is whatever this file's
 * caller explicitly puts in the `context` object (the current form's
 * values, keyed by field name), and the only operations available are the
 * ones implemented in the parser below.
 *
 * Grammar (lowest to highest precedence):
 *   expr       := or
 *   or         := and ( '||' and )*
 *   and        := equality ( '&&' equality )*
 *   equality   := comparison ( ('=='|'!=') comparison )*
 *   comparison := additive ( ('>'|'<'|'>='|'<=') additive )*
 *   additive   := multiplicative ( ('+'|'-') multiplicative )*
 *   multiplicative := unary ( ('*'|'/'|'%') unary )*
 *   unary      := ('!'|'-')? primary
 *   primary    := NUMBER | STRING | 'true' | 'false' | IDENT | '(' expr ')'
 *
 * IDENT resolves against `context` (a field's "Unique Field Name") —
 * anything not present is `undefined`, never a thrown ReferenceError.
 */
import type { ConditionOperator, FieldCondition, ConditionalLogic } from "./types";

interface Token {
  type: "num" | "str" | "ident" | "op" | "lparen" | "rparen";
  value: string;
}

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (c === " " || c === "\t" || c === "\n") { i++; continue; }
    if (c === "(") { tokens.push({ type: "lparen", value: "(" }); i++; continue; }
    if (c === ")") { tokens.push({ type: "rparen", value: ")" }); i++; continue; }
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      let s = "";
      while (i < expr.length && expr[i] !== quote) { s += expr[i]; i++; }
      i++;
      tokens.push({ type: "str", value: s });
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(expr[i + 1] ?? ""))) {
      let s = "";
      while (i < expr.length && /[0-9.]/.test(expr[i])) { s += expr[i]; i++; }
      tokens.push({ type: "num", value: s });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let s = "";
      while (i < expr.length && /[A-Za-z0-9_]/.test(expr[i])) { s += expr[i]; i++; }
      tokens.push({ type: "ident", value: s });
      continue;
    }
    const two = expr.slice(i, i + 2);
    if (["==", "!=", ">=", "<=", "&&", "||"].includes(two)) { tokens.push({ type: "op", value: two }); i += 2; continue; }
    if ("+-*/%<>!".includes(c)) { tokens.push({ type: "op", value: c }); i++; continue; }
    throw new Error(`Unexpected character "${c}" in expression`);
  }
  return tokens;
}

class ExpressionParser {
  private pos = 0;
  constructor(private tokens: Token[], private context: Record<string, any>) {}

  private peek(): Token | undefined { return this.tokens[this.pos]; }
  private isOp(value: string): boolean { return this.peek()?.type === "op" && this.peek()!.value === value; }
  private next(): Token {
    const t = this.tokens[this.pos];
    this.pos += 1;
    if (!t) throw new Error("Unexpected end of expression");
    return t;
  }

  parse(): any {
    const result = this.parseOr();
    if (this.pos < this.tokens.length) throw new Error(`Unexpected token "${this.peek()!.value}"`);
    return result;
  }

  private parseOr(): any {
    let left = this.parseAnd();
    while (this.isOp("||")) { this.next(); left = Boolean(left) || Boolean(this.parseAnd()); }
    return left;
  }
  private parseAnd(): any {
    let left = this.parseEquality();
    while (this.isOp("&&")) { this.next(); left = Boolean(left) && Boolean(this.parseEquality()); }
    return left;
  }
  private parseEquality(): any {
    let left = this.parseComparison();
    while (this.isOp("==") || this.isOp("!=")) {
      const op = this.next().value;
      const right = this.parseComparison();
      // eslint-disable-next-line eqeqeq
      left = op === "==" ? left == right : left != right;
    }
    return left;
  }
  private parseComparison(): any {
    let left = this.parseAdditive();
    while (this.isOp(">") || this.isOp("<") || this.isOp(">=") || this.isOp("<=")) {
      const op = this.next().value;
      const right = this.parseAdditive();
      left = op === ">" ? left > right : op === "<" ? left < right : op === ">=" ? left >= right : left <= right;
    }
    return left;
  }
  private parseAdditive(): any {
    let left = this.parseMultiplicative();
    while (this.isOp("+") || this.isOp("-")) {
      const op = this.next().value;
      const right = this.parseMultiplicative();
      left = op === "+" ? (typeof left === "string" || typeof right === "string" ? String(left) + String(right) : Number(left) + Number(right)) : Number(left) - Number(right);
    }
    return left;
  }
  private parseMultiplicative(): any {
    let left = this.parseUnary();
    while (this.isOp("*") || this.isOp("/") || this.isOp("%")) {
      const op = this.next().value;
      const right = this.parseUnary();
      left = op === "*" ? Number(left) * Number(right) : op === "/" ? Number(left) / Number(right) : Number(left) % Number(right);
    }
    return left;
  }
  private parseUnary(): any {
    if (this.isOp("!")) { this.next(); return !this.parseUnary(); }
    if (this.isOp("-")) { this.next(); return -Number(this.parseUnary()); }
    return this.parsePrimary();
  }
  private parsePrimary(): any {
    const t = this.peek();
    if (!t) throw new Error("Unexpected end of expression");
    if (t.type === "num") { this.next(); return parseFloat(t.value); }
    if (t.type === "str") { this.next(); return t.value; }
    if (t.type === "lparen") {
      this.next();
      const v = this.parseOr();
      if (!this.peek() || this.peek()!.type !== "rparen") throw new Error('Expected ")"');
      this.next();
      return v;
    }
    if (t.type === "ident") {
      this.next();
      if (t.value === "true") return true;
      if (t.value === "false") return false;
      if (t.value === "null") return null;
      return this.context[t.value];
    }
    throw new Error(`Unexpected token "${t.value}"`);
  }
}

/** Throws on a malformed expression — callers decide the fail-closed default (see the two helpers below). */
export function evaluateExpression(expr: string, context: Record<string, any>): unknown {
  if (!expr || !expr.trim()) return undefined;
  return new ExpressionParser(tokenize(expr), context).parse();
}

/** Fails closed to `false` — used for Custom Validation Function (a falsy/error result means "invalid"). */
export function evaluateBooleanExpression(expr: string, context: Record<string, any>): boolean {
  try {
    return Boolean(evaluateExpression(expr, context));
  } catch {
    return false;
  }
}

/** Fails closed to `null` — used for Calculation fields (an error means "no computed value yet"). */
export function evaluateNumericExpression(expr: string, context: Record<string, any>): number | null {
  try {
    const n = Number(evaluateExpression(expr, context));
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function evaluateCondition(condition: FieldCondition, context: Record<string, any>): boolean {
  const actual = context[condition.fieldName];
  const expected = condition.value;
  const isEmpty = actual === undefined || actual === null || actual === "" || (Array.isArray(actual) && actual.length === 0);
  switch (condition.operator as ConditionOperator) {
    case "equals": return String(actual ?? "") === String(expected ?? "");
    case "notEquals": return String(actual ?? "") !== String(expected ?? "");
    case "contains": return String(actual ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase());
    case "greaterThan": return Number(actual) > Number(expected);
    case "lessThan": return Number(actual) < Number(expected);
    case "isEmpty": return isEmpty;
    case "isNotEmpty": return !isEmpty;
    default: return false;
  }
}

/** Whether a field's conditionalLogic conditions currently hold (all/any) — the caller applies `.action` (show/hide/enable/disable) on top of this. */
export function checkConditions(logic: ConditionalLogic | null | undefined, context: Record<string, any>): boolean {
  if (!logic || logic.conditions.length === 0) return false;
  const results = logic.conditions.map((c) => evaluateCondition(c, context));
  return logic.match === "all" ? results.every(Boolean) : results.some(Boolean);
}
