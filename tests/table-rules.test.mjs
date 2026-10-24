// Persora Table shared rules: cell input (entered value vs formula), display
// formats, styles, sheet validation, fields and safe retyping, views that never
// modify records, summaries/charts, save-batch validation and templates.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TABLE_LIMITS, applyView, attachmentIdsIn, cellEditText, chartData, coerceFieldInput, displayValue, fieldSummary, finalizeRecordValues, formatCellValue,
  groupForBoard, newField, newView, normalizeFields, normalizeSaveBatch, normalizeSheetData, normalizeSmartMeta, normalizeViews, parseCellInput,
  planRetype, sanitizeStyle, textOfValue, uniqueSheetName, validateFieldValue, validateSheetName, valuesSummary, viewSetupProblem, emptySheetData, makeChoices,
} from '../cloudflare/table-rules.js';
import { TABLE_TEMPLATES, blankSmartTable, blankSpreadsheet, buildTemplate } from '../cloudflare/table-templates.js';
import { formulaError } from '../cloudflare/table-formula.js';

const throwsMessage = (fn, pattern) => assert.throws(fn, (error) => { assert.match(error.message, pattern); return true; });

test('cell input: formulas, forced text, numbers, percent, currency, dates, booleans', () => {
  assert.deepEqual(parseCellInput(''), { empty: true });
  assert.deepEqual(parseCellInput('=SUM(A1:A2)'), { formula: '=SUM(A1:A2)' });
  assert.deepEqual(parseCellInput('=SUM(A1'), { formula: '=SUM(A1' }, 'invalid formulas are still kept as formulas');
  assert.deepEqual(parseCellInput("'=not a formula"), { value: '=not a formula' }, 'a leading apostrophe forces text');
  assert.deepEqual(parseCellInput("'007"), { value: '007' });
  assert.deepEqual(parseCellInput('42'), { value: 42 });
  assert.deepEqual(parseCellInput('-1,234.50'), { value: -1234.5 });
  assert.deepEqual(parseCellInput('1,23'), { value: '1,23' }, 'malformed grouping stays text');
  assert.deepEqual(parseCellInput('15%'), { value: 0.15, format: { nf: 'percent', dp: 0 } });
  assert.deepEqual(parseCellInput('12.5 %'), { value: 0.125, format: { nf: 'percent', dp: 1 } });
  assert.deepEqual(parseCellInput('৳1,500'), { value: 1500, format: { nf: 'currency', cur: 'BDT' } });
  assert.deepEqual(parseCellInput('-$20.5'), { value: -20.5, format: { nf: 'currency', cur: 'USD' } });
  assert.deepEqual(parseCellInput('2026-10-24'), { value: '2026-10-24', format: { nf: 'date' } });
  assert.deepEqual(parseCellInput('2026-02-30'), { value: '2026-02-30' }, 'impossible dates stay text');
  assert.deepEqual(parseCellInput('TRUE'), { value: true });
  assert.deepEqual(parseCellInput('বাংলা টেক্সট'), { value: 'বাংলা টেক্সট' }, 'Unicode text is kept');
  assert.deepEqual(parseCellInput('='), { value: '=' }, 'a lone = is text');
  assert.equal(parseCellInput('x'.repeat(20000)).value.length, TABLE_LIMITS.cellText);
});

test('edit text round-trips the entered value, keeping formulas distinct from results', () => {
  assert.equal(cellEditText({ f: '=A1*2', v: 99 }), '=A1*2');
  assert.equal(cellEditText({ v: 0.15, s: { nf: 'percent' } }), '15%');
  assert.equal(cellEditText({ v: '=text' }), "'=text", 'text that would become a formula gets its apostrophe back');
  assert.equal(cellEditText({ v: '007' }), "'007");
  assert.equal(cellEditText({ v: 'hello' }), 'hello');
  assert.equal(cellEditText({ v: false }), 'FALSE');
  assert.equal(cellEditText(undefined), '');
  for (const typed of ['=SUM(A1:A3)', "'=x", '42', 'TRUE', 'plain', '2026-01-31']) {
    const parsed = parseCellInput(typed);
    const cell = parsed.formula ? { f: parsed.formula } : { v: parsed.value, s: parsed.format };
    assert.deepEqual(parseCellInput(cellEditText(cell)), parsed, typed);
  }
});

