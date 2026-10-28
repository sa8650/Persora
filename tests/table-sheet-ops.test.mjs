// Persora Table spreadsheet operations: editing, formatting, copy/paste, fill,
// sort/move, row/column/sheet structure with formula references kept correct
// across sheets, and large-sheet performance with scoped recalculation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addSheet, applyStyle, cellFromInput, clearRange, deleteColumns, deleteRows, deleteSheet, duplicateSheet, extractRange, fillRange, formulaCellsOf,
  insertColumns, insertRows, moveRows, moveSheet, parseClipboardText, pasteBlock, renameSheet, setCells, sortRows, toTsv, resizeColumn, resizeRow,
} from '../cloudflare/table-sheet-ops.js';
import { emptySheetData, normalizeSheetData, TABLE_LIMITS } from '../cloudflare/table-rules.js';
import { WorkbookCalculator, isFormulaError, parseAddress } from '../cloudflare/table-formula.js';

function book(spec) {
  return {
    sheets: Object.entries(spec).map(([name, cells], position) => {
      const data = emptySheetData(20, 10);
      for (const [address, input] of Object.entries(cells)) {
        const { row, col } = parseAddress(address);
        const next = cellFromInput(String(input));
        if (next) data.cells[`${row}:${col}`] = next;
      }
      return { id: `id-${name}`, name, position, data };
    }),
  };
}
const cell = (wb, address, sheet = 0) => {
  const { row, col } = parseAddress(address);
  return wb.sheets[sheet].data.cells[`${row}:${col}`];
};
function calc(wb) {
  return new WorkbookCalculator({
    sheets: () => wb.sheets.map((sheet) => ({ id: sheet.id, name: sheet.name, rows: sheet.data.rowCount, cols: sheet.data.colCount })),
    cell: (id, row, col) => wb.sheets.find((sheet) => sheet.id === id).data.cells[`${row}:${col}`],
    formulaCells: (id) => formulaCellsOf(wb.sheets.find((sheet) => sheet.id === id).data),
  });
}
const result = (wb, address, sheet = 0) => {
  const { row, col } = parseAddress(address);
  const value = calc(wb).value(wb.sheets[sheet].id, row, col);
  return isFormulaError(value) ? value.error : value;
};

test('typing keeps formats; clearing and formatting', () => {
  let data = emptySheetData(5, 5);
  data = setCells(data, [[0, 0, cellFromInput('15%')]]);
  assert.deepEqual(data.cells['0:0'], { v: 0.15, s: { nf: 'percent', dp: 0 } });
  data = setCells(data, [[0, 0, cellFromInput('0.5', data.cells['0:0'])]]);
  assert.deepEqual(data.cells['0:0'], { v: 0.5, s: { nf: 'percent', dp: 0 } }, 'existing format is kept');
  data = setCells(data, [[0, 0, cellFromInput('', data.cells['0:0'])]]);
  assert.deepEqual(data.cells['0:0'], { s: { nf: 'percent', dp: 0 } }, 'deleting content keeps the format');
  data = setCells(data, [[1, 1, cellFromInput('=A1+1')], [9, 9, { v: 1 }]]);
  assert.equal(data.cells['9:9'], undefined, 'writes outside the sheet are ignored');
  data = applyStyle(data, { r1: 0, c1: 0, r2: 1, c2: 1 }, { b: 1, bg: '#FEF7C3' }, 'outer');
  assert.deepEqual(data.cells['0:0'].s, { b: 1, bg: '#FEF7C3', bd: 'tl', nf: 'percent', dp: 0 });
  assert.equal(data.cells['1:1'].s.bd, 'rb');
  assert.equal(data.cells['1:1'].f, '=A1+1', 'formatting never touches content');
  data = applyStyle(data, { r1: 0, c1: 0, r2: 1, c2: 1 }, { b: null }, 'none');
  assert.equal(data.cells['1:1'].s.bg, '#FEF7C3');
  assert.equal(data.cells['1:1'].s.b, undefined);
  const contentsCleared = clearRange(data, { r1: 0, c1: 0, r2: 4, c2: 4 }, 'contents');
  assert.equal(contentsCleared.cells['1:1'].f, undefined);
  assert.equal(contentsCleared.cells['1:1'].s.bg, '#FEF7C3');
  const formatsCleared = clearRange(data, { r1: 0, c1: 0, r2: 4, c2: 4 }, 'formats');
  assert.deepEqual(formatsCleared.cells['1:1'], { f: '=A1+1' });
  assert.equal(formatsCleared.cells['0:0'], undefined, 'a cell with only a format disappears');
  assert.deepEqual(clearRange(data, { r1: 0, c1: 0, r2: 4, c2: 4 }).cells, {});
  assert.equal(data.cells['1:1'].f, '=A1+1', 'inputs are never mutated');
  assert.equal(resizeColumn(data, 2, 220.4).colWidths[2], 220);
  assert.equal(resizeRow(data, 3, 44).rowHeights[3], 44);
});

