// Browser end-to-end check of the app launcher on the production build, against
// real Postgres 17 + PostgREST + the Pages API worker. Not part of `npm test`.
//
//   npm run build
//   PG_BIN=/usr/lib/postgresql/17/bin POSTGREST_BIN=/path/to/postgrest \
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs npm run test:e2e:app-launcher
//
// Covers: placement beside the avatar, open/close (toggle, Escape, outside
// click, clicks inside never dismiss), every module opening its existing view
// in the same tab, keyboard navigation, editing favorites (add, remove, keyboard
// and drag reorder, restore defaults), persistence across reloads and devices
// via the account, no duplicates, lazy loading (no request on page load),
// desktop / tablet / phone layouts and the dark theme.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDatabase, startApp, APP_PORT, stopAll, psql } from './local-stack.mjs';
import { DEFAULT_LAUNCHER_FAVORITES, LAUNCHER_MODULE_IDS } from '../../cloudflare/workspace-modules.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/opt/playwright/node_modules/playwright/index.mjs');
const shots = process.env.E2E_SCREENSHOTS || join(tmpdir(), 'persora-app-launcher-shots');
mkdirSync(shots, { recursive: true });
const base = `http://127.0.0.1:${APP_PORT}`;
const step = (message) => console.log(`\n▶ ${message}`);
const ok = (message) => console.log(`  ✓ ${message}`);
async function snap(page, name) { await page.waitForTimeout(320); await page.screenshot({ path: join(shots, `${name}.png`) }); }
const sql = (query) => psql(query).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually(read, expected, message, timeout = 8000) {
  const started = Date.now(); let last;
  while (Date.now() - started < timeout) {
    last = await read();
    if (typeof expected === 'function' ? expected(last) : JSON.stringify(last) === JSON.stringify(expected)) return last;
    await sleep(120);
  }
  assert.fail(`${message}: got ${JSON.stringify(last)}${typeof expected === 'function' ? '' : `, expected ${JSON.stringify(expected)}`}`);
}

// Module labels exactly as the sidebar shows them.
const LABELS = {
  dashboard: 'Overview', calendar: 'Calendar', timeline: 'Life Timeline', 'medical-records': 'Medical Records', contacts: 'Contacts',
  shared: 'Shared documents', 'personal-finance': 'Personal Finance', documents: 'Documents', academics: 'Academics', family: 'Family',
  'photo-studio': 'Photo Studio', subscriptions: 'Subscriptions', purchases: 'Purchases & warranty', accounts: 'Accounts',
  memberships: 'Membership wallet', 'wallet-cards': 'Wallet Cards', 'password-manager': 'Password Manager', projects: 'Projects',
  'pdf-studio': 'PDF Studio', study: 'Study materials', notes: 'Tasks & Notes', 'business-card': 'Digital business card', urls: 'URL manager',
};
assert.deepEqual(Object.keys(LABELS).sort(), [...LAUNCHER_MODULE_IDS].sort());
const labels = (ids) => ids.map((id) => LABELS[id]);

await startDatabase();
await startApp();
const browser = await chromium.launch();
const consoleErrors = [];
const preferenceRequests = [];
function watch(page, label) {
  page.on('console', (message) => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) consoleErrors.push(`${label}: ${message.text()}`); });
  page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/workspace/preferences') preferenceRequests.push(`${label} ${request.method()}`); });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    const path = new URL(response.url()).pathname;
    if (response.status() === 401 && path === '/api/auth/me') return;
    consoleErrors.push(`${label}: HTTP ${response.status()} ${response.request().method()} ${path}`);
  });
  page.on('pageerror', (error) => consoleErrors.push(`${label}: ${error.message}`));
}

