// Persora Table — formula engine for the documented subset only.
//
// Supported: numbers, "strings", TRUE/FALSE, + - * / (with unary minus/plus),
// comparisons = <> < > <= >= (useful inside IF), parentheses, cell references
// (A1, $A$1, A$1, $A1), ranges (A1:B5), references to other sheets
// (Sheet2!A1, 'My sheet'!A1:B2) and the functions SUM, AVERAGE, COUNT, COUNTA,
// MIN, MAX and IF.
//
// Safety: formulas are tokenized and parsed by the small grammar below into a
// plain data tree, and evaluated by a switch over node types. Nothing is ever
// passed to eval/Function, there is no property access, no host objects, no
// I/O and no network — a formula can only read other cells of the same table.
// Size, nesting depth and range area are capped.
//
// Errors are values, never exceptions, so one bad cell never breaks the sheet:
//   #ERROR!  the formula could not be parsed (its text is kept as entered)
//   #DIV/0!  division by zero / AVERAGE of nothing
//   #REF!    a reference to a deleted row/column/sheet or outside the sheet
//   #NAME?   an unknown or unsupported function or name
//   #VALUE!  a value of the wrong type (e.g. "abc" * 2, a range used as a value)
//   #CYCLE!  the cell depends on itself (circular reference)

export const SUPPORTED_FUNCTIONS = Object.freeze(["SUM", "AVERAGE", "COUNT", "COUNTA", "MIN", "MAX", "IF"]);
export const FORMULA_ERRORS = Object.freeze({
  PARSE: "#ERROR!", DIV0: "#DIV/0!", REF: "#REF!", NAME: "#NAME?", VALUE: "#VALUE!", CYCLE: "#CYCLE!",
});
export const FORMULA_LIMITS = Object.freeze({ length: 2000, depth: 48, args: 255, rangeCells: 2_000_000, maxCol: 18_278, maxRow: 1_048_576 });

const ERROR_CODES = new Set(Object.values(FORMULA_ERRORS));

/** A formula error value. `message` explains it in plain words for the UI. */
export function formulaError(code, message) {
  return { error: code, message: message || defaultMessage(code) };
}
function defaultMessage(code) {
  switch (code) {
    case FORMULA_ERRORS.DIV0: return "Division by zero.";
    case FORMULA_ERRORS.REF: return "This formula refers to a cell, row, column or sheet that doesn't exist.";
    case FORMULA_ERRORS.NAME: return "Unknown name or function.";
    case FORMULA_ERRORS.VALUE: return "A value has the wrong type for this calculation.";
    case FORMULA_ERRORS.CYCLE: return "Circular reference: this cell depends on itself.";
    default: return "This formula can't be read.";
  }
}
export function isFormulaError(value) {
  return Boolean(value) && typeof value === "object" && typeof value.error === "string" && ERROR_CODES.has(value.error);
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

export function columnName(index) {
  let n = Math.floor(index) + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}
export function columnIndex(name) {
  let n = 0;
  for (const ch of String(name).toUpperCase()) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) return -1;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}
/** "B3" → {row: 2, col: 1}. Returns null for anything else. */
export function parseAddress(text) {
  const match = /^\$?([A-Za-z]{1,3})\$?([1-9]\d{0,6})$/u.exec(String(text).trim());
  if (!match) return null;
  const col = columnIndex(match[1]);
  const row = Number(match[2]) - 1;
  if (col < 0 || col >= FORMULA_LIMITS.maxCol || row >= FORMULA_LIMITS.maxRow) return null;
  return { row, col };
}
export function addressName(row, col) {
  return `${columnName(col)}${row + 1}`;
}
export function cellKey(row, col) {
  return `${row}:${col}`;
}

// Sheet names that need quotes inside formulas: anything that is not a plain
// identifier, or that could be mistaken for a cell reference / boolean.
export function quoteSheetName(name) {
  const plain = /^[A-Za-z_][A-Za-z0-9_.]*$/u.test(name) && !/^[A-Za-z]{1,3}\d+$/u.test(name) && !/^(true|false)$/iu.test(name);
  return plain ? name : `'${String(name).replace(/'/gu, "''")}'`;
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

const REF_PART = String.raw`\$?[A-Za-z]{1,3}\$?[1-9]\d{0,6}`;
const SHEET_PREFIX = String.raw`(?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!`;
const REF_RE = new RegExp(String.raw`^(${SHEET_PREFIX})?(${REF_PART})(?::(${REF_PART}))?`, "u");
const NUMBER_RE = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/u;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_.]*/u;

class ParseError extends Error {
  constructor(message, code = FORMULA_ERRORS.PARSE) {
    super(message);
    this.code = code;
  }
}