test('copy/paste translates formulas; external text pastes like typing and grows the sheet', () => {
  const wb = book({ S: { A1: 1, A2: 2, B1: '=A1*10', B2: '=$A$1+A2' } });
  const data = wb.sheets[0].data;
  const block = extractRange(data, { r1: 0, c1: 1, r2: 1, c2: 1 });
  const pasted = pasteBlock(data, { row: 5, col: 3 }, block);
  assert.equal(pasted.cells['5:3'].f, '=C6*10');
  assert.equal(pasted.cells['6:3'].f, '=$A$1+C7');
  const values = pasteBlock(data, { row: 5, col: 3 }, { ...block, mode: 'values', values: [[10], [3]] });
  assert.deepEqual(values.cells['5:3'], { v: 10 });
  const tsv = toTsv([['a', 'tab\there', 'quote "x"'], ['multi\nline', 3, '']]);
  assert.equal(tsv, 'a\t"tab\there"\t"quote ""x"""\n"multi\nline"\t3\t');
  assert.deepEqual(parseClipboardText(tsv), [['a', 'tab\there', 'quote "x"'], ['multi\nline', '3', '']]);
  assert.deepEqual(parseClipboardText('1\t2\r\n3\t4\r\n'), [['1', '2'], ['3', '4']]);
  const grown = pasteBlock(emptySheetData(2, 2), { row: 1, col: 1 }, { text: [['x', '5%', '=A1'], ['y', "'007", '']] });
  assert.equal(grown.rowCount, 3);
  assert.equal(grown.colCount, 4);
  assert.deepEqual(grown.cells['1:2'], { v: 0.05, s: { nf: 'percent', dp: 0 } });
  assert.deepEqual(grown.cells['1:3'], { f: '=A1' });
  assert.deepEqual(grown.cells['2:2'], { v: '007' });
  assert.throws(() => pasteBlock(emptySheetData(2, 2), { row: TABLE_LIMITS.rows - 1, col: 0 }, { text: [['a'], ['b']] }), /at most/);
});

test('fill: series, repeated values and translated formulas in all directions', () => {
  const wb = book({ S: { A1: 1, A2: 3, B1: '=A1*2', C1: 'x' } });
  let data = fillRange(wb.sheets[0].data, { r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 0, r2: 4, c2: 0 });
  assert.deepEqual([2, 3, 4].map((row) => data.cells[`${row}:0`].v), [5, 7, 9], 'two numbers continue their step');
  data = fillRange(data, { r1: 0, c1: 1, r2: 0, c2: 1 }, { r1: 0, c1: 1, r2: 3, c2: 1 });
  assert.deepEqual([1, 2, 3].map((row) => data.cells[`${row}:1`].f), ['=A2*2', '=A3*2', '=A4*2']);
  data = fillRange(data, { r1: 0, c1: 2, r2: 0, c2: 2 }, { r1: 0, c1: 2, r2: 0, c2: 4 });
  assert.deepEqual([3, 4].map((col) => data.cells[`0:${col}`].v), ['x', 'x']);
  const up = fillRange(data, { r1: 3, c1: 0, r2: 4, c2: 0 }, { r1: 1, c1: 0, r2: 4, c2: 0 });
  assert.deepEqual([1, 2].map((row) => up.cells[`${row}:0`].v), [3, 5], 'filling upward continues the series backwards');
  const single = fillRange(book({ S: { A1: 7 } }).sheets[0].data, { r1: 0, c1: 0, r2: 0, c2: 0 }, { r1: 0, c1: 0, r2: 2, c2: 0 });
  assert.deepEqual([1, 2].map((row) => single.cells[`${row}:0`].v), [7, 7], 'one number repeats');
});

