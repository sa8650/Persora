// Persora Table formula engine: parsing, the documented function subset,
// spreadsheet coercion rules, every error kind, the no-code-execution
// guarantee, reference rewriting (copy/fill, row/column insert/delete, sheet
// rename/delete) and the dependency graph (scoped recalculation, cycles).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FORMULA_ERRORS, SUPPORTED_FUNCTIONS, WorkbookCalculator, checkFormula, columnIndex, columnName, evaluate, isFormulaError,
  parseAddress, parseFormula, quoteSheetName, removeSheetFromFormula, renameSheetInFormula, shiftFormula, translateFormula,
} from '../cloudflare/table-formula.js';

/** A tiny in-memory workbook: {SheetName: {A1: value-or-formula}}. */
function workbook(spec, size = { rows: 100, cols: 26 }) {
  const sheets = Object.keys(spec).map((name, index) => ({ id: `s${index}`, name, ...size }));
  const cells = new Map();
  sheets.forEach((sheet) => {
    for (const [address, input] of Object.entries(spec[sheet.name])) {
      const { row, col } = parseAddress(address);
      cells.set(`${sheet.id}|${row}:${col}`, typeof input === 'string' && input.startsWith('=') ? { f: input } : { v: input });
    }
  });
  const source = {
    sheets: () => sheets,
    cell: (sheetId, row, col) => cells.get(`${sheetId}|${row}:${col}`),
    *formulaCells(sheetId) {
      for (const [key, cell] of cells) {
        if (!key.startsWith(`${sheetId}|`) || typeof cell.f !== 'string') continue;
        const [row, col] = key.split('|')[1].split(':').map(Number);
        yield [row, col, cell.f];
      }
    },
  };
  const calc = new WorkbookCalculator(source);
  const id = (name) => sheets.find((sheet) => sheet.name === name).id;
  return {
    calc, sheets, cells,
    get(address, sheet = Object.keys(spec)[0]) { const { row, col } = parseAddress(address); return calc.value(id(sheet), row, col); },
    set(address, input, sheet = Object.keys(spec)[0]) {
      const { row, col } = parseAddress(address);
      const key = `${id(sheet)}|${row}:${col}`;
      if (input === null) cells.delete(key);
      else cells.set(key, typeof input === 'string' && input.startsWith('=') ? { f: input } : { v: input });
      return calc.update(id(sheet), [[row, col]]);
    },
  };
}
const one = (formula, spec = {}) => workbook({ Sheet1: { ...spec, Z100: formula } }).get('Z100');
const code = (value) => (isFormulaError(value) ? value.error : value);

test('addresses and sheet-name quoting', () => {
  assert.equal(columnName(0), 'A');
  assert.equal(columnName(25), 'Z');
  assert.equal(columnName(26), 'AA');
  assert.equal(columnName(701), 'ZZ');
  assert.equal(columnName(702), 'AAA');
  for (const n of [0, 1, 25, 26, 27, 51, 52, 700, 701, 702, 18277]) assert.equal(columnIndex(columnName(n)), n);
  assert.deepEqual(parseAddress('B3'), { row: 2, col: 1 });
  assert.deepEqual(parseAddress('$c$10'), { row: 9, col: 2 });
  assert.equal(parseAddress('A0'), null);
  assert.equal(parseAddress('1A'), null);
  assert.equal(quoteSheetName('Budget'), 'Budget');
  assert.equal(quoteSheetName('My sheet'), "'My sheet'");
  assert.equal(quoteSheetName("Bob's"), "'Bob''s'");
  assert.equal(quoteSheetName('A1'), "'A1'", 'names that look like cells are quoted');
  assert.equal(quoteSheetName('2026'), "'2026'");
});

