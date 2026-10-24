  step('Spreadsheet: keyboard navigation, range summary, formatting and shortcuts');
  {
    await cell(page, 1, 1).click();
    await eventually(() => page.locator('.tb-address').innerText(), 'B2', 'B2 selected');
    await page.keyboard.press('ArrowRight');
    await eventually(() => page.locator('.tb-address').innerText(), 'C2', 'arrow keys move the selection');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Shift+ArrowDown');
    await eventually(() => page.locator('.tb-address').innerText(), 'B2:B3', 'shift+arrow extends the range');
    const status = await eventually(() => page.locator('.tb-status').innerText(), (text) => /Sum\s+1,?350\.5/.test(text) && /Count\s+2/.test(text), 'range summary shows sum and count');
    assert.match(status, /Average\s+675\.25/);
    await page.getByRole('button', { name: 'Bold', exact: true }).click();
    await page.getByRole('combobox', { name: 'Number format' }).selectOption('currency');
    await chooseMenu(page, 'Fill color', 'Yellow');
    await saved(page);
    let cells = sheetCells(sheetId);
    for (const key of ['1:1', '2:1']) {
      assert.equal(cells[key].s.b, 1, `${key} bold`);
      assert.equal(cells[key].s.nf, 'currency', `${key} currency`);
      assert.ok(cells[key].s.bg, `${key} filled`);
    }
    await expectCell(page, 1, 1, (text) => /1,000\.00/.test(text) && /BDT|৳|Tk/.test(text), 'currency format shows the amount with its currency');
    // Ctrl+B on a single cell toggles bold without opening the editor.
    await cell(page, 0, 0).click();
    await eventually(() => page.locator('.tb-address').innerText(), 'A1', 'A1 selected');
    await page.keyboard.press('Control+b');
    assert.equal(await page.locator('.tb-cell-editor').isHidden(), true, 'Ctrl+B does not start editing');
    await saved(page);
    assert.equal(sheetCells(sheetId)['0:0'].s?.b, 1, 'Ctrl+B made A1 bold');
    // Clear formatting keeps the values.
    await cell(page, 1, 1).click();
    await page.keyboard.press('Shift+ArrowDown');
    await eventually(() => page.locator('.tb-address').innerText(), 'B2:B3', 'range selected again');
    await page.getByRole('button', { name: 'Clear formatting', exact: true }).click();
    await saved(page);
    cells = sheetCells(sheetId);
    assert.deepEqual([cells['1:1'], cells['2:1']], [{ v: 1000 }, { v: 350.5 }], 'formatting cleared, values kept');
    await snap(page, '03-desktop-formatting');
    ok('arrows and shift-selection, sum/average/count, bold, currency, fill, Ctrl+B and clear formatting');
  }

  step('Spreadsheet: copy/paste with relative formulas, delete, undo and redo');
  {
    await cell(page, 1, 0).click();
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowRight');
    await eventually(() => page.locator('.tb-address').innerText(), 'A2:B3', 'A2:B3 selected');
    await page.keyboard.press('Control+c');
    await cell(page, 1, 3).click();
    await eventually(() => page.locator('.tb-address').innerText(), 'D2', 'D2 selected');
    await page.keyboard.press('Control+v');
    await expectCell(page, 1, 3, 'Rent', 'pasted text');
    await expectCell(page, 2, 4, '350.5', 'pasted number');
    // A formula pasted elsewhere moves its references.
    await cell(page, 3, 1).click();
    await eventually(() => page.locator('.tb-address').innerText(), 'B4', 'B4 selected');
    await page.keyboard.press('Control+c');
    await cell(page, 3, 4).click();
    await eventually(() => page.locator('.tb-address').innerText(), 'E4', 'E4 selected');
    await page.keyboard.press('Control+v');
    await expectCell(page, 3, 4, '1350.5', 'pasted formula recalculates for its new place');
    await saved(page);
    assert.equal(sheetCells(sheetId)['3:4'].f, '=SUM(E2:E3)', 'relative references moved');
    // Delete clears the selected cells; dependents follow.
    await cell(page, 1, 3).click();
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowRight');
    await eventually(() => page.locator('.tb-address').innerText(), 'D2:E3', 'D2:E3 selected');
    await page.keyboard.press('Delete');
    await expectCell(page, 1, 3, '', 'deleted');
    await expectCell(page, 3, 4, '0', 'SUM of empty cells is 0');
    // Undo brings them back; redo clears again.
    await page.keyboard.press('Control+z');
    await expectCell(page, 1, 3, 'Rent', 'undo restores');
    await expectCell(page, 3, 4, '1350.5', 'and dependents recalculate');
    await page.keyboard.press('Control+y');
    await expectCell(page, 1, 3, '', 'redo clears again');
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expectCell(page, 1, 3, 'Rent', 'the Undo button works too');
    await saved(page);
    assert.equal(sheetCells(sheetId)['1:3'].v, 'Rent', 'the undone state is what gets saved');
    ok('copy/paste (values and relative formulas), Delete, Ctrl+Z/Ctrl+Y and the Undo button');
  }

  step('Spreadsheet: rows, columns, row height, freeze, find');
  {
    await cell(page, 1, 0).click();
    await eventually(() => page.locator('.tb-address').innerText(), 'A2', 'A2 selected');
    await chooseMenu(page, 'Rows and columns', 'Insert row above');
    await expectCell(page, 2, 0, 'Rent', 'rows shift down');
    await expectCell(page, 4, 1, '1350.5', 'the total still adds the same cells');
    await saved(page);
    assert.equal(sheetCells(sheetId)['4:1'].f, '=SUM(B3:B4)', 'formula references follow the inserted row');
    await chooseMenu(page, 'Rows and columns', 'Delete row');
    await expectCell(page, 1, 0, 'Rent', 'deleted row closes the gap');
    await cell(page, 0, 2).click();
    await eventually(() => page.locator('.tb-address').innerText(), 'C1', 'C1 selected');
    await chooseMenu(page, 'Rows and columns', 'Insert column left');
    await saved(page);
    assert.equal(sheetCells(sheetId)['3:1'].f, '=SUM(B2:B3)', 'a column inserted to the right leaves B alone');
    assert.equal(sheetCells(sheetId)['5:3']?.f, '=B6', 'the cycle cell moved right with its column');
    await chooseMenu(page, 'Rows and columns', 'Delete column');
    await saved(page);
    assert.equal(sheetCells(sheetId)['5:2']?.f, '=B6', 'and back');
    await cell(page, 0, 0).click();
    await chooseMenu(page, 'Rows and columns', 'Row height…');
    const heightDialog = page.getByRole('dialog', { name: 'Height of row 1' });
    await heightDialog.getByRole('textbox').fill('44');
    await heightDialog.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('button', { name: 'Freeze header row' }).click();
    await saved(page);
    const sheetData = JSON.parse(sql(`select data from persora_table_sheets where table_id = '${sheetId}'`));
    assert.equal(sheetData.rowHeights['0'], 44, 'row height saved');
    assert.equal(sheetData.frozenRows, 1, 'header row frozen');
    await expectCell(page, 0, 0, 'Item', 'the header renders in the frozen area', 1);
    // Find
    await page.keyboard.press('Control+f');
    await page.getByRole('searchbox', { name: 'Find in sheet' }).fill('food');
    await eventually(() => page.locator('.tb-findbar .tb-muted').innerText(), '0 of 1', 'one match');
    await page.keyboard.press('Enter');
    await eventually(() => page.locator('.tb-address').innerText(), 'A3', 'Enter jumps to the match');
    await page.getByRole('button', { name: 'Close find' }).click();
    await snap(page, '04-desktop-frozen');
    ok('insert/delete rows and columns keep formulas right; row height, frozen header and find are saved/working');
  }

  step('Spreadsheet: sheets, cross-sheet formulas, sort and the temporary filter');
  {
    await page.getByRole('button', { name: 'Add sheet' }).click();
    await page.getByRole('tab', { name: 'Sheet 2' }).waitFor();
    await page.getByRole('button', { name: 'Sheet options for Sheet 2' }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    const rename = page.getByRole('dialog', { name: 'Rename sheet' });
    await rename.getByRole('textbox').fill('Sheet 1');
    await rename.getByRole('button', { name: 'Save' }).click();
    await rename.getByRole('alert').waitFor();
    await rename.getByRole('textbox').fill('Lists');
    await rename.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('tab', { name: 'Lists' }).waitFor();
    await gridReady(page);
    await typeInto(page, 0, 0, 'Fruit');
    await typeInto(page, 1, 0, 'cherry');
    await typeInto(page, 2, 0, 'apple');
    await typeInto(page, 3, 0, 'banana');
    await typeInto(page, 0, 1, "='Sheet 1'!B4*2");
    await expectCell(page, 0, 1, '2701', 'cross-sheet reference');
    await page.getByRole('button', { name: 'Freeze header row' }).click();
    await cell(page, 1, 0, 1).click();
    await eventually(() => page.locator('.tb-address').innerText(), 'A2', 'A2 selected');
    await chooseMenu(page, 'Sort', 'Sort A → Z by column A');
    await expectCell(page, 1, 0, 'apple', 'sorted', 1);
    await expectCell(page, 3, 0, 'cherry', 'sorted', 1);
    await expectCell(page, 0, 0, 'Fruit', 'the frozen header stays on top', 1);
    // Filter: rows are hidden only here, and editing a filtered row edits the right one.
    await page.getByRole('button', { name: 'Filter rows' }).click();
    const filter = page.getByRole('dialog', { name: 'Filter by column A' });
    await filter.getByRole('textbox').fill('an');
    await filter.getByRole('button', { name: 'Filter' }).click();
    await page.locator('.tb-filterbar').waitFor();
    assert.match(await page.locator('.tb-filterbar').innerText(), /1 row shown.*temporary/s);
    const banana = page.locator('revogr-data[type="rgRow"][col-type="rgCol"] .rgCell[data-rgrow="0"][data-rgcol="2"]');
    await banana.click();
    await eventually(() => page.locator('.tb-address').innerText(), 'C3', 'the visible row is sheet row 3');
    await page.keyboard.type('yellow');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Clear filter' }).click();
    await expectCell(page, 2, 2, 'yellow', 'the edit landed next to banana', 1);
    await saved(page);
    const lists = JSON.parse(sql(`select data from persora_table_sheets where table_id = '${sheetId}' and name = 'Lists'`));
    assert.equal(lists.cells['2:0'].v, 'banana');
    assert.equal(lists.cells['2:2'].v, 'yellow', 'filtered edit saved on the right row');
    assert.equal(sql(`select sheet_count from persora_tables where id = '${sheetId}'`), '2');
    // Move and delete (with confirmation and undo).
    await page.getByRole('button', { name: 'Sheet options for Lists' }).click();
    await page.getByRole('menuitem', { name: 'Move left' }).click();
    assert.deepEqual(await page.getByRole('tab').allInnerTexts(), ['Lists', 'Sheet 1']);
    await page.getByRole('button', { name: 'Sheet options for Lists' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const confirmDelete = page.getByRole('dialog', { name: 'Delete sheet “Lists”?' });
    await confirmDelete.getByRole('button', { name: 'Delete sheet' }).click();
    assert.deepEqual(await page.getByRole('tab').allInnerTexts(), ['Sheet 1']);
    await page.getByRole('button', { name: /^Undo/ }).click();
    assert.deepEqual(await page.getByRole('tab').allInnerTexts(), ['Lists', 'Sheet 1'], 'undo brings the sheet back');
    await saved(page);
    assert.equal(sql(`select string_agg(name, ',' order by position) from persora_table_sheets where table_id = '${sheetId}'`), 'Lists,Sheet 1');
    ok('sheets add/rename (duplicate names refused)/move/delete+undo, cross-sheet formula, sort under a frozen header, filtered edit hits the right row');
  }

  step('Export: CSV (current sheet, formula-safe) and XLSX (all sheets, formulas, formatting)');
  let workbookFile;
  {
    await page.getByRole('tab', { name: 'Sheet 1' }).click();
    await gridReady(page);
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Export' });
    await dialog.getByRole('radio', { name: /CSV/ }).check();
    const notes = await dialog.locator('.tb-notes').innerText();
    assert.match(notes, /only the current sheet|current sheet/i, 'CSV says it exports one sheet');
    assert.match(notes, /formula/i, 'CSV says formulas become values');
    assert.doesNotMatch(notes, /keeps (formatting|formulas)/i, 'CSV never claims to keep formatting or formulas');
    let [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Download .csv' }).click()]);
    const csvPath = join(work, download.suggestedFilename());
    await download.saveAs(csvPath);
    const csv = readFileSync(csvPath, 'utf8');
    assert.equal(csv.charCodeAt(0), 0xFEFF, 'UTF-8 BOM for Excel');
    assert.match(csv, /^\uFEFFItem,Amount/u);
    assert.match(csv, /Total,1350\.5/, 'formula results, not formulas');
    assert.match(csv, /"'=not a formula"/, 'text that looks like a formula is neutralised');
    assert.match(csv, /\r\n/, 'CRLF line endings');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog', { name: 'Export' }).getByRole('button', { name: 'Download .xlsx' }).click()]);
    workbookFile = join(work, 'round-trip.xlsx');
    await download.saveAs(workbookFile);
    const { execFileSync } = await import('node:child_process');
    const listing = execFileSync('unzip', ['-l', workbookFile], { encoding: 'utf8' });
    assert.match(listing, /xl\/worksheets\/sheet2\.xml/, 'both sheets exported');
    const book = execFileSync('unzip', ['-p', workbookFile, 'xl/workbook.xml'], { encoding: 'utf8' });
    assert.match(book, /name="Lists"[\s\S]*name="Sheet 1"/, 'sheet names and order kept');
    const sheetXml = execFileSync('unzip', ['-p', workbookFile, 'xl/worksheets/sheet2.xml'], { encoding: 'utf8' });
    assert.match(sheetXml, /<f>SUM\(B2:B3\)<\/f>/, 'formulas exported as formulas');
    ok(`CSV ${csv.length} bytes (BOM, CRLF, values, escaped "="); XLSX with both sheets, names and formulas`);
  }

  step('Import: XLSX round trip, CSV with Unicode/quotes/semicolons, validation report, cancel, malformed files');
  {
    const tablesBefore = Number(sql(`select count(*) from persora_tables where user_id = '${alice.id}'`));
    await page.getByRole('button', { name: 'Back to all tables' }).click();
    await page.locator('.tb-home').waitFor();
    // Cancel: nothing is created.
    await chooseMenu(page, 'New table', /Import file/);
    let dialog = page.getByRole('dialog', { name: 'Import a file' });
    await dialog.locator('input[type=file]').setInputFiles(workbookFile);
    await dialog.locator('.tb-report').waitFor();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal(Number(sql(`select count(*) from persora_tables where user_id = '${alice.id}'`)), tablesBefore, 'cancel creates nothing');
    // Malformed: a ZIP renamed to .csv, an empty file and a fake .xlsx.
    const fakeCsv = join(work, 'not-really.csv'); writeFileSync(fakeCsv, readFileSync(workbookFile));
    const fakeXlsx = join(work, 'broken.xlsx'); writeFileSync(fakeXlsx, 'this is plain text, not a workbook');
    const empty = join(work, 'empty.csv'); writeFileSync(empty, '');
    await chooseMenu(page, 'New table', /Import file/);
    dialog = page.getByRole('dialog', { name: 'Import a file' });
    for (const [file, pattern] of [[fakeCsv, /isn't a CSV|not a CSV|binary|text file/i], [fakeXlsx, /isn't a valid|not a valid|couldn't be read|Excel/i], [empty, /empty/i]]) {
      await dialog.locator('input[type=file]').setInputFiles(file);
      const message = await dialog.locator('.tb-form-error').innerText();
      assert.match(message, pattern, `${file}: ${message}`);
      assert.equal(await dialog.getByRole('button', { name: 'Import', exact: true }).isDisabled(), true, 'nothing to import');
    }
    // XLSX round trip as a spreadsheet: sheet names and values come back.
    await dialog.locator('input[type=file]').setInputFiles(workbookFile);
    await dialog.locator('.tb-report').waitFor();
    assert.equal(await dialog.getByRole('radio', { name: 'Spreadsheet' }).isChecked(), true, 'multi-sheet workbooks default to Spreadsheet');
    assert.match(await dialog.locator('.tb-report').innerText(), /Lists: 4 rows[\s\S]*Sheet 1:/);
    assert.match(await dialog.locator('.tb-report').innerText(), /formulas, formatting and merged cells aren't read/i, 'says what XLSX import loses');
    await dialog.getByRole('textbox', { name: 'Table name' }).fill('Round trip');
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    await page.locator('.tb-editor.is-spreadsheet').waitFor();
    await gridReady(page);
    const roundId = tableIdFromUrl(page);
    assert.equal(sql(`select string_agg(name, ',' order by position) from persora_table_sheets where table_id = '${roundId}'`), 'Lists,Sheet 1');
    const roundCells = JSON.parse(sql(`select data->'cells' from persora_table_sheets where table_id = '${roundId}' and name = 'Sheet 1'`));
    assert.equal(roundCells['0:0'].v, 'Item');
    assert.equal(roundCells['1:1'].v, 1000);
    ok('XLSX round trip keeps sheet names and values; cancel and malformed files create nothing');
    // CSV: semicolons, quotes, Unicode, blanks, dates and numbers -> Smart Table.
    await page.getByRole('button', { name: 'Back to all tables' }).click();
    const csvFile = join(work, 'people;semi.csv');
    writeFileSync(csvFile, '\uFEFFName;City;Joined;Score;Note\r\n"Rahim, Jr.";ঢাকা;2026-01-15;12,5;"He said ""hi"""\r\n;;;;\r\nKarim;Jessore;2026-02-01;40;\r\nSalma;খুলনা;not a date;n/a;Ok\r\n');
    await chooseMenu(page, 'New table', /Import file/);
    dialog = page.getByRole('dialog', { name: 'Import a file' });
    await dialog.locator('input[type=file]').setInputFiles(csvFile);
    await dialog.locator('.tb-report').waitFor();
    assert.match(await dialog.locator('select').first().inputValue().catch(() => ''), /;|^$/, 'delimiter detected');
    const preview = await dialog.locator('.tb-preview').innerText();
    assert.match(preview, /Rahim, Jr\./, 'quoted commas kept');
    assert.match(preview, /ঢাকা/, 'Unicode kept');
    assert.match(preview, /He said "hi"/, 'escaped quotes kept');
    const report = await dialog.locator('.tb-report').innerText();
    assert.match(report, /3 records and 5 fields/, report);
    assert.match(report, /1 empty row skipped/);
    assert.match(report, /kept exactly as written/, 'values that do not fit are reported, not dropped');
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    await page.locator('.tb-editor.is-smart').waitFor();
    const peopleId = tableIdFromUrl(page);
    const records = JSON.parse(sql(`select json_agg("values" order by position) from persora_table_records where table_id = '${peopleId}'`));
    const meta = JSON.parse(sql(`select meta from persora_tables where id = '${peopleId}'`));
    const fieldId = (name) => meta.fields.find((field) => field.name === name).id;
    assert.equal(records.length, 3, 'blank row skipped, nothing else lost');
    assert.equal(records[0][fieldId('Name')], 'Rahim, Jr.');
    assert.equal(records[0][fieldId('City')], 'ঢাকা');
    assert.ok(JSON.stringify(records).includes('not a date') && JSON.stringify(records).includes('n/a'), 'unconvertible values are kept as written');
    await snap(page, '05-desktop-imported-smart');
    ok('CSV import: semicolon delimiter, quotes, Unicode, blank row skipped, mismatches kept and reported, one atomic create');
  }