test('insert/delete rows and columns keep every reference right, across sheets', () => {
  let wb = book({ Data: { A1: 10, A2: 20, A3: 30, A5: '=SUM(A1:A3)', B1: '=A3' }, Report: { A1: '=Data!A5', A2: '=SUM(Data!A1:A3)', A3: '=Data!B1' } });
  assert.equal(result(wb, 'A1', 1), 60);
  wb = insertRows(wb, 'id-Data', 1, 2); // two rows above row 2
  assert.equal(cell(wb, 'A7').f, '=SUM(A1:A5)');
  assert.equal(cell(wb, 'B1').f, '=A5');
  assert.equal(cell(wb, 'A1', 1).f, '=Data!A7');
  assert.equal(cell(wb, 'A2', 1).f, '=SUM(Data!A1:A5)');
  assert.equal(result(wb, 'A1', 1), 60);
  assert.equal(wb.sheets[0].data.rowCount, 22);
  wb = deleteRows(wb, 'id-Data', 4, 1); // delete the row holding 30 (now A5)
  assert.equal(cell(wb, 'B1').f, '=#REF!');
  assert.equal(result(wb, 'B1'), '#REF!');
  assert.equal(cell(wb, 'A6').f, '=SUM(A1:A4)');
  assert.equal(result(wb, 'A1', 1), 30);
  assert.equal(result(wb, 'A3', 1), '#REF!', 'a reference to a #REF! cell shows #REF!');
  wb = insertColumns(wb, 'id-Data', 0, 1);
  assert.equal(cell(wb, 'B6').f, '=SUM(B1:B4)');
  assert.equal(cell(wb, 'A1', 1).f, '=Data!B6');
  wb = deleteColumns(wb, 'id-Data', 0, 1);
  assert.equal(cell(wb, 'A1', 1).f, '=Data!A6');
  assert.equal(result(wb, 'A1', 1), 30);
  const untouched = book({ One: { A1: 1 }, Two: { A1: 2 } });
  const after = insertRows(untouched, 'id-One', 0, 1);
  assert.equal(after.sheets[1], untouched.sheets[1], 'unaffected sheets keep their identity (nothing to save)');
  assert.throws(() => deleteRows(book({ S: {} }), 'id-S', 0, 20), /at least one row/);
  assert.throws(() => insertColumns(book({ S: {} }), 'id-S', 0, TABLE_LIMITS.cols), /at most/);
  assert.throws(() => insertRows(book({ S: {} }), 'missing', 0, 1), /no longer exists/);
});

test('sort and move rows move contents; formulas in moved rows follow their row', () => {
  const wb = book({ S: { A1: 'Name', B1: 'Amount', C1: 'Double', A2: 'Carol', B2: 30, C2: '=B2*2', A3: 'alice', B3: 10, C3: '=B3*2', A4: 'Bob', B4: '', C4: '=B4*2', A5: 'dave', B5: 'n/a' } });
  const data = wb.sheets[0].data;
  const calculator = calc(wb);
  const valueAt = (row, col) => calculator.value('id-S', row, col);
  const sorted = sortRows(data, { r1: 1, r2: 4 }, 1, 'asc', valueAt);
  const names = (d) => [1, 2, 3, 4].map((row) => d.cells[`${row}:0`].v);
  assert.deepEqual(names(sorted), ['alice', 'Carol', 'dave', 'Bob'], 'numbers, then text, then blanks');
  assert.equal(sorted.cells['1:2'].f, '=B2*2', 'alice’s formula now points at her own row');
  assert.equal(sorted.cells['0:0'].v, 'Name', 'the header row is outside the range');
  const byName = sortRows(data, { r1: 1, r2: 4 }, 0, 'desc', valueAt);
  assert.deepEqual(names(byName), ['dave', 'Carol', 'Bob', 'alice'], 'case-insensitive');
  assert.equal(sortRows(sorted, { r1: 1, r2: 4 }, 1, 'asc', (row, col) => calc({ sheets: [{ ...wb.sheets[0], data: sorted }] }).value('id-S', row, col)), sorted, 'already sorted → same object');
  const moved = moveRows(data, 1, 1, 3);
  assert.deepEqual(names(moved), ['alice', 'Bob', 'Carol', 'dave']);
  assert.equal(moved.cells['3:2'].f, '=B4*2');
  const back = moveRows(moved, 3, 1, 1);
  assert.deepEqual(names(back), ['Carol', 'alice', 'Bob', 'dave']);
});