test('arithmetic, precedence, unary minus and literals', () => {
  assert.equal(one('=1+2*3'), 7);
  assert.equal(one('=(1+2)*3'), 9);
  assert.equal(one('=10/4'), 2.5);
  assert.equal(one('=-3+5'), 2);
  assert.equal(one('=--3'), 3);
  assert.equal(one('=2*-3'), -6);
  assert.equal(one('=1.5e2'), 150);
  assert.equal(one('=.5+.25'), 0.75);
  assert.equal(one('="Hello"'), 'Hello');
  assert.equal(one('="Say ""hi"""'), 'Say "hi"');
  assert.equal(one('=TRUE'), true);
  assert.equal(one('=true+1'), 2, 'booleans count as 1/0 in arithmetic');
  assert.equal(one('=A1*2', { A1: 21 }), 42);
  assert.equal(one('= A1 + B1 ', { A1: 1, B1: 2 }), 3, 'whitespace is allowed');
  assert.equal(one('=a1+b1', { A1: 1, B1: 2 }), 3, 'references are case-insensitive');
  assert.equal(one('=A1', {}), 0, 'a blank reference shows 0');
  assert.equal(one('=A1+1', { A1: '41' }), 42, 'numeric text is coerced in arithmetic');
  assert.equal(one('=0.1+0.2'), 0.1 + 0.2, 'raw IEEE result; display formatting rounds');
});

test('the function subset follows spreadsheet rules', () => {
  const data = { A1: 10, A2: 20, A3: 'text', A4: true, A5: 30, B1: 5 };
  assert.equal(one('=SUM(A1:A5)', data), 60, 'ranges skip text and booleans');
  assert.equal(one('=SUM(A1:A5, B1, 5)', data), 70);
  assert.equal(one('=SUM(1, TRUE, "2")'), 4, 'direct arguments are coerced');
  assert.equal(code(one('=SUM("x")')), '#VALUE!');
  assert.equal(one('=SUM(A3)', data), 0, 'text in a referenced cell is ignored');
  assert.equal(one('=AVERAGE(A1:A5)', data), 20);
  assert.equal(code(one('=AVERAGE(C1:C3)')), '#DIV/0!');
  assert.equal(one('=COUNT(A1:A5)', data), 3);
  assert.equal(one('=COUNT(A1:A5, 7, "8", "x")', data), 5);
  assert.equal(one('=COUNTA(A1:A5)', data), 5);
  assert.equal(one('=COUNTA(C1:C9)', data), 0);
  assert.equal(one('=MIN(A1:A5)', data), 10);
  assert.equal(one('=MAX(A1:A5, 99)', data), 99);
  assert.equal(one('=MIN(C1:C3)'), 0, 'MIN of nothing is 0');
  assert.equal(one('=IF(A1>5, "big", "small")', data), 'big');
  assert.equal(one('=IF(A1<5, "big", "small")', data), 'small');
  assert.equal(one('=IF(A1<5, "big")', data), false, 'missing else → FALSE');
  assert.equal(one('=IF(0, 1/0, 2)'), 2, 'only the chosen branch is evaluated');
  assert.equal(one('=IF(A3="TEXT", 1, 2)', data), 1, 'text comparison is case-insensitive');
  assert.equal(one('=IF(C9="", "empty", "x")'), 'empty', 'blank equals ""');
  assert.equal(one('=IF(C9=0, "zero", "x")'), 'zero', 'blank equals 0');
  assert.equal(one('=IF(A1<>10, 1, 0)', data), 0);
  assert.equal(one('=IF(A1>=10, 1, 0)', data), 1);
  assert.equal(one('=IF(A1<=9, 1, 0)', data), 0);
  assert.equal(code(one('=IF("maybe", 1, 2)')), '#VALUE!');
  assert.equal(one('=SUM(B1:A1)', data), 15, 'reversed ranges are normalized');
  assert.equal(one('=sum(A1:A2)', data), 30, 'function names are case-insensitive');
  assert.equal(one('=SUM(A1:A2)+MAX(A5,1)*2', data), 90);
  assert.equal(one('=A1:A1', data), 10, 'a single-cell range is that cell');
  assert.deepEqual([...SUPPORTED_FUNCTIONS], ['SUM', 'AVERAGE', 'COUNT', 'COUNTA', 'MIN', 'MAX', 'IF']);
});