test('display formats and errors', () => {
  assert.equal(formatCellValue(0.1 + 0.2), '0.3', 'no float noise');
  assert.equal(formatCellValue(1234.5, { nf: 'number' }), '1,234.50');
  assert.equal(formatCellValue(1234.5, { nf: 'number', dp: 0 }), '1,235');
  assert.equal(formatCellValue(0.256, { nf: 'percent', dp: 1 }), '25.6%');
  assert.match(formatCellValue(1500, { nf: 'currency', cur: 'BDT' }), /1,500\.00/);
  assert.match(formatCellValue(12, { nf: 'currency', cur: 'USD' }), /^\$12\.00$/);
  assert.equal(formatCellValue('2026-10-24', { nf: 'date' }), 'Oct 24, 2026');
  assert.equal(formatCellValue(true), 'TRUE');
  assert.equal(formatCellValue(null), '');
  assert.equal(formatCellValue(formulaError('#DIV/0!')), '#DIV/0!');
  assert.equal(formatCellValue(123456789012345678), '1.2346e+17');
});

test('styles are sanitized to the restrained palette', () => {
  assert.deepEqual(sanitizeStyle({ b: true, i: 1, a: 'c', c: '#b42318', bg: '#FEE4E2', fs: 16, bd: 'lbt', nf: 'currency', dp: 2, cur: 'USD' }),
    { b: 1, i: 1, a: 'c', c: '#B42318', bg: '#FEE4E2', fs: 16, bd: 'tbl', nf: 'currency', dp: 2, cur: 'USD' });
  assert.equal(sanitizeStyle({ c: '#123456', bg: 'red', fs: 99, a: 'justify', nf: 'scientific', cur: 'XXX', bd: 'zz', onload: 'x' }), undefined);
  assert.equal(sanitizeStyle({ fs: 13 }), undefined, 'the default size is not stored');
});