async function register(name) {
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}@persora.test`;
  const response = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fullName: name, email, password: 'Correct-Horse-9' }) });
  assert.equal(response.status, 201, await response.clone().text());
  return { email, id: sql(`select id from profiles where email = '${email}'`) };
}
const workspaceReady = (page) => page.locator('nav[aria-label="Workspace navigation"]').waitFor({ state: 'attached' });
async function signIn(context, email, label) {
  const page = await context.newPage();
  watch(page, label);
  await page.goto(base);
  await page.getByRole('button', { name: 'Sign in' }).first().click();
  await page.getByRole('textbox', { name: 'Email or 7-digit Persora ID' }).fill(email);
  await page.getByPlaceholder('Your password').fill('Correct-Horse-9');
  await page.getByRole('dialog').getByRole('button', { name: 'Sign in', exact: true }).click();
  await workspaceReady(page);
  return page;
}

const launcher = (page) => page.getByRole('button', { name: 'Persora apps', exact: true });
const drawer = (page) => page.getByRole('dialog', { name: /^(Your favorites|Edit favorites)$/ });
async function openDrawer(page) {
  if (!(await drawer(page).count())) await launcher(page).click();
  await drawer(page).waitFor();
  await page.waitForTimeout(200); // open animation
}
async function closedDrawer(page) { await drawer(page).waitFor({ state: 'detached' }); }
const tileLabels = (page, section) => page.locator(`.app-launcher-panel ${section} .app-launcher-tile .app-launcher-label`).allInnerTexts();
const favoriteLabels = (page) => tileLabels(page, '.app-launcher-favorites');
const moreLabels = (page) => tileLabels(page, '.app-launcher-more');
const activeView = (page) => page.locator('nav[aria-label="Workspace navigation"] .sidebar-link[aria-current="page"] > span').first().innerText();
const savedFavorites = (userId) => sql(`select coalesce(launcher_favorites::text, 'null') from workspace_preferences where user_id = '${userId}'`);
async function waitSynced(page) { await page.locator('.app-launcher-sync.is-saved').waitFor(); }

try {
  const owner = await register('Launcher Owner');
  const desktop = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  let page = await signIn(desktop, owner.email, 'desktop');

  step('Placement, lazy loading and default favorites');
  {
    const button = launcher(page);
    await button.waitFor();
    const placement = await button.evaluate((element) => ({
      next: element.nextElementSibling?.className || '',
      prev: element.previousElementSibling?.className || '',
      parent: element.parentElement?.className || '',
    }));
    assert.match(placement.next, /topbar-avatar/, 'launcher sits immediately before the avatar');
    assert.match(placement.prev, /notification-wrap/, 'after the notifications button');
    assert.match(placement.parent, /topbar-actions/);
    const [b, a] = [await button.boundingBox(), await page.locator('.topbar-avatar').boundingBox()];
    assert.ok(Math.abs((b.y + b.height / 2) - (a.y + a.height / 2)) <= 2, 'vertically aligned with the avatar');
    assert.ok(a.x - (b.x + b.width) <= 16 && a.x > b.x, 'directly beside the avatar');
    assert.equal(await button.getAttribute('aria-expanded'), 'false');
    assert.equal(await button.getAttribute('aria-haspopup'), 'dialog');
    ok(`button ${Math.round(b.width)}×${Math.round(b.height)} beside the avatar, aligned`);
    await page.mouse.move(5, 500);
    await page.waitForTimeout(400);
    assert.deepEqual(preferenceRequests, [], 'no preferences request on page load');
    ok('no preferences request on page load');

    await button.click();
    await drawer(page).waitFor();
    assert.equal(await button.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('.app-launcher-panel h2').innerText(), 'Your favorites');
    await eventually(() => preferenceRequests.length, (n) => n >= 1, 'favorites fetched on intent');
    const favorites = await favoriteLabels(page);
    const more = await moreLabels(page);
    assert.deepEqual(favorites, labels(DEFAULT_LAUNCHER_FAVORITES), 'default favorites');
    assert.equal(new Set([...favorites, ...more]).size, favorites.length + more.length, 'no module listed twice');
    assert.deepEqual([...favorites, ...more].sort(), Object.values(LABELS).sort(), 'every module listed');
    assert.equal(await page.locator('.app-launcher-module-icon, .launcher-module-icon').count(), LAUNCHER_MODULE_IDS.length, 'one SVG icon per module');
    assert.equal(await page.locator('.app-launcher-panel img').count(), 0, 'no raster icons');
    // Anchored beneath the button, right-aligned with the top-bar actions, inside the viewport.
    const panel = await page.locator('.app-launcher-panel').boundingBox();
    const actions = await page.locator('.workspace-topbar .topbar-actions').boundingBox();
    assert.ok(panel.y >= b.y + b.height && panel.y - (b.y + b.height) <= 16, 'drawer opens just beneath the button');
    assert.ok(Math.abs(panel.x + panel.width - (actions.x + actions.width)) <= 2, 'right-aligned with the top bar');
    assert.ok(panel.y + panel.height <= 860, 'fits the viewport');
    const columns = new Set(await page.locator('.app-launcher-favorites .app-launcher-tile').evaluateAll((tiles) => tiles.map((tile) => Math.round(tile.getBoundingClientRect().left))));
    assert.equal(columns.size, 3, 'three-column favorites grid');
    const radius = await page.locator('.app-launcher-panel').evaluate((element) => parseFloat(getComputedStyle(element).borderTopLeftRadius));
    assert.ok(radius >= 24 && radius <= 30, `radius ${radius}px`);
    // The rest of the modules scroll in their own area.
    const scroller = await page.locator('.app-launcher-more-grid').evaluate((element) => ({ scrollable: element.scrollHeight > element.clientHeight, overflow: getComputedStyle(element).overflowY }));
    assert.equal(scroller.overflow, 'auto');
    ok(`9 default favorites + ${more.length} more, ${radius}px radius, 3 columns, more area scrolls (${scroller.scrollable ? 'overflowing' : 'fits'})`);
    await snap(page, '01-desktop-open');
    await page.locator('.app-launcher-tile', { hasText: 'Calendar' }).first().hover();
    await snap(page, '02-desktop-hover');
    // No layout shift: the page beneath did not move.
    const mainBefore = await page.locator('.workspace-content').boundingBox();
    assert.ok(mainBefore, 'content present');
  }

  step('Open / close behaviour');
  {
    const button = launcher(page);
    const contentBox = await page.locator('.workspace-content').boundingBox();
    await button.click();
    await closedDrawer(page);
    assert.equal(await button.getAttribute('aria-expanded'), 'false');
    ok('clicking the launcher again closes it');
    const after = await page.locator('.workspace-content').boundingBox();
    assert.deepEqual(after, contentBox, 'no layout shift');

    await openDrawer(page);
    await page.keyboard.press('Escape');
    await closedDrawer(page);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Persora apps', 'focus returns to the launcher');
    ok('Escape closes and returns focus');

    await openDrawer(page);
    await page.locator('.app-launcher-panel h2').click();
    await page.locator('.app-launcher-more h3').click();
    const panel = await page.locator('.app-launcher-panel').boundingBox();
    await page.mouse.click(panel.x + panel.width / 2, panel.y + panel.height - 3); // empty padding inside the drawer (not the rounded corner)
    await page.locator('.app-launcher-more-grid').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await page.waitForTimeout(150);
    assert.equal(await drawer(page).count(), 1, 'clicks and scrolling inside the drawer keep it open');
    ok('clicks inside the drawer never dismiss it');

    await page.locator('.breadcrumb-title h1').click(); // a neutral spot on the page
    await closedDrawer(page);
    ok('outside click closes it');

    await openDrawer(page);
    await page.getByRole('button', { name: /^Notifications/ }).click();
    await closedDrawer(page);
    await page.locator('.notification-popover').waitFor();
    await launcher(page).click();
    await drawer(page).waitFor();
    assert.equal(await page.locator('.notification-popover').count(), 0, 'opening the launcher closes notifications');
    await page.keyboard.press('Escape');
    await closedDrawer(page);
    ok('launcher and notifications never overlap');
  }

  step('Every module opens its existing view in the same tab');
  {
    for (const id of LAUNCHER_MODULE_IDS) {
      await openDrawer(page);
      await drawer(page).getByRole('button', { name: LABELS[id], exact: true }).click();
      await closedDrawer(page);
      await eventually(() => activeView(page), LABELS[id], `${id} opened`);
    }
    assert.equal(desktop.pages().length, 1, 'no new tabs');
    ok(`${LAUNCHER_MODULE_IDS.length} modules navigate; drawer closes after each; no new tabs`);
    await openDrawer(page);
    const current = drawer(page).locator('[aria-current="page"]');
    assert.equal(await current.count(), 1);
    assert.equal(await current.locator('.app-launcher-label').innerText(), LABELS.urls, 'the open module is marked current');
    await page.keyboard.press('Escape');
    await closedDrawer(page);
    ok('current module is highlighted');
  }

  step('Keyboard navigation');
  {
    await launcher(page).focus();
    await page.keyboard.press('Enter');
    await drawer(page).waitFor();
    await eventually(() => page.evaluate(() => document.activeElement?.querySelector('.app-launcher-label')?.textContent), LABELS[DEFAULT_LAUNCHER_FAVORITES[0]], 'first module focused');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    const focused = await page.evaluate(() => document.activeElement?.querySelector('.app-launcher-label')?.textContent);
    assert.equal(focused, LABELS[DEFAULT_LAUNCHER_FAVORITES[4]], 'arrow keys move through the grid');
    await snap(page, '03-keyboard-focus');
    await page.keyboard.press('Enter');
    await closedDrawer(page);
    await eventually(() => activeView(page), LABELS[DEFAULT_LAUNCHER_FAVORITES[4]], 'Enter opens the focused module');
    ok('focus lands on the first module; arrows move; Enter opens');
  }

  let expected;
  step('Edit favorites: remove, add, keyboard and drag reorder');
  {
    await openDrawer(page);
    await drawer(page).getByRole('button', { name: 'Edit favorites', exact: true }).click();
    await page.locator('.app-launcher-panel h2', { hasText: 'Edit favorites' }).waitFor();
    await snap(page, '04-edit-mode');
    await drawer(page).getByRole('button', { name: 'Remove Contacts from favorites', exact: true }).click();
    await drawer(page).getByRole('button', { name: 'Add URL manager to favorites', exact: true }).click();
    await drawer(page).getByRole('button', { name: 'Add Life Timeline to favorites', exact: true }).click();
    expected = DEFAULT_LAUNCHER_FAVORITES.filter((id) => id !== 'contacts').concat(['urls', 'timeline']);
    assert.deepEqual(await favoriteLabels(page), labels(expected));
    assert.ok((await moreLabels(page)).includes('Contacts') && !(await moreLabels(page)).includes('URL manager'), 'moved between sections, never duplicated');
    ok('removed Contacts, added URL manager and Life Timeline');

    // Keyboard reorder: PDF Studio one step earlier.
    await drawer(page).getByRole('button', { name: /^PDF Studio, favorite/ }).focus();
    await page.keyboard.press('ArrowLeft');
    const from = expected.indexOf('pdf-studio');
    expected.splice(from, 1); expected.splice(from - 1, 0, 'pdf-studio');
    assert.deepEqual(await favoriteLabels(page), labels(expected));
    assert.match(await page.locator('.app-launcher-live').innerText(), /PDF Studio moved to position \d+ of 10/);
    ok('arrow keys reorder (announced to screen readers)');

    // Drag reorder: URL manager to the first position.
    const source = await drawer(page).getByRole('button', { name: /^URL manager, favorite/ }).boundingBox();
    const target = await drawer(page).locator('[data-favorite-tile]').first().boundingBox();
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(source.x + source.width / 2 - 10, source.y + source.height / 2 - 10, { steps: 3 });
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
    await snap(page, '05-dragging');
    await page.mouse.up();
    expected = ['urls', ...expected.filter((id) => id !== 'urls')];
    assert.deepEqual(await favoriteLabels(page), labels(expected));
    ok('drag and drop reorders');

    await waitSynced(page);
    await eventually(() => savedFavorites(owner.id), JSON.stringify(expected).replace(/,/g, ', '), 'saved to the account');
    ok(`saved to workspace_preferences: ${expected.join(', ')}`);
    await snap(page, '06-edited');
    await drawer(page).getByRole('button', { name: 'Done', exact: true }).click();
    assert.equal(await page.locator('.app-launcher-panel h2').innerText(), 'Your favorites');
    assert.deepEqual(await favoriteLabels(page), labels(expected));
    await page.keyboard.press('Escape');
    await closedDrawer(page);
  }

  step('Favorites persist after refresh and on another device');
  {
    await page.evaluate(() => localStorage.clear()); // prove the account copy, not this device's cache
    await page.reload();
    await workspaceReady(page);
    await openDrawer(page);
    await eventually(() => favoriteLabels(page), labels(expected), 'favorites after refresh');
    ok('same favorites after a refresh with an empty device cache');
    await page.keyboard.press('Escape');

    const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const phone = await signIn(phoneContext, owner.email, 'phone');
    await openDrawer(phone);
    await eventually(() => favoriteLabels(phone), labels(expected), 'favorites on a second device');
    ok('same favorites on a second device');

    step('Phone layout');
    const button = await launcher(phone).boundingBox();
    const avatar = await phone.locator('.topbar-avatar').boundingBox();
    assert.ok(Math.abs((button.y + button.height / 2) - (avatar.y + avatar.height / 2)) <= 2 && avatar.x > button.x && avatar.x - (button.x + button.width) <= 12, 'launcher stays beside the avatar');
    const panel = await phone.locator('.app-launcher-panel').boundingBox();
    assert.ok(panel.x >= 7 && panel.x + panel.width <= 390 - 7, `drawer inside the viewport (${Math.round(panel.x)}…${Math.round(panel.x + panel.width)})`);
    assert.ok(panel.y + panel.height <= 844, 'drawer fits vertically');
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `no horizontal overflow (${overflow}px)`);
    const columns = new Set(await phone.locator('.app-launcher-favorites .app-launcher-tile').evaluateAll((tiles) => tiles.map((tile) => Math.round(tile.getBoundingClientRect().left))));
    assert.equal(columns.size, 3);
    const labelsFit = await phone.locator('.app-launcher-label').evaluateAll((items) => items.every((item) => item.scrollWidth <= item.clientWidth + 1));
    assert.ok(labelsFit, 'labels never overflow their tiles');
    ok(`phone: drawer ${Math.round(panel.width)}px wide at x=${Math.round(panel.x)}, 3 columns, no horizontal scroll`);
    await snap(phone, '07-phone-open');
    await phone.locator('.app-launcher-more-grid').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await snap(phone, '08-phone-more-scrolled');
    await phone.locator('.app-launcher-more').getByRole('button', { name: 'Contacts', exact: true }).tap();
    await closedDrawer(phone);
    await eventually(() => activeView(phone), 'Contacts', 'tap opens a module on the phone');
    ok('tapping a module navigates on the phone');

    // Narrowest supported width.
    await phone.setViewportSize({ width: 320, height: 640 });
    await phone.waitForTimeout(200);
    await openDrawer(phone);
    const narrow = await phone.locator('.app-launcher-panel').boundingBox();
    assert.ok(narrow.x >= 7 && narrow.x + narrow.width <= 313, '320px: inside the viewport');
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '320px: no horizontal overflow');
    assert.ok(await launcher(phone).isVisible() && await phone.locator('.topbar-avatar').isVisible(), '320px: launcher and avatar visible');
    await snap(phone, '09-phone-320');
    ok('320px wide: fits, no overflow');
    await phoneContext.close();
  }

  step('Tablet layout');
  {
    const tabletContext = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true });
    const tablet = await signIn(tabletContext, owner.email, 'tablet');
    await openDrawer(tablet);
    const panel = await tablet.locator('.app-launcher-panel').boundingBox();
    const button = await launcher(tablet).boundingBox();
    assert.ok(panel.x >= 8 && panel.x + panel.width <= 812, 'inside the viewport');
    assert.ok(panel.y >= button.y + button.height, 'beneath the launcher');
    const columns = new Set(await tablet.locator('.app-launcher-more .app-launcher-tile').evaluateAll((tiles) => tiles.map((tile) => Math.round(tile.getBoundingClientRect().left))));
    assert.equal(columns.size, 3, 'three columns on tablet');
    await snap(tablet, '10-tablet-open');
    ok(`tablet: ${Math.round(panel.width)}px floating drawer, 3 columns, no clipping`);
    await tabletContext.close();
  }

  step('Restore defaults');
  {
    await openDrawer(page);
    await drawer(page).getByRole('button', { name: 'Edit favorites', exact: true }).click();
    // Fill to the 12-module cap: the tallest editing state must still fit, with the footer reachable.
    while ((await favoriteLabels(page)).length < 12) await drawer(page).locator('.app-launcher-tile.is-addable').first().click();
    await waitSynced(page);
    const disabled = await drawer(page).locator('.app-launcher-tile.is-addable').evaluateAll((tiles) => tiles.every((tile) => tile.getAttribute('aria-disabled') === 'true'));
    assert.ok(disabled, 'adding is disabled when favorites are full');
    const panel = await page.locator('.app-launcher-panel').boundingBox();
    assert.ok(panel.y + panel.height <= 860, 'full favorites still fit the viewport');
    await snap(page, '12-edit-full');
    ok('12 favorites (the cap): further adds disabled, drawer fits, footer reachable');
    await drawer(page).getByRole('button', { name: 'Restore defaults', exact: true }).click();
    assert.deepEqual(await favoriteLabels(page), labels(DEFAULT_LAUNCHER_FAVORITES));
    await waitSynced(page);
    await eventually(() => savedFavorites(owner.id), 'null', 'defaults saved as null');
    assert.equal(await drawer(page).getByRole('button', { name: 'Restore defaults', exact: true }).count(), 0);
    ok('defaults restored (stored as "not customized")');
    await page.keyboard.press('Escape');
    await closedDrawer(page);
  }

  step('Dark theme');
  {
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await openDrawer(page);
    const colors = await page.locator('.app-launcher-panel').evaluate((element) => ({ background: getComputedStyle(element).backgroundColor, gap: getComputedStyle(element).getPropertyValue('--li-gap').trim() }));
    assert.equal(colors.background, 'rgb(41, 42, 45)');
    assert.equal(colors.gap, '#292a2d', 'icon cut-outs follow the dark surface');
    await snap(page, '11-dark');
    ok('dark surface and icon cut-outs');
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  }

  step('Account backup');
  {
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: owner.email, password: 'Correct-Horse-9' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    const res = await fetch(`${base}/api/account/export`, { headers: { cookie } });
    assert.equal(res.status, 200);
    const tar = new Uint8Array(await res.arrayBuffer());
    const size = parseInt(new TextDecoder().decode(tar.subarray(124, 135)), 8);
    const manifest = JSON.parse(new TextDecoder().decode(tar.subarray(512, 512 + size)));
    assert.ok('workspacePreferences' in manifest.data, 'backup includes workspacePreferences');
    ok('backup includes workspacePreferences');
  }

  assert.deepEqual(consoleErrors, [], 'no console errors or failed requests');
  ok('no console errors or failed requests');
  console.log(`\nALL APP LAUNCHER E2E CHECKS PASSED — screenshots in ${shots}`);
  await desktop.close();
} finally {
  await browser.close();
  await stopAll();
}
process.exit(0);
