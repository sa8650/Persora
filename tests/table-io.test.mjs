// Persora Table import/export with the real libraries (papaparse,
// read-excel-file, write-excel-file): valid and malformed CSV/XLSX, delimiters,
// quoting, Unicode, blanks, numbers/dates, header choice, all-or-nothing limits,
// formula-injection guards and an XLSX round trip that keeps sheets, values,
// formulas and formats.
import test from 'node:test';
import assert from 'node:assert/strict';
import Papa from 'papaparse';
import readXlsxFile from 'read-excel-file/node';
import writeXlsxFile from 'write-excel-file/node';
import { unzipSync, strFromU8 } from 'fflate';
import {
  buildSheetImport, buildSmartImport, detectFieldType, parseCsvText, exportNotes, inspectMatrix, sheetCsvRows, smartCsvRows, smartXlsxSheet, workbookXlsxSheets,
} from '../cloudflare/table-io.js';
import { TABLE_LIMITS, validateFieldValue, textOfValue } from '../cloudflare/table-rules.js';
import { buildTemplate } from '../cloudflare/table-templates.js';
import { WorkbookCalculator, isFormulaError } from '../cloudflare/table-formula.js';
import { formulaCellsOf } from '../cloudflare/table-sheet-ops.js';

const parseCsv = (text, delimiter = '') => parseCsvText(Papa, text, delimiter);
const fieldByName = (meta, name) => meta.fields.find((field) => field.name === name);

test('CSV: delimiters, quoted values with commas/newlines, Unicode, blanks and header choice', () => {
  const csv = '\uFEFFName,Amount,Date,Paid,Note\r\n"Rahim, Karim",1250.50,2026-10-01,yes,"said ""hi""\nthen left"\r\nনাদিয়া,"1,000",2026-10-02,no,\r\n,,,,\r\nZoë,7,2026-10-03,yes,ok\r\n';
  const { rows, errors, delimiter } = parseCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(delimiter, ',');
  const { meta, records, report } = buildSmartImport(rows, { headerRow: true });
  assert.deepEqual(report.types.map((entry) => entry.type), ['text', 'number', 'date', 'checkbox', 'text']);
  assert.equal(report.emptyRowsSkipped, 1);
  assert.equal(records.length, 3);
  assert.deepEqual(report.kept, []);
  const name = fieldByName(meta, 'Name');
  assert.equal(name.name, 'Name', 'the BOM is not part of the first header');
  assert.equal(records[0].values[name.id], 'Rahim, Karim');
  assert.equal(records[1].values[name.id], 'নাদিয়া');
  assert.equal(records[1].values[fieldByName(meta, 'Amount').id], 1000);
  assert.equal(records[0].values[fieldByName(meta, 'Note').id], 'said "hi"\nthen left');
  assert.equal(records[0].values[fieldByName(meta, 'Paid').id], true);

  const semicolon = parseCsv('a;b\n1;2\n3;4\n');
  assert.equal(semicolon.delimiter, ';');
  const tabbed = parseCsv('a\tb\nx\ty\n');
  assert.equal(tabbed.delimiter, '\t');
  const noHeader = buildSmartImport(semicolon.rows, { headerRow: false });
  assert.deepEqual(noHeader.meta.fields.map((field) => field.name), ['Column 1', 'Column 2']);
  assert.equal(noHeader.records.length, 3, 'without a header the first row is data');
});

test('CSV: type detection never loses data; select options are created; duplicate headers are renamed', () => {
  assert.equal(detectFieldType([1, '2', null, '3.5']).type, 'number');
  assert.equal(detectFieldType(['1', 'two']).type, 'text', 'mixed columns stay text');
  assert.equal(detectFieldType(['10%', '5.5 %']).type, 'percent');
  assert.deepEqual(detectFieldType(['৳10', '৳1,200']), { type: 'currency', currency: 'BDT' });
  assert.equal(detectFieldType(['a@b.co', 'c@d.org']).type, 'email');
  assert.equal(detectFieldType(['https://a.test/x', 'http://b.test']).type, 'url');
  assert.equal(detectFieldType(['Food', 'Bills', 'Food', 'Food', 'Bills']).type, 'select');
  assert.equal(detectFieldType(['05/01/2026', '06/01/2026']).type, 'text', 'ambiguous dates stay text');
  const { meta, records } = buildSmartImport([['Cat', 'Cat', ''], ['Food', 'x', 'y'], ['Bills', 'x', ''], ['Food', 'x', ''], ['Food', 'x', '']]);
  assert.deepEqual(meta.fields.map((field) => field.name), ['Cat', 'Cat (2)', 'Column 3']);
  const cat = meta.fields[0];
  assert.equal(cat.type, 'select');
  assert.deepEqual(cat.choices.map((choice) => choice.label), ['Food', 'Bills']);
  for (const record of records) for (const field of meta.fields) assert.equal(validateFieldValue(field, record.values[field.id]).valid, true);
});