test('sheets: add, rename (references follow), duplicate, reorder, delete (#REF!)', () => {
  let wb = book({ Budget: { A1: 5 }, Summary: { A1: '=Budget!A1*2' } });
  wb = renameSheet(wb, 'id-Budget', 'Plan 2026');
  assert.equal(cell(wb, 'A1', 1).f, "='Plan 2026'!A1*2");
  assert.equal(result(wb, 'A1', 1), 10);
  assert.throws(() => renameSheet(wb, 'id-Summary', 'plan 2026'), /already/);
  wb = addSheet(wb, null, 'id-new');
  assert.equal(wb.sheets[2].name, 'Sheet3');
  assert.equal(wb.sheets[2].data.rowCount, 200);
  assert.equal(wb.sheets[2].data.colCount, 52);
  assert.throws(() => addSheet(wb, 'summary', 'id-dupe'), /already/);
});

test('sheets: duplicate, move and delete', () => {
  let wb = book({ Budget: { A1: 5 }, Summary: { A1: '=Budget!A1*2' } });
  wb = duplicateSheet(wb, 'id-Budget', 'id-copy');
  assert.deepEqual(wb.sheets.map((sheet) => [sheet.name, sheet.position]), [['Budget', 0], ['Budget copy', 1], ['Summary', 2]]);
  wb = moveSheet(wb, 'id-Summary', 0);
  assert.deepEqual(wb.sheets.map((sheet) => sheet.name), ['Summary', 'Budget', 'Budget copy']);
  wb = deleteSheet(wb, 'id-Budget');
  assert.equal(wb.sheets[0].data.cells['0:0'].f, '=#REF!*2');
  assert.deepEqual(wb.sheets.map((sheet) => sheet.position), [0, 1]);
  wb = deleteSheet(wb, 'id-copy');
  assert.throws(() => deleteSheet(wb, 'id-Summary'), /at least one sheet/);
  let many = book({ S: {} });
  for (let i = 1; i < TABLE_LIMITS.sheets; i += 1) many = addSheet(many, null, `x${i}`);
  assert.throws(() => addSheet(many, null, 'extra'), /at most 20/);
});

test('large sheets: 5,000 × 20 edits, sort and inserts stay fast; recalculation is scoped', () => {
  let data = emptySheetData(TABLE_LIMITS.rows, 20);
  const cells = {};
  for (let row = 0; row < 5000; row += 1) {
    for (let col = 0; col < 19; col += 1) cells[`${row}:${col}`] = { v: (row * 7 + col * 13) % 1000 };
    cells[`${row}:19`] = { f: `=SUM(A${row + 1}:S${row + 1})` };
  }
  data = { ...data, cells };
  normalizeSheetData(data);
  let wb = { sheets: [{ id: 's', name: 'Big', position: 0, data }] };
  let start = performance.now();
  const calculator = calc(wb);
  const buildMs = performance.now() - start;
  assert.equal(calculator.value('s', 0, 19), [...Array(19)].reduce((sum, _, col) => sum + (col * 13) % 1000, 0));
  start = performance.now();
  wb = { sheets: [{ ...wb.sheets[0], data: setCells(wb.sheets[0].data, [[10, 3, { v: 999999 }]]) }] };
  const live = new WorkbookCalculator({
    sheets: () => [{ id: 's', name: 'Big', rows: 5000, cols: 20 }],
    cell: (id, row, col) => wb.sheets[0].data.cells[`${row}:${col}`],
    formulaCells: () => formulaCellsOf(wb.sheets[0].data),
  });
  wb = { sheets: [{ ...wb.sheets[0], data: setCells(wb.sheets[0].data, [[10, 4, { v: 1 }]]) }] };
  start = performance.now();
  const recalculated = live.update('s', [[10, 4]]);
  assert.deepEqual([...recalculated], ['s|10:19'], 'only the row total recalculates');
  const editMs = performance.now() - start;
  start = performance.now();
  const sorted = sortRows(wb.sheets[0].data, { r1: 0, r2: 4999 }, 0, 'asc', (row, col) => wb.sheets[0].data.cells[`${row}:${col}`]?.v ?? null);
  const sortMs = performance.now() - start;
  assert.equal(Object.keys(sorted.cells).length, 100000);
  start = performance.now();
  const shrunk = deleteRows(wb, 's', 0, 1);
  assert.equal(shrunk.sheets[0].data.cells['0:19'].f, '=SUM(A1:S1)', 'row totals follow their rows');
  const insertMs = performance.now() - start;
  console.log(`large sheet: calculator ${buildMs.toFixed(0)}ms, scoped recalc after an edit ${editMs.toFixed(0)}ms, sort ${sortMs.toFixed(0)}ms, insert ${insertMs.toFixed(0)}ms`);
  assert.ok(buildMs < 4000 && sortMs < 4000 && insertMs < 4000, 'well within interactive limits on CI hardware');
});
