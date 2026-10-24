// TEMPORARY diagnostic — delete before commit.
import { startDatabase, startApp, APP_PORT, stopAll, psql } from './local-stack.mjs';
const { chromium } = await import('/opt/playwright/node_modules/playwright/index.mjs');
const base = `http://127.0.0.1:${APP_PORT}`;
await startDatabase();
await startApp();
const browser = await chromium.launch();
try {
  const email = `diag-${Date.now()}@persora.test`;
  const res = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fullName: 'Diag', email, password: 'Correct-Horse-9' }) });
  const cookie = res.headers.getSetCookie().map((v) => v.split(';')[0]).join('; ');
  const sheets = [{ id: crypto.randomUUID(), name: 'Sheet 1', position: 0, data: { rowCount: 50, colCount: 10, frozenRows: 0, colWidths: {}, rowHeights: {}, cells: {} } }];
  const created = await fetch(`${base}/api/tables`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: crypto.randomUUID(), kind: 'spreadsheet', name: 'Diag', sheets }) });
  const table = (await created.json()).table; console.log('created', created.status, table?.id);
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.addCookies(cookie.split('; ').map((pair) => { const [name, ...rest] = pair.split('='); return { name, value: rest.join('='), url: base }; }));
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('DIAG')) console.log('console:', m.text()); });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(`${base}/?view=tables&table=${table.id}`);
  await page.locator('revogr-data[type="rgRow"][col-type="rgCol"] .rgCell').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);
  const cell = (r, c) => page.locator(`revogr-data[type="rgRow"][col-type="rgCol"] .rgCell[data-rgrow="${r}"][data-rgcol="${c}"]`);
  const editVal = () => page.evaluate(() => { const i = document.querySelector('revogr-edit input, revogr-edit textarea'); return i ? `[${i.value}]` : '(no editor)'; });
  if (process.env.DIAG_DOM) {
    await cell(2, 1).click(); await page.waitForTimeout(300);
    console.log('DOM', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('revogr-overlay-selection')].map((o) => ({ attrs: [...o.attributes].map((a) => `${a.name}=${a.value}`).join(' '), props: { types: o.types, range: o.range, readonly: o.readonly }, parent: o.parentElement?.tagName + ' ' + [...(o.parentElement?.attributes || [])].map((a) => `${a.name}=${a.value}`).join(' ') })))));
    console.log('ACTIVE', await page.evaluate(() => document.activeElement?.tagName + '.' + document.activeElement?.className));
  }
  const words = process.env.DIAG_WORDS ? process.env.DIAG_WORDS.split(',') : ['Item', 'Amount', 'Rent', 'Total'];
  const delays = (process.env.DIAG_DELAYS || '0,0,0,0').split(',').map(Number);
  for (let i = 0; i < words.length; i += 1) {
    await cell(i, 0).click();
    await page.waitForTimeout(Number(process.env.DIAG_PAUSE || 0));
    const states = [];
    if (process.env.DIAG_FAST) { await page.keyboard.type(words[i]); await page.keyboard.press('Enter'); if (process.env.DIAG_AFTER) await page.waitForTimeout(Number(process.env.DIAG_AFTER)); continue; }
    for (const ch of words[i]) { await page.keyboard.press(ch); if (delays[i]) await page.waitForTimeout(delays[i]); states.push(await editVal()); }
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    console.log(`word=${words[i]} delay=${delays[i]} states=${states.join(' ')} cell=[${(await cell(i, 0).innerText()).trim()}] next-editor=${await editVal()}`);
  }
  if (process.env.DIAG_FAST) { await page.waitForTimeout(800); for (let i = 0; i < words.length; i += 1) console.log(`fast word=${words[i]} cell=[${(await cell(i, 0).innerText()).trim()}]`); }
} finally { await browser.close(); stopAll(); }
process.exit(0);