test('imports are all-or-nothing: over-limit and empty files are refused before anything is created', () => {
  const tooMany = [['h'], ...Array.from({ length: TABLE_LIMITS.importRows + 1 }, (_, index) => [String(index)])];
  assert.throws(() => buildSmartImport(tooMany), /limit is 5,000\. Nothing was imported/);
  assert.throws(() => buildSheetImport([{ name: 'S', rows: tooMany }]), /Nothing was imported/);
  const wide = [Array.from({ length: 61 }, (_, index) => `c${index}`), Array.from({ length: 61 }, () => 'x')];
  assert.throws(() => buildSmartImport(wide), /import it as a spreadsheet/);
  assert.equal(buildSheetImport([{ name: 'Wide', rows: wide }]).sheets[0].data.colCount >= 61, true, 'spreadsheets take up to 100 columns');
  assert.throws(() => buildSmartImport([['only header']]), /no data/);
  assert.throws(() => buildSmartImport([]), /no data/);
  assert.throws(() => buildSheetImport([{ name: 'Empty', rows: [[null, ''], []] }]), /no data/);
  const many = Array.from({ length: 21 }, (_, index) => ({ name: `S${index}`, rows: [['x']] }));
  assert.throws(() => buildSheetImport(many), /limit is 20/);
});

test('malformed CSV is reported by the parser and malformed XLSX is rejected', async () => {
  const broken = parseCsv('a,b\n"unterminated,1\n2,3');
  assert.ok(broken.errors.length > 0, 'unterminated quotes are reported');
  assert.match(broken.errors[0].message, /quote/i);
  assert.equal(parseCsv('a;b\n1;2', ',').rows[0].length, 1, 'a chosen delimiter is respected');
  await assert.rejects(readXlsxFile(Buffer.from('this is not a zip file at all')));
  await assert.rejects(readXlsxFile(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8])));
});

test('spreadsheet import: formulas stay text unless chosen, values are typed, header row bold+frozen', () => {
  const rows = [['Item', 'Cost', 'Share'], ['Rent', '18,000', '40%'], ['=HYPERLINK("evil")', '2', ''], ['Total', '=SUM(B2:B3)', '']];
  const plain = buildSheetImport([{ name: 'Sheet/1', rows }], { headerRow: true });
  const sheet = plain.sheets[0];
  assert.equal(sheet.name, 'Sheet 1');
  assert.deepEqual(sheet.data.cells['1:1'], { v: 18000 });
  assert.deepEqual(sheet.data.cells['1:2'], { v: 0.4, s: { nf: 'percent', dp: 0 } });
  assert.deepEqual(sheet.data.cells['2:0'], { v: '=HYPERLINK("evil")' }, 'formula-looking text is imported as text by default');
  assert.equal(plain.report.formulasAsText, 2);
  assert.equal(sheet.data.cells['0:0'].s.b, 1);
  assert.equal(sheet.data.frozenRows, 1);
  const withFormulas = buildSheetImport([{ name: 'S', rows }], { headerRow: false, formulas: true });
  assert.deepEqual(withFormulas.sheets[0].data.cells['3:1'], { f: '=SUM(B2:B3)' });
  assert.equal(withFormulas.sheets[0].data.frozenRows, 0);
  const dates = buildSheetImport([{ name: 'D', rows: [[new Date(Date.UTC(2026, 9, 24)), 5, true, null]] }], { headerRow: false });
  assert.deepEqual(dates.sheets[0].data.cells['0:0'], { v: '2026-10-24', s: { nf: 'date' } });
  assert.deepEqual(dates.sheets[0].data.cells['0:2'], { v: true });
  assert.deepEqual(inspectMatrix([[1, null], [null, null], []]).height, 1);
});

function calculatorFor(sheets) {
  return new WorkbookCalculator({
    sheets: () => sheets.map((sheet) => ({ id: sheet.id, name: sheet.name, rows: sheet.data.rowCount, cols: sheet.data.colCount })),
    cell: (id, row, col) => sheets.find((sheet) => sheet.id === id).data.cells[`${row}:${col}`],
    formulaCells: (id) => formulaCellsOf(sheets.find((sheet) => sheet.id === id).data),
  });
}