test('sheet data validation and sheet names', () => {
  const data = normalizeSheetData({ rowCount: 10, colCount: 5, cells: { '0:0': { v: 1 }, '1:1': { f: '=A1', v: 7 }, '2:2': { v: '' }, '3:3': { s: { b: 1 } } }, colWidths: { 0: 9999, 9: 50 }, rowHeights: { 1: 5 }, frozenRows: 99 });
  assert.deepEqual(data.cells, { '0:0': { v: 1 }, '1:1': { f: '=A1' }, '3:3': { s: { b: 1 } } }, 'formula cells store the formula only');
  assert.deepEqual(data.colWidths, { 0: 600 });
  assert.deepEqual(data.rowHeights, { 1: 22 });
  assert.equal(data.frozenRows, 9);
  throwsMessage(() => normalizeSheetData({ rowCount: 2, colCount: 2, cells: { '5:0': { v: 1 } } }), /outside/);
  throwsMessage(() => normalizeSheetData({ rowCount: TABLE_LIMITS.rows + 1, colCount: 2, cells: {} }), /rows/);
  throwsMessage(() => normalizeSheetData({ rowCount: 2, colCount: 2, cells: { 'A1': { v: 1 } } }), /address/);
  assert.equal(validateSheetName('  Budget   2026 '), 'Budget 2026');
  throwsMessage(() => validateSheetName('a/b'), /can't contain/);
  throwsMessage(() => validateSheetName('budget', ['Budget']), /already/);
  throwsMessage(() => validateSheetName('x'.repeat(32)), /31/);
  throwsMessage(() => validateSheetName(''), /empty/);
  assert.equal(uniqueSheetName('Sheet1', ['sheet1', 'Sheet1 2']), 'Sheet1 3');
  assert.equal(uniqueSheetName('Bad/Name', []), 'Bad Name');
});

test('fields: normalization, validation and coercion by type', () => {
  const status = newField('Status', 'status');
  assert.deepEqual(status.choices.map((choice) => choice.label), ['Not started', 'In progress', 'Done']);
  throwsMessage(() => normalizeFields([newField('A'), { ...newField('a') }]), /already a field/);
  throwsMessage(() => normalizeFields([{ id: 'f_x1', name: 'X', type: 'formula' }]), /unknown type/);
  throwsMessage(() => normalizeFields([]), /at least one field/);
  const money = newField('Amount', 'currency', { currency: 'USD' });
  assert.deepEqual(coerceFieldInput(money, '$1,250.5'), { ok: true, value: 1250.5 });
  assert.deepEqual(coerceFieldInput(money, 'USD 12'), { ok: true, value: 12 });
  assert.equal(coerceFieldInput(money, 'lots').ok, false);
  assert.equal(coerceFieldInput(money, 'lots').value, 'lots', 'unconvertible input is returned, not dropped');
  assert.deepEqual(coerceFieldInput(newField('P', 'percent'), '15'), { ok: true, value: 0.15 });
  assert.deepEqual(coerceFieldInput(newField('D', 'date'), '2026/1/5'), { ok: true, value: '2026-01-05' });
  assert.equal(coerceFieldInput(newField('D', 'date'), '05/01/2026').ok, false, 'ambiguous day/month order is not guessed');
  assert.deepEqual(coerceFieldInput(newField('C', 'checkbox'), 'Yes'), { ok: true, value: true });
  assert.deepEqual(coerceFieldInput(newField('U', 'url'), 'example.com/a'), { ok: true, value: 'https://example.com/a' });
  assert.equal(coerceFieldInput(newField('U', 'url'), 'javascript:alert(1)').ok, false, 'only http(s) links');
  assert.equal(coerceFieldInput(newField('E', 'email'), 'a@b').ok, false);
  const select = newField('S', 'select', { choices: makeChoices([{ label: 'Red' }]) });
  assert.deepEqual(coerceFieldInput(select, 'red'), { ok: true, value: select.choices[0].id });
  assert.equal(coerceFieldInput(select, 'Blue').ok, false);
  const created = coerceFieldInput(select, 'Blue', { createChoices: true });
  assert.equal(created.newChoices[0].label, 'Blue');
  const multi = newField('M', 'multiselect');
  const many = coerceFieldInput(multi, 'a, b; a', { createChoices: true });
  assert.equal(many.value.length, 2);
  assert.deepEqual(validateFieldValue(money, 'oops'), { valid: false, message: 'Not a valid number.' });
  assert.deepEqual(validateFieldValue(newField('Who', 'person'), { id: crypto.randomUUID(), name: 'Ana' }), { valid: true });
  assert.equal(displayValue(money, 1250.5), '$1,250.50');
  assert.equal(displayValue(money, 'oops'), 'oops', 'invalid values stay visible');
  assert.equal(textOfValue(newField('P', 'percent'), 0.155), '15.5%');
});

test('retyping never deletes values; attachments are protected', () => {
  const text = newField('Score', 'text');
  const records = [
    { id: 'r1', position: 1, values: { [text.id]: '12' } },
    { id: 'r2', position: 2, values: { [text.id]: 'n/a' } },
    { id: 'r3', position: 3, values: {} },
    { id: 'r4', position: 4, values: { [text.id]: '7.5' } },
  ];
  const plan = planRetype(text, 'number', records);
  assert.equal(plan.allowed, true);
  assert.equal(plan.converted, 2);
  assert.equal(plan.kept, 1);
  assert.deepEqual(plan.examples, ['n/a']);
  assert.equal(plan.values.get('r1'), 12);
  assert.equal(plan.values.has('r2'), false, 'unconvertible values are not in the change set (kept unchanged)');
  const toSelect = planRetype(text, 'select', records);
  assert.equal(toSelect.kept, 0);
  assert.deepEqual(toSelect.field.choices.map((choice) => choice.label), ['12', 'n/a', '7.5'], 'options are created from distinct values');
  const multi = { ...newField('Tags', 'multiselect'), choices: makeChoices([{ label: 'a' }, { label: 'b' }]) };
  const back = planRetype(multi, 'select', [{ id: 'x', values: { [multi.id]: [multi.choices[0].id, multi.choices[1].id] } }, { id: 'y', values: { [multi.id]: [multi.choices[1].id] } }]);
  assert.equal(back.kept, 1, 'two options cannot become one; the value is kept');
  assert.equal(back.values.get('y'), multi.choices[1].id);
  assert.equal(planRetype(newField('Files', 'attachment'), 'text', []).allowed, false);
  assert.equal(planRetype(text, 'attachment', []).allowed, false);
  const num = newField('N', 'number');
  const asText = planRetype(num, 'text', [{ id: 'a', values: { [num.id]: 3.5 } }]);
  assert.equal(asText.values.get('a'), '3.5');
});

test('views filter, search and sort without modifying records', () => {
  const name = newField('Name', 'text');
  const amount = newField('Amount', 'currency');
  const when = newField('When', 'date');
  const status = newField('Status', 'status');
  const done = newField('Done', 'checkbox');
  const tags = { ...newField('Tags', 'multiselect'), choices: makeChoices([{ label: 'x' }, { label: 'y' }]) };
  const fields = [name, amount, when, status, done, tags];
  const [todo, doing, finished] = status.choices.map((choice) => choice.id);
  const records = [
    { id: '1', position: 1, values: { [name.id]: 'Rent', [amount.id]: 18000, [when.id]: '2026-10-01', [status.id]: finished, [done.id]: true, [tags.id]: [tags.choices[0].id] } },
    { id: '2', position: 2, values: { [name.id]: 'groceries', [amount.id]: 2450, [when.id]: '2026-10-18', [status.id]: doing } },
    { id: '3', position: 3, values: { [name.id]: 'Bus', [amount.id]: 'oops', [status.id]: todo } },
    { id: '4', position: 4, values: { [name.id]: 'Gift', [amount.id]: 900, [when.id]: '2026-10-20', [tags.id]: [tags.choices[1].id] } },
  ];
  const frozen = JSON.stringify(records);
  const view = (patch) => ({ ...newView('table'), ...patch });
  const ids = (list) => list.map((record) => record.id).join(',');
  assert.equal(ids(applyView(fields, records, view({}))), '1,2,3,4');
  assert.equal(ids(applyView(fields, records, view({ sort: [{ fieldId: amount.id, dir: 'asc' }] }))), '4,2,1,3', 'invalid/blank values sort last');
  assert.equal(ids(applyView(fields, records, view({ sort: [{ fieldId: amount.id, dir: 'desc' }] }))), '1,2,4,3', 'and last when descending too');
  assert.equal(ids(applyView(fields, records, view({ sort: [{ fieldId: name.id, dir: 'asc' }] }))), '3,4,2,1', 'text sort ignores case');
  assert.equal(ids(applyView(fields, records, view({ sort: [{ fieldId: status.id, dir: 'asc' }] }))), '3,2,1,4', 'status sorts by option order');
  assert.equal(ids(applyView(fields, records, view({ filters: [{ fieldId: amount.id, op: 'gt', value: '1000' }] }))), '1,2');
  assert.equal(ids(applyView(fields, records, view({ filters: [{ fieldId: amount.id, op: 'gt', value: '' }] }))), '1,2,3,4', 'an incomplete filter is ignored');
  assert.equal(ids(applyView(fields, records, view({ filters: [{ fieldId: when.id, op: 'after', value: '2026-10-10' }] }))), '2,4');
  assert.equal(ids(applyView(fields, records, view({ filters: [{ fieldId: when.id, op: 'empty', value: '' }] }))), '3');
  assert.equal(ids(applyView(fields, records, view({ filters: [{ fieldId: status.id, op: 'is', value: doing }] }))), '2');
  assert.equal(ids(applyView(fields, records, view({ filters: [{ fieldId: done.id, op: 'unchecked', value: '' }] }))), '2,3,4');
  assert.equal(ids(applyView(fields, records, view({ filters: [{ fieldId: tags.id, op: 'has_any', value: [tags.choices[1].id] }] }))), '4');
  assert.equal(ids(applyView(fields, records, view({ filters: [{ fieldId: name.id, op: 'contains', value: 'R' }] }))), '1,2');
  assert.equal(ids(applyView(fields, records, view({}), 'in progress')), '2', 'search matches option labels');
  assert.equal(ids(applyView(fields, records, view({}), '18000')), '1');
  assert.equal(JSON.stringify(records), frozen, 'records are never modified');
  const board = groupForBoard(status, records);
  assert.deepEqual(board.map((group) => group.records.length), [1, 1, 1, 1]);
  assert.equal(board[3].label, 'No Status');
  assert.match(viewSetupProblem({ ...newView('board') }, [name]), /Add one/);
  assert.match(viewSetupProblem({ ...newView('board') }, fields), /Choose/);
  assert.equal(viewSetupProblem({ ...newView('board'), groupBy: status.id }, fields), null);
  assert.match(viewSetupProblem({ ...newView('calendar') }, [name]), /Add a Date field/);
  assert.equal(viewSetupProblem({ ...newView('calendar'), dateField: when.id }, fields), null);
  const normalized = normalizeViews([{ ...newView('table'), filters: [{ fieldId: 'f_gone00', op: 'is', value: 'x' }, { fieldId: name.id, op: 'evil', value: 1 }, { fieldId: name.id, op: 'contains', value: 'a' }], hidden: ['f_gone00', name.id], groupBy: 'f_gone00' }], fields);
  assert.equal(normalized[0].filters.length, 1);
  assert.deepEqual(normalized[0].hidden, [name.id]);
  assert.equal(normalized[0].groupBy, null);

  // Summaries respect what the view shows.
  const visible = applyView(fields, records, view({ filters: [{ fieldId: amount.id, op: 'gt', value: 1000 }] }));
  assert.deepEqual(fieldSummary(amount, visible), { count: 2, filled: 2, empty: 0, numbers: 2, sum: 20450, average: 10225, min: 2450, max: 18000 });
  const all = fieldSummary(amount, records);
  assert.equal(all.numbers, 3, 'invalid values are excluded from totals');
  assert.deepEqual(fieldSummary(status, records).distribution.map((entry) => entry.count), [1, 1, 1]);
  assert.equal(fieldSummary(done, records).checked, 1);
  assert.deepEqual(valuesSummary([1, 2, 'x', null, formulaError('#REF!')]), { count: 3, numbers: 2, sum: 3, average: 1.5, min: 1, max: 2 });
  const chart = chartData(fields, records, { groupField: status.id, valueField: amount.id, aggregate: 'sum' });
  assert.deepEqual(chart.points.map((point) => [point.label, point.value]), [['Not started', 0], ['In progress', 2450], ['Done', 18000]]);
  assert.equal(chart.skipped, 1, 'records without a group value are reported');
  const monthly = chartData(fields, records, { groupField: when.id });
  assert.deepEqual(monthly.points.map((point) => [point.label, point.value]), [['Oct 2026', 3]]);
  assert.deepEqual(chartData(fields, [], { groupField: status.id }).points, []);
  assert.deepEqual(chartData(fields, records, { groupField: 'f_missing' }).points, []);
});

test('save batches: kind separation, ids, limits and value cleaning', () => {
  const base = { baseRevision: 3, batchId: crypto.randomUUID() };
  const sheet = { id: crypto.randomUUID(), name: 'Sheet1', position: 0, data: emptySheetData(10, 5) };
  const ok = normalizeSaveBatch('spreadsheet', { ...base, sheets: { upsert: [sheet], delete: [crypto.randomUUID()] } });
  assert.equal(ok.sheetUpserts.length, 1);
  throwsMessage(() => normalizeSaveBatch('spreadsheet', { ...base, records: { upsert: [] } }), /don't have fields/);
  throwsMessage(() => normalizeSaveBatch('smart', { ...base, sheets: { upsert: [] } }), /don't have sheets/);
  throwsMessage(() => normalizeSaveBatch('spreadsheet', { ...base, sheets: { upsert: [sheet, { ...sheet, id: crypto.randomUUID(), name: 'sheet1' }] } }), /already a sheet/);
  throwsMessage(() => normalizeSaveBatch('spreadsheet', { baseRevision: 0, batchId: base.batchId }), /base version/);
  throwsMessage(() => normalizeSaveBatch('spreadsheet', { baseRevision: 1, batchId: 'nope' }), /needs an id/);
  throwsMessage(() => normalizeSaveBatch('spreadsheet', { ...base, sheets: { delete: ['x'] } }), /malformed/);
  const big = { ...base, sheets: { upsert: [{ ...sheet, data: { ...sheet.data, cells: { '0:0': { v: 'x'.repeat(10000) } } } }] } };
  big.padding = 'y'.repeat(TABLE_LIMITS.saveBytes);
  throwsMessage(() => normalizeSaveBatch('spreadsheet', big), /too large/);

  const smart = blankSmartTable();
  const [nameField] = smart.meta.fields;
  const record = { id: crypto.randomUUID(), position: 1, values: { [nameField.id]: 'Hello', f_unknown1: 'dropped', [smart.meta.fields[1].id]: '' } };
  const withMeta = normalizeSaveBatch('smart', { ...base, meta: smart.meta, records: { upsert: [record] } });
  assert.deepEqual(withMeta.recordUpserts[0].values, { [nameField.id]: 'Hello' }, 'unknown fields and blanks are not stored');
  const withoutMeta = normalizeSaveBatch('smart', { ...base, records: { upsert: [record] } });
  assert.equal(withoutMeta.valuesPending, true);
  finalizeRecordValues(withoutMeta, smart.meta.fields);
  assert.deepEqual(withoutMeta.recordUpserts[0].values, { [nameField.id]: 'Hello' });
  throwsMessage(() => normalizeSaveBatch('smart', { ...base, meta: smart.meta, records: { upsert: [{ ...record, values: { [nameField.id]: { evil: true } } }] } }), /malformed value/);
  const wide = { ...smart.meta, fields: [...Array(8)].map((_, index) => newField(`Text ${index}`, 'text')) };
  wide.primaryField = wide.fields[0].id;
  const huge = Object.fromEntries(wide.fields.map((field) => [field.id, 'z'.repeat(9000)]));
  throwsMessage(() => normalizeSaveBatch('smart', { ...base, meta: wide, records: { upsert: [{ ...record, values: huge }] } }), /record is too large/);
  const attach = newField('Files', 'attachment');
  const meta = normalizeSmartMeta({ ...smart.meta, fields: [...smart.meta.fields, attach] });
  const fileId = crypto.randomUUID();
  assert.deepEqual([...attachmentIdsIn(meta, [{ id: 'r', values: { [attach.id]: [{ id: fileId, name: 'a.pdf', size: 1, type: 'application/pdf' }] } }])], [fileId]);
});

test('every template builds valid content with labelled examples', () => {
  assert.equal(TABLE_TEMPLATES.length, 10);
  const names = TABLE_TEMPLATES.map((template) => template.name);
  for (const forbidden of [/habit/i, /loan/i, /subscription/i]) assert.ok(!names.some((name) => forbidden.test(name)), `no ${forbidden} template`);
  for (const template of TABLE_TEMPLATES) {
    const content = buildTemplate(template.id, '2026-10-24');
    assert.equal(content.kind, template.kind, template.id);
    const batch = { baseRevision: 1, batchId: crypto.randomUUID() };
    if (content.kind === 'smart') {
      const normalized = normalizeSaveBatch('smart', { ...batch, meta: content.meta, records: { upsert: content.records } });
      assert.ok(normalized.recordUpserts.length >= 3, `${template.id} has example rows`);
      assert.ok(content.records.every((record) => record.example === true), `${template.id} examples are labelled`);
      for (const record of normalized.recordUpserts) {
        for (const field of normalized.meta.fields) assert.equal(validateFieldValue(field, record.values[field.id]).valid, true, `${template.id}.${field.name}`);
      }
      for (const view of normalized.meta.views) assert.equal(viewSetupProblem(view, normalized.meta.fields), null, `${template.id} view ${view.name}`);
      assert.equal(normalized.meta.charts.length, content.meta.charts.length, `${template.id} charts survive validation`);
    } else {
      const normalized = normalizeSaveBatch('spreadsheet', { ...batch, sheets: { upsert: content.sheets } });
      const cells = Object.values(normalized.sheetUpserts[0].data.cells);
      assert.ok(cells.some((cell) => typeof cell.v === 'string' && cell.v.startsWith('Example:')), `${template.id} examples are labelled`);
      assert.ok(cells.some((cell) => typeof cell.f === 'string'), `${template.id} uses formulas`);
    }
  }
  assert.equal(buildTemplate('nope', '2026-10-24'), null);
  assert.equal(blankSpreadsheet().sheets[0].data.rowCount, 100);
});
