const { chromium } = await import('/opt/playwright/node_modules/playwright/index.mjs');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
await page.goto('file://' + new URL('./index.html', import.meta.url).pathname);
await page.waitForTimeout(1500);
console.log(await page.evaluate(() => { const d = document.querySelector('revogr-data'); return [d.outerHTML.slice(0, 1500), [...document.querySelectorAll('revogr-data')].map((x) => x.getAttribute('type') + ':' + x.className + ':' + x.querySelectorAll('[role=gridcell],.rgCell').length)]; }));
await browser.close();
