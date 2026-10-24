const { chromium } = await import('/opt/playwright/node_modules/playwright/index.mjs');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('file://' + new URL('./index.html', import.meta.url).pathname);
await page.waitForTimeout(1500);
const cells = page.locator('revogr-data .rgCell');
console.log('cells', await cells.count());
await page.screenshot({ path: '/home/user/spike-1.png' });
// click B3 (main row 1 → sheet row 2)
const cell = page.locator('revogr-data[type="rgRow"][col-type="rgCol"] .rgCell[data-rgrow="1"][data-rgcol="1"]');
await cell.click();
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
console.log('editor value', await page.locator('revogr-edit input').inputValue().catch((e) => 'none ' + e.message));
await page.keyboard.press('Control+a');
await page.keyboard.type('=B2*3');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
// type directly into a cell
await page.keyboard.press('ArrowDown');
await page.keyboard.type('77');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
// shift-select range
await page.keyboard.press('ArrowUp'); await page.keyboard.press('Shift+ArrowDown'); await page.keyboard.press('Shift+ArrowRight');
await page.waitForTimeout(200);
console.log('range', JSON.stringify(await page.evaluate(() => document.querySelector('revo-grid').getSelectedRange())));
await page.keyboard.press('Delete');
await page.waitForTimeout(200);
console.log(await page.evaluate(() => window.__log));
await page.screenshot({ path: '/home/user/spike-2.png' });
console.log('attribution', await page.locator('revogr-attribution').count(), await page.locator('revogr-attribution').evaluate((el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height, getComputedStyle(el).position]; }).catch(() => 'n/a'));
await browser.close();