test('every error kind is a value with a message, never an exception or 0', () => {
  const cases = [
    ['=1/0', '#DIV/0!'], ['=A1/A2', '#DIV/0!'], ['=SUM(1,', '#ERROR!'], ['=(1+2', '#ERROR!'], ['=1+2)', '#ERROR!'],
    ['=1 2', '#ERROR!'], ['=', '#ERROR!'], ['="open', '#ERROR!'], ['=A1:', '#ERROR!'], ['=A:A', '#ERROR!'],
    ['=1&2', '#ERROR!'], ['=2^3', '#ERROR!'], ['=50%', '#ERROR!'], ['=SUM()', '#ERROR!'], ['=IF(1)', '#ERROR!'],
    ['=VLOOKUP(A1, B1:C2, 2)', '#NAME?'], ['=NOW()', '#NAME?'], ['=foo', '#NAME?'], ['=hello + 1', '#NAME?'],
    ['="abc"*2', '#VALUE!'], ['=A1:A3+1', '#VALUE!'], ['=Missing!A1', '#REF!'], ['=#REF!+1', '#REF!'],
    ['=1=2=3', '#ERROR!'], ['=SUM(1,,2)', '#ERROR!'],
  ];
  for (const [formula, expected] of cases) {
    const value = one(formula, { A1: 1, A2: 0 });
    assert.ok(isFormulaError(value), `${formula} → error`);
    assert.equal(value.error, expected, formula);
    assert.ok(value.message.length > 5, `${formula} explains itself`);
  }
  const unsupported = checkFormula('=VLOOKUP(1)');
  assert.match(unsupported.error.message, /VLOOKUP isn't supported\. Available functions: SUM, AVERAGE/);
  assert.match(checkFormula('=A:A').error.message, /Whole-column/);
  assert.equal(code(one('=SUM(A1:A2)', { A1: 1, A2: '=1/0' })), '#DIV/0!', 'errors propagate through ranges');
  assert.equal(one('=COUNT(A1:A2)', { A1: 1, A2: '=1/0' }), 1, 'COUNT skips errors');
  assert.equal(one('=COUNTA(A1:A2)', { A1: 1, A2: '=1/0' }), 2, 'COUNTA counts errors');
  assert.equal(code(one('=9e307*100')), '#VALUE!', 'overflow is an error, not Infinity');
});

test('formulas cannot execute code, reach globals or the network', () => {
  let touched = false;
  globalThis.__persoraPwned = () => { touched = true; };
  const attempts = [
    '=constructor.constructor("return __persoraPwned()")()', '=__persoraPwned()', '=this', '=globalThis.fetch("https://evil.test")',
    '=A1.constructor', '=SUM(A1)["constructor"]', '=`x`', '=fetch("x")', '=import("x")', '=eval("1")', '=new Function("1")',
    '=process.exit(1)', '=window.location', '={1,2}', '=[1]', '=1;2', '=require("fs")', '=HYPERLINK("x")', '=WEBSERVICE("https://e.test")',
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { touched = true; throw new Error('network'); };
  try {
    for (const formula of attempts) {
      const value = one(formula, { A1: 1 });
      assert.ok(isFormulaError(value), `${formula} is rejected as an error value`);
    }
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.__persoraPwned;
  }
  assert.equal(touched, false);
  // The parser output is plain data.
  assert.equal(JSON.stringify(parseFormula('=SUM(A1:B2)*2')), JSON.stringify(JSON.parse(JSON.stringify(parseFormula('=SUM(A1:B2)*2')))));
  assert.equal(code(one(`=${'('.repeat(80)}1${')'.repeat(80)}`)), '#ERROR!', 'deep nesting is capped');
  assert.equal(code(one(`=${'1+'.repeat(1200)}1`)), '#ERROR!', 'length is capped');
  assert.equal(code(one(`=${'-'.repeat(200)}1`)), '#ERROR!', 'unary nesting is capped');
});

test('cross-sheet references, quoted names and #REF! for missing sheets', () => {
  const wb = workbook({ Budget: { A1: 100, A2: 50 }, 'My sheet': { B2: 7, C1: '=Budget!A1+Budget!A2' }, Summary: { A1: "=SUM(Budget!A1:A2)*'My sheet'!B2", A2: "='my SHEET'!C1" } });
  assert.equal(wb.get('A1', 'Summary'), 1050);
  assert.equal(wb.get('A2', 'Summary'), 150, 'sheet names are case-insensitive');
  wb.set('A2', 150, 'Budget');
  assert.equal(wb.get('C1', 'My sheet'), 250);
  assert.equal(wb.get('A1', 'Summary'), 1750);
  assert.equal(wb.get('A2', 'Summary'), 250);
});

test('scoped recalculation touches only dependents; chains stay correct', () => {
  const spec = { A1: 1 };
  for (let row = 2; row <= 3000; row += 1) spec[`A${row}`] = `=A${row - 1}+1`;
  spec.B1 = 5;
  spec.C1 = '=B1*2';
  spec.D1 = '=SUM(A1:A3000)';
  const wb = workbook({ Sheet1: spec }, { rows: 5000, cols: 26 });
  assert.equal(wb.get('A3000'), 3000, 'a 3000-deep chain evaluates without recursion limits');
  assert.equal(wb.get('D1'), 3000 * 3001 / 2);
  let changed = wb.set('B1', 6);
  assert.equal(wb.get('C1'), 12);
  assert.deepEqual([...changed].sort(), ['s0|0:2'], 'editing B1 recalculates only C1');
  changed = wb.set('A1', 10);
  assert.equal(wb.get('A3000'), 3009);
  assert.equal(wb.get('D1'), 3000 * 3001 / 2 + 9 * 3000);
  assert.equal(changed.size, 3000, 'A2…A3000 plus D1');
  assert.equal(changed.has('s0|0:2'), false, 'C1 is untouched');
  changed = wb.set('E5', 1);
  assert.equal(changed.size, 0, 'an unrelated cell recalculates nothing');
});

test('circular references are detected, flagged and recover when broken', () => {
  const wb = workbook({ Sheet1: { A1: '=B1+1', B1: '=A1+1', C1: '=A1*2', D1: '=D1', E1: 5, F1: '=E1' } });
  for (const address of ['A1', 'B1', 'D1']) assert.equal(code(wb.get(address)), '#CYCLE!', address);
  assert.equal(code(wb.get('C1')), '#CYCLE!', 'a cell fed by a cycle is flagged too');
  assert.equal(wb.get('F1'), 5, 'unrelated formulas still work');
  wb.set('B1', 10);
  assert.equal(wb.get('A1'), 11);
  assert.equal(wb.get('C1'), 22);
  wb.set('B1', '=SUM(A1:A2)');
  assert.equal(code(wb.get('A1')), '#CYCLE!', 'a range that includes the cell is circular');
  const cross = workbook({ One: { A1: '=Two!A1' }, Two: { A1: '=One!A1' } });
  assert.equal(code(cross.get('A1', 'One')), '#CYCLE!');
});

test('editing keeps formula text, entered value and result distinct', () => {
  const wb = workbook({ Sheet1: { A1: 4, B1: '=A1*' } });
  assert.equal(code(wb.get('B1')), '#ERROR!');
  assert.equal(wb.cells.get('s0|0:1').f, '=A1*', 'an invalid formula is kept exactly as entered');
  wb.set('B1', '=A1*2');
  assert.equal(wb.get('B1'), 8);
  wb.set('B1', 'plain');
  assert.equal(wb.get('B1'), 'plain');
  wb.set('B1', '=A1/0');
  assert.equal(code(wb.get('B1')), '#DIV/0!');
  wb.set('A1', null);
  assert.equal(code(wb.get('B1')), '#DIV/0!');
});

test('copy/fill translation keeps $-anchors and turns off-sheet moves into #REF!', () => {
  assert.equal(translateFormula('=A1+$B$1+C$1+$D1', 1, 1), '=B2+$B$1+D$1+$D2');
  assert.equal(translateFormula('=SUM(A1:A3)', 0, 2), '=SUM(C1:C3)');
  assert.equal(translateFormula("='My sheet'!A1*2", 3, 0), "='My sheet'!A4*2");
  assert.equal(translateFormula('=A1', -1, 0), '=#REF!');
  assert.equal(translateFormula('="A1"&B', 1, 1), '="A1"&B', 'unparsable formulas are kept as entered');
  assert.equal(translateFormula('="A1"', 5, 5), '="A1"', 'text that looks like a cell is untouched');
  assert.equal(translateFormula('=SUM(A1:B2)', 0, 0), '=SUM(A1:B2)');
});

test('row/column insert and delete move references like a spreadsheet', () => {
  const rows = (formula, index, count) => shiftFormula(formula, { axis: 'row', index, count, changedSheet: 'Sheet1', formulaSheet: 'Sheet1' });
  const cols = (formula, index, count) => shiftFormula(formula, { axis: 'col', index, count, changedSheet: 'Sheet1', formulaSheet: 'Sheet1' });
  assert.equal(rows('=A5+A1', 2, 1), '=A6+A1', 'insert above row 3 moves A5 only');
  assert.equal(rows('=SUM(A1:A10)', 4, 2), '=SUM(A1:A12)', 'insert inside a range grows it');
  assert.equal(rows('=SUM(A1:A10)', 0, 1), '=SUM(A2:A11)', 'insert above a range moves it');
  assert.equal(rows('=SUM(A1:A10)', 10, 1), '=SUM(A1:A10)', 'insert below a range leaves it');
  assert.equal(rows('=A3', 2, -1), '=#REF!', 'deleting the referenced row');
  assert.equal(rows('=A5*2', 2, -1), '=A4*2');
  assert.equal(rows('=SUM(A1:A10)', 2, -3), '=SUM(A1:A7)', 'delete inside a range shrinks it');
  assert.equal(rows('=SUM(A3:A5)', 2, -3), '=SUM(#REF!)', 'deleting the whole range');
  assert.equal(rows('=SUM(A3:A8)', 0, -4), '=SUM(A1:A4)', 'range start inside the deleted block clamps');
  assert.equal(rows('=$A$5', 0, 1), '=$A$6', 'absolute references still follow their cells');
  assert.equal(cols('=C1+A1', 1, 1), '=D1+A1');
  assert.equal(cols('=SUM(A1:D1)', 1, -2), '=SUM(A1:B1)');
  assert.equal(cols('=B1', 1, -1), '=#REF!');
  // Other sheets: unqualified refs belong to the formula's own sheet.
  assert.equal(shiftFormula('=A5+Data!A5', { axis: 'row', index: 0, count: 1, changedSheet: 'Data', formulaSheet: 'Sheet1' }), '=A5+Data!A6');
  assert.equal(shiftFormula("='My data'!A5", { axis: 'row', index: 0, count: 1, changedSheet: 'my data', formulaSheet: 'Sheet1' }), "='My data'!A6");
});

test('sheet rename rewrites references; sheet delete turns them into #REF!', () => {
  assert.equal(renameSheetInFormula('=Budget!A1+budget!B2+Other!C3', 'Budget', 'Plan 2026'), "='Plan 2026'!A1+'Plan 2026'!B2+Other!C3");
  assert.equal(renameSheetInFormula("='Plan 2026'!A1:B2", 'plan 2026', 'Plan'), '=Plan!A1:B2');
  assert.equal(removeSheetFromFormula('=Budget!A1+A1', 'Budget'), '=#REF!+A1');
  assert.equal(code(one(removeSheetFromFormula('=Budget!A1+A1', 'Budget'))), '#REF!');
  assert.equal(renameSheetInFormula('=A1+1', 'Sheet1', 'Main'), '=A1+1', 'unqualified references are untouched');
});

test('range reads past the sheet edge are blank; huge ranges are capped', () => {
  const wb = workbook({ Sheet1: { A1: 2, B1: '=SUM(A1:A1000000)', C1: '=SUM(D2:ZZZ1000000)', D1: '=SUM(A1:ZZZ1000000)' } }, { rows: 10, cols: 5 });
  assert.equal(wb.get('B1'), 2);
  assert.equal(code(wb.get('C1')), '#VALUE!');
  assert.equal(code(wb.get('D1')), '#CYCLE!', 'a range containing its own cell is circular');
});

test('evaluate() is usable without the workbook (env contract)', () => {
  const ast = parseFormula('=SUM(A1:B1)+X!A1');
  const value = evaluate(ast, { sheetExists: (sheet) => sheet === null || sheet === 'X', read: (sheet, row, col) => (sheet === 'X' ? 100 : row + col + 1) });
  assert.equal(value, 103);
  assert.equal(FORMULA_ERRORS.CYCLE, '#CYCLE!');
});