function parseRefPart(text) {
  const match = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/u.exec(text);
  const col = columnIndex(match[2]);
  const row = Number(match[4]) - 1;
  if (col < 0 || col >= FORMULA_LIMITS.maxCol || row < 0 || row >= FORMULA_LIMITS.maxRow) throw new ParseError(`${text} is outside the sheet.`, FORMULA_ERRORS.REF);
  return { col, row, absCol: match[1] === "$", absRow: match[3] === "$" };
}
function unquoteSheet(prefix) {
  if (!prefix) return null;
  const name = prefix.slice(0, -1);
  return name.startsWith("'") ? name.slice(1, -1).replace(/''/gu, "'") : name;
}

/** Splits a formula body (without the leading "=") into tokens with positions. */
export function tokenize(body) {
  const tokens = [];
  let i = 0;
  const text = String(body);
  while (i < text.length) {
    const rest = text.slice(i);
    const ch = text[i];
    if (/\s/u.test(ch)) { i += 1; continue; }
    if (ch === '"') {
      let j = i + 1;
      let value = "";
      for (;;) {
        if (j >= text.length) throw new ParseError("A text value is missing its closing quote.");
        if (text[j] === '"') {
          if (text[j + 1] === '"') { value += '"'; j += 2; continue; }
          break;
        }
        value += text[j];
        j += 1;
      }
      tokens.push({ type: "str", value, start: i, end: j + 1 });
      i = j + 1;
      continue;
    }
    if (rest.startsWith("#REF!")) { tokens.push({ type: "referr", start: i, end: i + 5 }); i += 5; continue; }
    const ref = REF_RE.exec(rest);
    if (ref && !/^[A-Za-z0-9_.(!]/u.test(rest.slice(ref[0].length))) {
      tokens.push({ type: "ref", text: ref[0], sheet: unquoteSheet(ref[1]), a: ref[2], b: ref[3] || null, start: i, end: i + ref[0].length });
      i += ref[0].length;
      continue;
    }
    if (ch === "'") {
      // A quoted sheet name followed by something other than a cell reference.
      throw new ParseError("A sheet reference must be followed by a cell, e.g. 'My sheet'!A1.");
    }
    const number = NUMBER_RE.exec(rest);
    if (number) { tokens.push({ type: "num", value: Number(number[0]), start: i, end: i + number[0].length }); i += number[0].length; continue; }
    const ident = IDENT_RE.exec(rest);
    if (ident) {
      const after = rest.slice(ident[0].length);
      if (after.startsWith("!")) throw new ParseError(`${ident[0]}! must be followed by a cell reference such as ${ident[0]}!A1.`);
      if (after.startsWith(":")) throw new ParseError("Whole-column and whole-row references (like A:A) aren't supported. Use a range such as A1:A100.");
      tokens.push({ type: "ident", value: ident[0], start: i, end: i + ident[0].length });
      i += ident[0].length;
      continue;
    }
    const two = rest.slice(0, 2);
    if (two === "<>" || two === "<=" || two === ">=") { tokens.push({ type: "op", value: two, start: i, end: i + 2 }); i += 2; continue; }
    if ("+-*/=<>(),".includes(ch)) { tokens.push({ type: ch === "(" || ch === ")" || ch === "," ? ch : "op", value: ch, start: i, end: i + 1 }); i += 1; continue; }
    if (ch === "&" || ch === "^" || ch === "%") throw new ParseError(`The ${ch} operator isn't supported here.`);
    if (ch === ":") throw new ParseError("A range needs a cell on both sides of the colon, e.g. A1:B5.");
    throw new ParseError(`Unexpected character “${ch}”.`);
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser (recursive descent; precedence: comparison < additive < multiplicative < unary)
// ---------------------------------------------------------------------------

export function parseFormula(source) {
  const text = String(source ?? "");
  if (!text.startsWith("=")) throw new ParseError("A formula starts with =.");
  if (text.length > FORMULA_LIMITS.length) throw new ParseError(`Formulas can be at most ${FORMULA_LIMITS.length} characters.`);
  const tokens = tokenize(text.slice(1));
  if (!tokens.length) throw new ParseError("The formula is empty.");
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const isOp = (values) => peek()?.type === "op" && values.includes(peek().value);

  function expression(depth) {
    if (depth > FORMULA_LIMITS.depth) throw new ParseError("The formula is nested too deeply.");
    let left = additive(depth);
    if (isOp(["=", "<>", "<", ">", "<=", ">="])) {
      const op = next().value;
      const right = additive(depth);
      left = { type: "bin", op, left, right };
      if (isOp(["=", "<>", "<", ">", "<=", ">="])) throw new ParseError("Chain comparisons with IF instead, e.g. IF(A1>1, …).");
    }
    return left;
  }
  function additive(depth) {
    let left = term(depth);
    while (isOp(["+", "-"])) left = { type: "bin", op: next().value, left, right: term(depth) };
    return left;
  }
  function term(depth) {
    let left = unary(depth);
    while (isOp(["*", "/"])) left = { type: "bin", op: next().value, left, right: unary(depth) };
    return left;
  }
  function unary(depth) {
    if (isOp(["-", "+"])) {
      if (depth > FORMULA_LIMITS.depth) throw new ParseError("The formula is nested too deeply.");
      return { type: "unary", op: next().value, arg: unary(depth + 1) };
    }
    return primary(depth);
  }
  function primary(depth) {
    const token = next();
    if (!token) throw new ParseError("The formula ends unexpectedly.");
    switch (token.type) {
      case "num": return { type: "num", value: token.value };
      case "str": return { type: "str", value: token.value };
      case "referr": return { type: "referr" };
      case "ref": {
        const a = parseRefPart(token.a);
        if (!token.b) return { type: "ref", sheet: token.sheet, ...a };
        const b = parseRefPart(token.b);
        return { type: "range", sheet: token.sheet, start: a, end: b };
      }
      case "(": {
        const inner = expression(depth + 1);
        if (next()?.type !== ")") throw new ParseError("A closing parenthesis is missing.");
        return inner;
      }
      case "ident": {
        const upper = token.value.toUpperCase();
        if (peek()?.type === "(") {
          next();
          const args = [];
          if (peek()?.type !== ")") {
            for (;;) {
              if (peek()?.type === "," || peek()?.type === ")") throw new ParseError(`${upper} has an empty argument.`);
              args.push(expression(depth + 1));
              if (args.length > FORMULA_LIMITS.args) throw new ParseError(`${upper} has too many arguments.`);
              if (peek()?.type === ",") { next(); continue; }
              break;
            }
          }
          if (next()?.type !== ")") throw new ParseError(`${upper}( is missing its closing parenthesis.`);
          return { type: "func", name: upper, args };
        }
        if (upper === "TRUE" || upper === "FALSE") return { type: "bool", value: upper === "TRUE" };
        return { type: "name", name: token.value };
      }
      case ")": throw new ParseError("There is an extra closing parenthesis.");
      case ",": throw new ParseError("Commas can only separate function arguments.");
      default: throw new ParseError(`“${token.value}” is in an unexpected place.`);
    }
  }

  const ast = expression(0);
  if (pos < tokens.length) {
    const extra = tokens[pos];
    throw new ParseError(extra.type === ")" ? "There is an extra closing parenthesis." : `Unexpected “${extra.value ?? extra.text ?? extra.type}” — is an operator missing?`);
  }
  validateFunctions(ast);
  return ast;
}

function validateFunctions(node) {
  if (!node || typeof node !== "object") return;
  if (node.type === "func") {
    if (!SUPPORTED_FUNCTIONS.includes(node.name)) {
      const error = new ParseError(`${node.name} isn't supported. Available functions: ${SUPPORTED_FUNCTIONS.join(", ")}.`, FORMULA_ERRORS.NAME);
      throw error;
    }
    if (node.name === "IF" && (node.args.length < 2 || node.args.length > 3)) throw new ParseError("IF needs 2 or 3 arguments: IF(condition, value if true, value if false).");
    if (node.name !== "IF" && node.args.length === 0) throw new ParseError(`${node.name} needs at least one argument.`);
    node.args.forEach(validateFunctions);
  } else if (node.type === "bin") { validateFunctions(node.left); validateFunctions(node.right); }
  else if (node.type === "unary") validateFunctions(node.arg);
}

/**
 * Checks a formula without evaluating it.
 * @returns {{ok: true, ast: object} | {ok: false, error: {error: string, message: string}}}
 */
export function checkFormula(source) {
  try {
    return { ok: true, ast: parseFormula(source) };
  } catch (error) {
    if (error instanceof ParseError) return { ok: false, error: formulaError(error.code, error.message) };
    return { ok: false, error: formulaError(FORMULA_ERRORS.PARSE) };
  }
}

/** Every cell rectangle a parsed formula reads: [{sheet, r1, c1, r2, c2}] (sheet null = own sheet). */
export function formulaDependencies(ast) {
  const out = [];
  const walk = (node) => {
    if (!node) return;
    if (node.type === "ref") out.push({ sheet: node.sheet, r1: node.row, c1: node.col, r2: node.row, c2: node.col });
    else if (node.type === "range") out.push({ sheet: node.sheet, r1: Math.min(node.start.row, node.end.row), c1: Math.min(node.start.col, node.end.col), r2: Math.max(node.start.row, node.end.row), c2: Math.max(node.start.col, node.end.col) });
    else if (node.type === "bin") { walk(node.left); walk(node.right); }
    else if (node.type === "unary") walk(node.arg);
    else if (node.type === "func") node.args.forEach(walk);
  };
  walk(ast);
  return out;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

const RANGE = Symbol("range");

function toNumber(value) {
  if (isFormulaError(value)) return value;
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : formulaError(FORMULA_ERRORS.VALUE);
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(trimmed)) return Number(trimmed);
    return formulaError(FORMULA_ERRORS.VALUE, `“${value.length > 24 ? `${value.slice(0, 24)}…` : value}” is text, not a number.`);
  }
  return formulaError(FORMULA_ERRORS.VALUE);
}
function toBoolean(value) {
  if (isFormulaError(value)) return value;
  if (value === null || value === undefined || value === "") return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const upper = value.trim().toUpperCase();
    if (upper === "TRUE") return true;
    if (upper === "FALSE") return false;
  }
  return formulaError(FORMULA_ERRORS.VALUE, "The IF condition must be TRUE/FALSE or a number.");
}
function typeRank(value) {
  if (typeof value === "number") return 0;
  if (typeof value === "string") return 1;
  return 2; // boolean
}
function compare(op, a, b) {
  if (isFormulaError(a)) return a;
  if (isFormulaError(b)) return b;
  // Blank behaves as 0 next to numbers and "" next to text (spreadsheet rules).
  if (a === null || a === undefined) a = typeof b === "string" ? "" : typeof b === "boolean" ? false : 0;
  if (b === null || b === undefined) b = typeof a === "string" ? "" : typeof a === "boolean" ? false : 0;
  let diff;
  if (typeRank(a) !== typeRank(b)) diff = typeRank(a) - typeRank(b);
  else if (typeof a === "string") { const x = a.toLowerCase(); const y = b.toLowerCase(); diff = x < y ? -1 : x > y ? 1 : 0; }
  else diff = Number(a) - Number(b);
  switch (op) {
    case "=": return diff === 0;
    case "<>": return diff !== 0;
    case "<": return diff < 0;
    case ">": return diff > 0;
    case "<=": return diff <= 0;
    default: return diff >= 0;
  }
}
function finite(value) {
  return Number.isFinite(value) ? value : formulaError(FORMULA_ERRORS.VALUE, "The result is too large.");
}

/**
 * Evaluates a parsed formula.
 * @param {object} ast
 * @param {{ read(sheet: string|null, row: number, col: number): any, sheetExists(sheet: string|null): boolean, bounds?(sheet: string|null): {rows: number, cols: number} }} env
 */
export function evaluate(ast, env) {
  const value = evalNode(ast, env);
  if (value && value[RANGE]) {
    // A single-cell range used as a whole formula (=A1:A1) is that cell.
    if (value.cells.length === 1) return normalizeResult(value.cells[0]);
    return formulaError(FORMULA_ERRORS.VALUE, "A range can't be the result of a cell. Wrap it in a function such as SUM.");
  }
  return normalizeResult(value);
}
function normalizeResult(value) {
  if (value === null || value === undefined) return 0; // =A1 where A1 is blank shows 0
  if (typeof value === "number") return finite(value);
  return value;
}

function readRange(node, env) {
  if (!env.sheetExists(node.sheet)) return formulaError(FORMULA_ERRORS.REF, `The sheet “${node.sheet}” doesn't exist.`);
  const r1 = Math.min(node.start.row, node.end.row);
  const r2 = Math.max(node.start.row, node.end.row);
  const c1 = Math.min(node.start.col, node.end.col);
  const c2 = Math.max(node.start.col, node.end.col);
  if ((r2 - r1 + 1) * (c2 - c1 + 1) > FORMULA_LIMITS.rangeCells) return formulaError(FORMULA_ERRORS.VALUE, "That range is too large.");
  const bounds = env.bounds ? env.bounds(node.sheet) : null;
  const cells = [];
  // Only cells inside the sheet hold data; reading past the edge is blank.
  const rEnd = bounds ? Math.min(r2, bounds.rows - 1) : r2;
  const cEnd = bounds ? Math.min(c2, bounds.cols - 1) : c2;
  for (let r = r1; r <= rEnd; r += 1) for (let c = c1; c <= cEnd; c += 1) cells.push(env.read(node.sheet, r, c));
  return { [RANGE]: true, cells };
}

function evalNode(node, env) {
  switch (node.type) {
    case "num": return node.value;
    case "str": return node.value;
    case "bool": return node.value;
    case "referr": return formulaError(FORMULA_ERRORS.REF);
    case "name": return formulaError(FORMULA_ERRORS.NAME, `“${node.name}” isn't a function, cell or value this formula understands. Text must be in "quotes".`);
    case "ref": {
      if (!env.sheetExists(node.sheet)) return formulaError(FORMULA_ERRORS.REF, `The sheet “${node.sheet}” doesn't exist.`);
      return env.read(node.sheet, node.row, node.col);
    }
    case "range": return readRange(node, env);
    case "unary": {
      const value = scalar(evalNode(node.arg, env));
      const number = toNumber(value);
      if (isFormulaError(number)) return number;
      return node.op === "-" ? -number : number;
    }
    case "bin": {
      const left = scalar(evalNode(node.left, env));
      const right = scalar(evalNode(node.right, env));
      if (["=", "<>", "<", ">", "<=", ">="].includes(node.op)) return compare(node.op, left, right);
      const a = toNumber(left);
      if (isFormulaError(a)) return a;
      const b = toNumber(right);
      if (isFormulaError(b)) return b;
      switch (node.op) {
        case "+": return finite(a + b);
        case "-": return finite(a - b);
        case "*": return finite(a * b);
        default: return b === 0 ? formulaError(FORMULA_ERRORS.DIV0) : finite(a / b);
      }
    }
    case "func": return callFunction(node, env);
    default: return formulaError(FORMULA_ERRORS.PARSE);
  }
}
function scalar(value) {
  if (value && value[RANGE]) {
    if (value.cells.length === 1) return value.cells[0];
    return formulaError(FORMULA_ERRORS.VALUE, "A range can only be used inside a function such as SUM.");
  }
  return value;
}

/** Numbers from function arguments, spreadsheet-style: ranges skip text/booleans/blanks; direct arguments are coerced. */
function collectNumbers(args, env) {
  const numbers = [];
  for (const arg of args) {
    const value = evalNode(arg, env);
    if (value && value[RANGE]) {
      for (const cell of value.cells) {
        if (isFormulaError(cell)) return cell;
        if (typeof cell === "number" && Number.isFinite(cell)) numbers.push(cell);
      }
      continue;
    }
    if (isFormulaError(value)) return value;
    if (value === null || value === undefined) continue; // a blank referenced cell is skipped
    if (arg.type === "ref" && typeof value !== "number") continue; // text/booleans in referenced cells are ignored
    const number = toNumber(value);
    if (isFormulaError(number)) return number;
    numbers.push(number);
  }
  return numbers;
}

function callFunction(node, env) {
  const { name, args } = node;
  if (name === "IF") {
    const condition = toBoolean(scalar(evalNode(args[0], env)));
    if (isFormulaError(condition)) return condition;
    if (condition) return scalar(evalNode(args[1], env));
    return args.length === 3 ? scalar(evalNode(args[2], env)) : false;
  }
  if (name === "COUNT") {
    let count = 0;
    for (const arg of args) {
      const value = evalNode(arg, env);
      if (value && value[RANGE]) { for (const cell of value.cells) if (typeof cell === "number" && Number.isFinite(cell)) count += 1; continue; }
      if (isFormulaError(value)) continue;
      if (typeof value === "number") count += 1;
      else if (arg.type !== "ref" && (typeof value === "boolean" || (typeof value === "string" && !isFormulaError(toNumber(value))))) count += 1;
    }
    return count;
  }
  if (name === "COUNTA") {
    let count = 0;
    for (const arg of args) {
      const value = evalNode(arg, env);
      if (value && value[RANGE]) { for (const cell of value.cells) if (cell !== null && cell !== undefined && cell !== "") count += 1; continue; }
      if (value !== null && value !== undefined && !(arg.type === "ref" && value === "")) count += 1;
    }
    return count;
  }
  const numbers = collectNumbers(args, env);
  if (isFormulaError(numbers)) return numbers;
  switch (name) {
    case "SUM": return finite(numbers.reduce((sum, value) => sum + value, 0));
    case "AVERAGE": return numbers.length ? finite(numbers.reduce((sum, value) => sum + value, 0) / numbers.length) : formulaError(FORMULA_ERRORS.DIV0, "AVERAGE has no numbers to average.");
    case "MIN": return numbers.length ? Math.min(...numbers) : 0;
    case "MAX": return numbers.length ? Math.max(...numbers) : 0;
    default: return formulaError(FORMULA_ERRORS.NAME);
  }
}

// ---------------------------------------------------------------------------
// Formula rewriting: copy/fill offsets, row/column insert/delete, sheet rename/delete
// ---------------------------------------------------------------------------

function refPartText(part) {
  return `${part.absCol ? "$" : ""}${columnName(part.col)}${part.absRow ? "$" : ""}${part.row + 1}`;
}
function rewriteRefs(formula, transform) {
  const text = String(formula);
  if (!text.startsWith("=")) return text;
  let tokens;
  try { tokens = tokenize(text.slice(1)); } catch { return text; } // unparsable text is kept exactly as entered
  let out = "";
  let last = 0;
  const body = text.slice(1);
  for (const token of tokens) {
    if (token.type !== "ref") continue;
    let a;
    let b;
    try {
      a = parseRefPart(token.a);
      b = token.b ? parseRefPart(token.b) : null;
    } catch { continue; }
    const replaced = transform({ sheet: token.sheet, a, b });
    if (replaced === undefined) continue;
    out += body.slice(last, token.start) + replaced;
    last = token.end;
  }
  return `=${out}${body.slice(last)}`;
}
function prefixText(sheet) {
  return sheet === null || sheet === undefined ? "" : `${quoteSheetName(sheet)}!`;
}

/** Copy/fill: relative parts move by (dRow, dCol); $-anchored parts stay. Off-sheet results become #REF!. */
export function translateFormula(formula, dRow, dCol) {
  if (!dRow && !dCol) return String(formula);
  return rewriteRefs(formula, ({ sheet, a, b }) => {
    const move = (part) => {
      const row = part.absRow ? part.row : part.row + dRow;
      const col = part.absCol ? part.col : part.col + dCol;
      if (row < 0 || col < 0 || row >= FORMULA_LIMITS.maxRow || col >= FORMULA_LIMITS.maxCol) return null;
      return { ...part, row, col };
    };
    const na = move(a);
    const nb = b ? move(b) : null;
    if (!na || (b && !nb)) return "#REF!";
    return `${prefixText(sheet)}${refPartText(na)}${nb ? `:${refPartText(nb)}` : ""}`;
  });
}

/**
 * Row/column insert (count > 0) or delete (count < 0) at `index` on sheet `changedSheet`.
 * `formulaSheet` is the sheet holding the formula (its unqualified refs point there).
 * References move with the cells they point to; references into deleted cells become #REF!;
 * ranges that lose only some of their rows/columns shrink.
 */
export function shiftFormula(formula, { axis, index, count, changedSheet, formulaSheet }) {
  const sameSheet = (sheet) => {
    const target = sheet === null || sheet === undefined ? formulaSheet : sheet;
    return String(target).toLowerCase() === String(changedSheet).toLowerCase();
  };
  const key = axis === "row" ? "row" : "col";
  return rewriteRefs(formula, ({ sheet, a, b }) => {
    if (!sameSheet(sheet)) return undefined;
    const prefix = prefixText(sheet);
    if (count > 0) {
      const shift = (part) => (part[key] >= index ? { ...part, [key]: part[key] + count } : part);
      if (!b) return `${prefix}${refPartText(shift(a))}`;
      // A range grows when rows are inserted strictly inside it.
      const lo = a[key] <= b[key] ? a : b;
      const hi = lo === a ? b : a;
      const nlo = lo[key] >= index ? { ...lo, [key]: lo[key] + count } : lo;
      const nhi = hi[key] >= index ? { ...hi, [key]: hi[key] + count } : hi;
      return `${prefix}${refPartText(lo === a ? nlo : nhi)}:${refPartText(lo === a ? nhi : nlo)}`;
    }
    const removed = -count;
    const end = index + removed; // [index, end) deleted
    if (!b) {
      if (a[key] >= index && a[key] < end) return "#REF!";
      return `${prefix}${refPartText(a[key] >= end ? { ...a, [key]: a[key] - removed } : a)}`;
    }
    const lo = Math.min(a[key], b[key]);
    const hi = Math.max(a[key], b[key]);
    if (lo >= index && hi < end) return "#REF!";
    const map = (value, isLow) => {
      if (value < index) return value;
      if (value >= end) return value - removed;
      return isLow ? index : index - 1; // edge inside the deleted block: clamp
    };
    const nlo = map(lo, true);
    const nhi = map(hi, false);
    const first = { ...(a[key] <= b[key] ? a : b), [key]: nlo };
    const second = { ...(a[key] <= b[key] ? b : a), [key]: nhi };
    return `${prefix}${refPartText(first)}:${refPartText(second)}`;
  });
}

/** Rewrites references to a renamed sheet (case-insensitive match). */
export function renameSheetInFormula(formula, oldName, newName) {
  return rewriteRefs(formula, ({ sheet, a, b }) => {
    if (sheet === null || sheet.toLowerCase() !== String(oldName).toLowerCase()) return undefined;
    return `${quoteSheetName(newName)}!${refPartText(a)}${b ? `:${refPartText(b)}` : ""}`;
  });
}
/** References to a deleted sheet become #REF! (the formula text is otherwise kept). */
export function removeSheetFromFormula(formula, name) {
  return rewriteRefs(formula, ({ sheet }) => (sheet !== null && sheet.toLowerCase() === String(name).toLowerCase() ? "#REF!" : undefined));
}

// ---------------------------------------------------------------------------
// Workbook calculator: dependency graph + scoped recalculation
// ---------------------------------------------------------------------------

/**
 * Keeps computed results for every formula cell of a table.
 *
 * `source` gives the raw (entered) content: {sheets(): [{id, name, rows, cols}], cell(sheetId, row, col) → {f?: string, v?: any} | undefined,
 * formulaCells(sheetId) → iterable of [row, col, formula]}.
 * After the caller changes cells it calls `update(sheetId, [[row, col], …])`; only those cells and the
 * formulas that depend on them (transitively) are recalculated. Structural changes call `rebuild()`.
 */
export class WorkbookCalculator {
  constructor(source) {
    this.source = source;
    this.formulas = new Map(); // "sheetId|r:c" → entry
    this.singleIndex = new Map(); // "sheetId|r:c" → Set(formula keys reading that one cell)
    this.rangeIndex = new Map(); // sheetId → Array<{r1,c1,r2,c2,key}>
    this.bySheet = new Map(); // sheetId → Set(formula keys on that sheet)
    this.sheetById = new Map();
    this.sheetByName = new Map();
    this.rebuild();
  }

  refreshSheets() {
    this.sheetById.clear();
    this.sheetByName.clear();
    for (const sheet of this.source.sheets()) {
      this.sheetById.set(sheet.id, sheet);
      this.sheetByName.set(String(sheet.name).toLowerCase(), sheet);
    }
  }

  /** Full rebuild + full recalculation. Returns nothing; read results with value(). */
  rebuild() {
    this.formulas.clear();
    this.singleIndex.clear();
    this.rangeIndex.clear();
    this.bySheet.clear();
    this.refreshSheets();
    for (const sheet of this.sheetById.values()) {
      for (const [row, col, formula] of this.source.formulaCells(sheet.id)) this.addFormula(sheet.id, row, col, formula);
    }
    this.recalculate(new Set(this.formulas.keys()));
  }

  key(sheetId, row, col) {
    return `${sheetId}|${row}:${col}`;
  }

  addFormula(sheetId, row, col, formula) {
    const key = this.key(sheetId, row, col);
    const checked = checkFormula(formula);
    const entry = { key, sheetId, row, col, formula, ast: checked.ok ? checked.ast : null, value: checked.ok ? null : checked.error, deps: [] };
    if (checked.ok) {
      for (const dep of formulaDependencies(checked.ast)) {
        const target = dep.sheet === null ? this.sheetById.get(sheetId) : this.sheetByName.get(dep.sheet.toLowerCase());
        if (!target) continue; // evaluates to #REF!; nothing to index
        const rect = { sheetId: target.id, r1: dep.r1, c1: dep.c1, r2: dep.r2, c2: dep.c2 };
        entry.deps.push(rect);
        if (rect.r1 === rect.r2 && rect.c1 === rect.c2) {
          const k = this.key(target.id, rect.r1, rect.c1);
          if (!this.singleIndex.has(k)) this.singleIndex.set(k, new Set());
          this.singleIndex.get(k).add(key);
        } else {
          if (!this.rangeIndex.has(target.id)) this.rangeIndex.set(target.id, []);
          this.rangeIndex.get(target.id).push({ ...rect, key });
        }
      }
    }
    this.formulas.set(key, entry);
    if (!this.bySheet.has(sheetId)) this.bySheet.set(sheetId, new Set());
    this.bySheet.get(sheetId).add(key);
    return entry;
  }

  removeFormula(key) {
    const entry = this.formulas.get(key);
    if (!entry) return;
    for (const rect of entry.deps) {
      if (rect.r1 === rect.r2 && rect.c1 === rect.c2) this.singleIndex.get(this.key(rect.sheetId, rect.r1, rect.c1))?.delete(key);
      else {
        const list = this.rangeIndex.get(rect.sheetId);
        if (list) this.rangeIndex.set(rect.sheetId, list.filter((item) => item.key !== key));
      }
    }
    this.formulas.delete(key);
    this.bySheet.get(entry.sheetId)?.delete(key);
  }

  /** Formula keys that read the given cell directly. */
  directDependents(sheetId, row, col) {
    const out = new Set(this.singleIndex.get(this.key(sheetId, row, col)) || []);
    for (const rect of this.rangeIndex.get(sheetId) || []) {
      if (row >= rect.r1 && row <= rect.r2 && col >= rect.c1 && col <= rect.c2) out.add(rect.key);
    }
    return out;
  }

  /**
   * Re-reads the given cells of one sheet and recalculates them plus their dependents only.
   * @returns {Set<string>} keys ("sheetId|r:c") of formula cells that were recalculated
   */
  update(sheetId, cells) {
    const changed = new Set();
    const seeds = [];
    for (const [row, col] of cells) {
      const key = this.key(sheetId, row, col);
      const raw = this.source.cell(sheetId, row, col);
      const formula = raw && typeof raw.f === "string" ? raw.f : null;
      const existing = this.formulas.get(key);
      if (existing && existing.formula !== formula) this.removeFormula(key);
      if (formula !== null && (!existing || existing.formula !== formula)) this.addFormula(sheetId, row, col, formula);
      if (this.formulas.has(key)) changed.add(key);
      seeds.push([sheetId, row, col]);
    }
    // Transitive dependents (breadth-first over the dependency index).
    const queue = [...seeds];
    while (queue.length) {
      const [s, r, c] = queue.shift();
      for (const dependent of this.directDependents(s, r, c)) {
        if (changed.has(dependent)) continue;
        changed.add(dependent);
        const entry = this.formulas.get(dependent);
        queue.push([entry.sheetId, entry.row, entry.col]);
      }
    }
    this.recalculate(changed);
    return changed;
  }

  /** Topologically evaluates the given formula keys; members of (or downstream from) a cycle get #CYCLE!. */
  recalculate(keys) {
    const affected = [...keys].filter((key) => this.formulas.has(key));
    if (!affected.length) return;
    const set = new Set(affected);
    const incoming = new Map(affected.map((key) => [key, 0]));
    const outgoing = new Map(affected.map((key) => [key, []]));
    for (const key of affected) {
      const entry = this.formulas.get(key);
      for (const rect of entry.deps) {
        for (const other of this.formulasIn(rect, set)) {
          outgoing.get(other).push(key);
          incoming.set(key, incoming.get(key) + 1);
        }
      }
    }
    const queue = affected.filter((key) => incoming.get(key) === 0);
    const done = new Set();
    while (queue.length) {
      const key = queue.pop();
      done.add(key);
      const entry = this.formulas.get(key);
      entry.value = entry.ast ? this.evaluateEntry(entry) : entry.value;
      for (const next of outgoing.get(key)) {
        incoming.set(next, incoming.get(next) - 1);
        if (incoming.get(next) === 0) queue.push(next);
      }
    }
    for (const key of affected) {
      if (done.has(key)) continue;
      const entry = this.formulas.get(key);
      if (entry.ast) entry.value = formulaError(FORMULA_ERRORS.CYCLE);
    }
  }

  formulasIn(rect, within) {
    const out = [];
    const area = (rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1);
    const onSheet = this.bySheet.get(rect.sheetId);
    if (!onSheet) return out;
    if (area <= onSheet.size) {
      for (let r = rect.r1; r <= rect.r2; r += 1) {
        for (let c = rect.c1; c <= rect.c2; c += 1) {
          const key = this.key(rect.sheetId, r, c);
          if (within.has(key)) out.push(key);
        }
      }
    } else {
      for (const key of onSheet) {
        if (!within.has(key)) continue;
        const entry = this.formulas.get(key);
        if (entry.row >= rect.r1 && entry.row <= rect.r2 && entry.col >= rect.c1 && entry.col <= rect.c2) out.push(key);
      }
    }
    return out;
  }

  evaluateEntry(entry) {
    const resolve = (sheet) => (sheet === null || sheet === undefined ? this.sheetById.get(entry.sheetId) : this.sheetByName.get(String(sheet).toLowerCase()));
    return evaluate(entry.ast, {
      sheetExists: (sheet) => Boolean(resolve(sheet)),
      bounds: (sheet) => {
        const target = resolve(sheet);
        return { rows: target.rows, cols: target.cols };
      },
      read: (sheet, row, col) => this.value(resolve(sheet).id, row, col),
    });
  }

  /** The value a cell shows: the computed result for formulas, otherwise the entered value (null when blank). */
  value(sheetId, row, col) {
    const entry = this.formulas.get(this.key(sheetId, row, col));
    if (entry) return entry.value;
    const sheet = this.sheetById.get(sheetId);
    if (sheet && (row >= sheet.rows || col >= sheet.cols)) return null;
    const raw = this.source.cell(sheetId, row, col);
    if (!raw || raw.v === undefined || raw.v === "") return null;
    return raw.v;
  }
}