test('XLSX export → import round trip keeps sheets, values, formulas and formats', async () => {
  const budget = buildTemplate('monthly-budget', '2026-10-24').sheets[0];
  const second = { id: crypto.randomUUID(), name: 'Notes & “quotes”', position: 1, data: { rowCount: 10, colCount: 5, cells: { '0:0': { v: 'বাংলা', s: { i: 1, c: '#175CD3' } }, '1:0': { v: '2026-01-31', s: { nf: 'date' } }, '2:0': { f: "=Budget!B8*2" }, '3:0': { v: true } }, colWidths: {}, rowHeights: {}, frozenRows: 0 } };
  const sheets = [budget, second];
  const buffer = await writeXlsxFile(workbookXlsxSheets(sheets)).toBuffer();
  const back = await readXlsxFile(buffer);
  assert.deepEqual(back.map((entry) => entry.sheet), ['Budget', 'Notes & “quotes”']);
  assert.equal(back[0].data[0][0], 'Category');
  assert.equal(back[0].data[1][0], 'Example: Rent');
  assert.equal(back[0].data[1][1], 18000);
  assert.equal(back[1].data[0][0], 'বাংলা');
  assert.ok(back[1].data[1][0] instanceof Date && back[1].data[1][0].toISOString().startsWith('2026-01-31'));
  assert.equal(back[1].data[3][0], true);
  const files = unzipSync(new Uint8Array(buffer));
  const sheetXml = strFromU8(files['xl/worksheets/sheet1.xml']);
  assert.match(sheetXml, /<f>B2-C2<\/f>/, 'formulas are written as Excel formulas (no leading =)');
  assert.doesNotMatch(sheetXml, /<f>=/);
  assert.match(sheetXml, /<f>SUM\(B2:B7\)<\/f>/);
  assert.match(sheetXml, /ySplit="1"/, 'the header row stays frozen');
  assert.match(strFromU8(files['xl/worksheets/sheet2.xml']), /<f>Budget!B8\*2<\/f>/);
  const styles = strFromU8(files['xl/styles.xml']);
  assert.match(styles, /<b\/>/, 'bold survives');
  assert.match(styles, /F2F4F7/i, 'fill colour survives');
  assert.match(styles, /#,##0\.00/, 'currency number format survives');

  // Re-import the file as a spreadsheet: values come back typed.
  const reimported = buildSheetImport(back.map((entry) => ({ name: entry.sheet, rows: entry.data })), { headerRow: true });
  assert.deepEqual(reimported.sheets.map((sheet) => sheet.name), ['Budget', 'Notes & “quotes”']);
  assert.equal(reimported.sheets[0].data.cells['1:1'].v, 18000);
});

test('CSV export: current results, injection guard, honest notes', () => {
  const sheet = { id: 's', name: 'S', position: 0, data: { rowCount: 5, colCount: 5, cells: { '0:0': { v: '=cmd|calc' }, '0:1': { f: '=2*21' }, '0:2': { v: -5 }, '1:0': { f: '=1/0' }, '1:1': { v: '+danger' } }, colWidths: {}, rowHeights: {}, frozenRows: 0 } };
  const calculator = calculatorFor([sheet]);
  const rows = sheetCsvRows(sheet, (row, col) => calculator.value('s', row, col));
  assert.deepEqual(rows, [['=cmd|calc', 42, -5], ['#DIV/0!', '+danger', '']]);
  const csv = Papa.unparse(rows, { escapeFormulae: true });
  assert.equal(csv, `"'=cmd|calc",42,-5\r\n#DIV/0!,"'+danger",`, 'text that could run as a formula is neutralised; numbers are untouched');
  assert.ok(exportNotes('spreadsheet', 'csv', { sheets: 2 }).some((note) => /only the current sheet/.test(note)));
  assert.ok(exportNotes('spreadsheet', 'csv').some((note) => /no formatting, formulas/.test(note)));
  assert.ok(!exportNotes('spreadsheet', 'csv').some((note) => /keeps (sheets|formatting|formulas)/i.test(note)), 'CSV never claims to keep sheets, formatting or formulas');
  assert.ok(exportNotes('smart', 'xlsx', { attachments: true }).some((note) => /file names only/.test(note)));
});

test('Smart Table export to CSV and XLSX keeps values and types', async () => {
  const content = buildTemplate('expense-tracker', '2026-10-24');
  const { fields } = content.meta;
  const csvRows = smartCsvRows(fields, content.records);
  assert.deepEqual(csvRows[0], fields.map((field) => field.name));
  const amount = fields.findIndex((field) => field.name === 'Amount');
  const category = fields.findIndex((field) => field.name === 'Category');
  assert.equal(csvRows[1][amount], 2450);
  assert.equal(csvRows[1][category], 'Food');
  const parsedBack = Papa.parse(Papa.unparse(csvRows, { escapeFormulae: true })).data;
  const reimported = buildSmartImport(parsedBack);
  assert.equal(reimported.records.length, content.records.length);
  assert.equal(reimported.meta.fields.find((field) => field.name === 'Amount').type, 'number');
  assert.equal(reimported.meta.fields.find((field) => field.name === 'Date').type, 'date');

  const buffer = await writeXlsxFile([smartXlsxSheet('Expenses', fields, content.records)]).toBuffer();
  const [sheet] = await readXlsxFile(buffer);
  assert.equal(sheet.sheet, 'Expenses');
  assert.deepEqual(sheet.data[0], fields.map((field) => field.name));
  assert.equal(sheet.data[1][amount], 2450);
  assert.ok(sheet.data[1][fields.findIndex((field) => field.name === 'Date')] instanceof Date);
  const fromXlsx = buildSmartImport(sheet.data);
  const amountField = fromXlsx.meta.fields.find((field) => field.name === 'Amount');
  assert.equal(fromXlsx.records[0].values[amountField.id], 2450);
  const categoryField = fromXlsx.meta.fields.find((field) => field.name === 'Category');
  assert.equal(textOfValue(categoryField, fromXlsx.records[0].values[categoryField.id]), 'Food');
  assert.ok(isFormulaError({ error: '#REF!' }));
});
