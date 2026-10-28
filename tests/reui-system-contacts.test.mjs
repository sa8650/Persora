// Regression suite for the Whole-System ReUI Component Rollout, upload progress,
// Contacts after-upload feedback modal sizing fix, Contacts custom select & bulk delete,
// and repository documentation accuracy.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { GlobalWindow } from 'happy-dom';
const happyWindow = new GlobalWindow({ url: 'http://localhost:5173/' });
for (const key of Object.getOwnPropertyNames(happyWindow)) {
  if (!(key in globalThis)) globalThis[key] = happyWindow[key];
}
globalThis.window = happyWindow;
globalThis.document = happyWindow.document;
globalThis.localStorage = happyWindow.localStorage;
globalThis.navigator = happyWindow.navigator;
globalThis.HTMLElement = happyWindow.HTMLElement;
globalThis.Element = happyWindow.Element;
globalThis.Node = happyWindow.Node;
globalThis.SVGElement = happyWindow.SVGElement;
globalThis.MutationObserver = happyWindow.MutationObserver;
globalThis.Event = happyWindow.Event;
globalThis.CustomEvent = happyWindow.CustomEvent;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

globalThis.fetch = async (url) => {
  const target = String(url);
  if (target.includes('/api/folders')) {
    return new Response(JSON.stringify({ folders: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (target.includes('/api/upload')) {
    return new Response(
      JSON.stringify({ key: 'user-1/photo-key.jpg', name: 'photo.jpg', size: 1024, type: 'image/jpeg' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

const esbuild = await import('esbuild');
const outDir = mkdtempSync(path.join(process.cwd(), 'node_modules', '.reui-suite-'));
after(() => rmSync(outDir, { recursive: true, force: true }));

async function bundleEntry(relPath, outName) {
  const outfile = path.join(outDir, outName);
  await esbuild.build({
    entryPoints: [new URL(`../${relPath}`, import.meta.url).pathname],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    loader: { '.css': 'empty' },
    external: ['react', 'react-dom', 'lucide-react'],
    jsx: 'automatic',
    define: {
      'import.meta.env.PROD': 'true',
      'import.meta.env.VITE_USE_PAGES_FUNCTIONS': '"true"',
    },
    logLevel: 'silent',
  });
  return import(outfile);
}

const React = await import('react');
const { act } = await import('react-dom/test-utils');
const { createRoot } = await import('react-dom/client');

const [
  contactsMod,
  progressIndMod,
  cloudMod,
  badgeMod,
  fileTypeMod,
  iconTileMod,
  attachmentPatternMod,
  checkboxMod,
  progressMod,
  spinnerMod,
] = await Promise.all([
  bundleEntry('src/components/ContactsView.tsx', 'ContactsView.mjs'),
  bundleEntry('src/components/ProgressIndicator.tsx', 'ProgressIndicator.mjs'),
  bundleEntry('src/lib/cloud.ts', 'cloud.mjs'),
  bundleEntry('src/components/reui/badge.tsx', 'badge.mjs'),
  bundleEntry('src/components/reui/file-type.tsx', 'file-type.mjs'),
  bundleEntry('src/components/reui/icon-tile.tsx', 'icon-tile.mjs'),
  bundleEntry('src/components/reui/c-attachment-6.tsx', 'c-attachment-6.mjs'),
  bundleEntry('src/components/ui/checkbox.tsx', 'checkbox.mjs'),
  bundleEntry('src/components/ui/progress.tsx', 'progress.mjs'),
  bundleEntry('src/components/ui/spinner.tsx', 'spinner.mjs'),
]);

const ContactsView = contactsMod.default;
const { TransferProgressIndicator, ImportProgressIndicator, StageProgressIndicator } = progressIndMod;
const { uploadMultipart } = cloudMod;
const { Badge } = badgeMod;
const { FileType, getFileType, getFileTypeCategory } = fileTypeMod;
const { IconTile } = iconTileMod;
const { ReuiFileAttachmentField } = attachmentPatternMod;
const { Checkbox } = checkboxMod;
const { Progress } = progressMod;
const { Spinner } = spinnerMod;

function mount(element) {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(element);
  });
  return {
    host,
    unmount() {
      act(() => root.unmount());
      document.body.innerHTML = '';
    },
  };
}

const SAMPLE_CONTACTS = [
  {
    id: 'c-1',
    name: 'Ayesha Siddiqua',
    phoneNumbers: [{ label: 'Mobile', number: '+8801711000001' }],
    email: 'ayesha@example.com',
    company: 'Persora Studio',
    jobTitle: 'Architect',
    address: 'Jessore, BD',
    birthday: '1994-05-12',
    notes: '',
    category: 'Work',
    favorite: true,
    createdAt: '2026-10-20T08:00:00.000Z',
    updatedAt: '2026-10-20T08:00:00.000Z',
  },
  {
    id: 'c-2',
    name: 'Tanvir Hasan',
    phoneNumbers: [{ label: 'Mobile', number: '+8801711000002' }],
    email: 'tanvir@example.com',
    company: 'Dexter Labs',
    jobTitle: 'Engineer',
    address: 'Khulna, BD',
    birthday: '',
    notes: '',
    category: 'Friends',
    favorite: false,
    createdAt: '2026-10-21T08:00:00.000Z',
    updatedAt: '2026-10-21T08:00:00.000Z',
  },
  {
    id: 'c-3',
    name: 'Nusrat Jahan',
    phoneNumbers: [{ label: 'Home', number: '+8801711000003' }],
    email: 'nusrat@example.com',
    company: '',
    jobTitle: '',
    address: 'Dhaka, BD',
    birthday: '',
    notes: '',
    category: 'Family',
    favorite: false,
    createdAt: '2026-10-22T08:00:00.000Z',
    updatedAt: '2026-10-22T08:00:00.000Z',
  },
];

test('ReUI primitives render semantic slots, ARIA attributes, and file type resolution', () => {
  assert.equal(getFileType('passport-scan.pdf'), 'pdf');
  assert.equal(getFileType('spreadsheet.xlsx'), 'xlsx');
  assert.equal(getFileTypeCategory(getFileType('photo.webp')), 'image');

  const picked = [];
  const { host, unmount } = mount(
    React.createElement(
      'div',
      null,
      React.createElement(Progress, { value: 64, 'aria-label': 'File upload progress' }),
      React.createElement(Spinner, { className: 'size-4' }),
      React.createElement(Badge, { variant: 'success-light', size: 'sm', radius: 'full' }, 'Verified'),
      React.createElement(IconTile, { variant: 'soft', size: 'default' }, '★'),
      React.createElement(FileType, { type: getFileType('invoice.pdf'), variant: 'light', size: 'sm' }),
      React.createElement(Checkbox, { checked: 'indeterminate', 'aria-label': 'Bulk select header' }),
      React.createElement(ReuiFileAttachmentField, {
        file: new File(['hello'], 'report.pdf', { type: 'application/pdf' }),
        onFileSelect: (f) => picked.push(f),
        title: 'Attach PDF',
        description: 'Up to 10 MB',
        inputAriaLabel: 'Document attachment',
      })
    )
  );

  const bar = host.querySelector('[data-slot="progress"][role="progressbar"]');
  assert.ok(bar, 'Progress renders data-slot="progress" and role="progressbar"');
  assert.equal(bar.getAttribute('aria-valuenow'), '64');

  const spinner = host.querySelector('[role="status"][aria-label="Loading"]');
  assert.ok(spinner, 'Spinner renders accessible status indicator');

  assert.ok(host.querySelector('[data-slot="badge"]'), 'Badge renders data-slot="badge"');
  assert.ok(host.querySelector('[data-slot="icon-tile"]'), 'IconTile renders data-slot="icon-tile"');
  assert.ok(host.querySelector('[data-slot="file-type"]'), 'FileType renders data-slot="file-type"');

  const checkbox = host.querySelector('[data-slot="checkbox"]');
  assert.ok(checkbox, 'Checkbox renders data-slot="checkbox"');
  assert.equal(checkbox.getAttribute('data-state'), 'indeterminate');

  assert.ok(host.textContent.includes('report.pdf'), 'ReuiFileAttachmentField displays selected file');
  const removeBtn = Array.from(host.querySelectorAll('button')).find((b) =>
    (b.getAttribute('aria-label') || '').toLowerCase().includes('remove')
  );
  assert.ok(removeBtn, 'Attachment row exposes remove button');
  assert.equal(removeBtn.getAttribute('type'), 'button', 'AttachmentAction inside forms uses type="button"');
  act(() => removeBtn.click());
  assert.deepEqual(picked, [null]);

  unmount();
});

test('Upload & import progress indicators use ReUI Progress and uploadMultipart streams onProgress', async () => {
  const events = [];
  const form = new FormData();
  form.set('file', new File(['abc123'], 'photo.jpg', { type: 'image/jpeg' }));
  const uploaded = await uploadMultipart('/upload', form, (p) => events.push(p));
  assert.equal(uploaded.key, 'user-1/photo-key.jpg');
  assert.ok(events.length >= 2, 'uploadMultipart emits start and completion progress events');
  assert.equal(events.at(-1).percent, 100);

  const { host, unmount } = mount(
    React.createElement(
      'div',
      null,
      React.createElement(TransferProgressIndicator, {
        label: 'Uploading contact photo…',
        progress: { loaded: 512000, total: 1024000, percent: 50, remainingSeconds: 3 },
      }),
      React.createElement(ImportProgressIndicator, {
        progress: { completed: 4, total: 8, percent: 50, remainingSeconds: 2, currentName: 'Ayesha Siddiqua' },
      }),
      React.createElement(StageProgressIndicator, {
        label: 'Removing background…',
        percent: 75,
      })
    )
  );

  const bars = host.querySelectorAll('[data-slot="progress"][role="progressbar"]');
  assert.equal(bars.length, 3, 'All three progress indicators render ReUI Progress');
  assert.equal(bars[0].getAttribute('aria-valuenow'), '50');
  assert.equal(bars[1].getAttribute('aria-valuenow'), '50');
  assert.equal(bars[2].getAttribute('aria-valuenow'), '75');
  assert.ok(host.textContent.includes('Saving Ayesha Siddiqua · contact 5 of 8'));

  unmount();
});

test('Contacts custom multi-select, indeterminate Select All, and confirmed bulk delete', async () => {
  let deletedBatch = null;
  const notifications = [];

  const { host, unmount } = mount(
    React.createElement(ContactsView, {
      userId: 'user-1',
      contacts: SAMPLE_CONTACTS,
      demoMode: false,
      connected: true,
      canUpload: true,
      onRefresh: async () => {},
      onSave: async (draft) => ({ ...SAMPLE_CONTACTS[0], ...draft }),
      onDelete: async () => {},
      onDeleteMany: async (items) => {
        deletedBatch = items.map((c) => c.id);
      },
      onShare: async () => {},
      onMerge: async () => {},
      onImport: async () => [],
      notify: (msg, kind) => notifications.push({ msg, kind }),
    })
  );

  const selectBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Select');
  assert.ok(selectBtn, 'Contacts toolbar exposes Select button');
  act(() => selectBtn.click());

  const selectionBar = host.querySelector('.contacts-selection-bar');
  assert.ok(selectionBar, 'Clicking Select opens .contacts-selection-bar');

  const selectAllBox = selectionBar.querySelector('[aria-label="Select all visible contacts"]');
  assert.ok(selectAllBox, 'Selection bar includes ReUI Select All Checkbox');
  assert.equal(selectAllBox.getAttribute('data-state'), 'unchecked');

  // Toggle two individual contacts -> header checkbox becomes indeterminate
  const ayeshaBox = host.querySelector('[aria-label="Select Ayesha Siddiqua"]');
  const tanvirBox = host.querySelector('[aria-label="Select Tanvir Hasan"]');
  assert.ok(ayeshaBox && tanvirBox, 'Each contact card renders its ReUI selection Checkbox');

  act(() => ayeshaBox.click());
  act(() => tanvirBox.click());

  assert.equal(selectAllBox.getAttribute('data-state'), 'indeterminate');
  assert.ok(selectionBar.textContent.includes('2 selected'));

  // Open bulk delete confirmation dialog
  const deleteSelectedBtn = Array.from(selectionBar.querySelectorAll('button')).find((b) =>
    b.textContent.includes('Delete selected')
  );
  assert.ok(deleteSelectedBtn, 'Selection bar renders Delete selected button');
  act(() => deleteSelectedBtn.click());

  const dialog = document.body.querySelector('[role="alertdialog"][aria-labelledby="contacts-bulk-delete-title"]');
  assert.ok(dialog, 'Bulk delete opens accessible alertdialog');
  assert.ok(dialog.textContent.includes('Delete 2 selected contacts?'));
  assert.ok(dialog.textContent.includes('Ayesha Siddiqua'));
  assert.ok(dialog.textContent.includes('Tanvir Hasan'));

  const confirmBtn = Array.from(dialog.querySelectorAll('button')).find((b) =>
    b.textContent.includes('Delete 2 contacts')
  );
  assert.ok(confirmBtn, 'Bulk delete alertdialog exposes confirm button');
  await act(async () => {
    confirmBtn.click();
  });

  assert.deepEqual(deletedBatch.sort(), ['c-1', 'c-2']);
  assert.equal(host.querySelector('.contacts-selection-bar'), null, 'Selection mode exits cleanly after bulk delete');

  unmount();
});

test('Contacts vCard import shows ReUI progress and renders compact number-feedback dialog', async () => {
  const workspaceCss = readFileSync(new URL('../src/workspace.css', import.meta.url), 'utf8');
  const themeCss = readFileSync(new URL('../src/persora-theme.css', import.meta.url), 'utf8');

  // Regression check: .contacts-number-feedback must NEVER share rules with .contacts-duplicate-banner
  assert.equal(
    /\.contacts-duplicate-banner\s*,\s*\.contacts-number-feedback/.test(workspaceCss) ||
      /\.contacts-duplicate-banner\s*,\s*\.contacts-number-feedback/.test(themeCss),
    false,
    '.contacts-number-feedback is decoupled from .contacts-duplicate-banner'
  );
  assert.ok(workspaceCss.includes('.contacts-number-feedback-summary'));

  let sawProgressDuringImport = false;
  let resolveImport;
  const importPromise = new Promise((resolve) => {
    resolveImport = resolve;
  });

  const { host, unmount } = mount(
    React.createElement(ContactsView, {
      userId: 'user-1',
      contacts: SAMPLE_CONTACTS,
      demoMode: false,
      connected: true,
      canUpload: true,
      onRefresh: async () => {},
      onSave: async (draft) => ({ ...SAMPLE_CONTACTS[0], ...draft }),
      onDelete: async () => {},
      onDeleteMany: async () => {},
      onShare: async () => {},
      onMerge: async () => {},
      onImport: async (drafts, onProgress) => {
        onProgress?.({
          completed: 1,
          total: drafts.length,
          percent: 50,
          remainingSeconds: 1,
          currentName: drafts[0]?.name || 'Rafiq',
        });
        await importPromise;
        return drafts.map((d, idx) => ({
          id: `imp-${idx + 1}`,
          name: d.name,
          phoneNumbers: d.phoneNumbers,
          email: d.email || '',
          company: d.company || '',
          jobTitle: d.jobTitle || '',
          address: d.address || '',
          birthday: d.birthday || '',
          notes: d.notes || '',
          category: d.category || 'Other',
          favorite: false,
          createdAt: '2026-10-27T08:00:00.000Z',
          updatedAt: '2026-10-27T08:00:00.000Z',
        }));
      },
      notify: () => {},
    })
  );

  const fileInput = host.querySelector('input[type="file"][accept*=".vcf"]');
  assert.ok(fileInput, 'Contacts page renders .vcf file input');

  const vcfContent = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:Rafiq Ahmed',
    'TEL;TYPE=CELL:+8801712999888',
    'TEL;TYPE=WORK:+8801712999888',
    'TEL;TYPE=HOME:12-invalid',
    'END:VCARD',
  ].join('\r\n');
  const vcfFile = new File([vcfContent], 'contacts.vcf', { type: 'text/vcard' });
  vcfFile.text = async () => vcfContent;

  Object.defineProperty(fileInput, 'files', { value: [vcfFile], configurable: true });
  await act(async () => {
    fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  });

  const importDialog = document.body.querySelector('.contacts-import-dialog');
  assert.ok(importDialog, 'Import preview dialog opens with ReUI Attachment & Checkbox rows');
  assert.ok(importDialog.querySelector('[data-slot="file-type"]'), 'Source vCard renders ReUI FileType icon');

  const confirmImportBtn = Array.from(importDialog.querySelectorAll('button')).find((b) =>
    b.textContent.includes('Import 1 contact')
  );
  assert.ok(confirmImportBtn);

  // Trigger import without awaiting completion yet so we can inspect live ReUI Progress
  act(() => {
    confirmImportBtn.click();
  });
  await act(async () => {
    await Promise.resolve();
  });

  const liveProgressBar = document.body.querySelector('.contacts-import-dialog [data-slot="progress"][role="progressbar"]');
  sawProgressDuringImport = Boolean(liveProgressBar && liveProgressBar.getAttribute('aria-valuenow') === '50');
  assert.equal(sawProgressDuringImport, true, 'Import preview renders live 50% ReUI Progress bar');

  await act(async () => {
    resolveImport();
    await importPromise;
  });

  const feedbackDialog = document.body.querySelector('.contacts-number-feedback-dialog, .contacts-number-feedback');
  const feedbackItems = document.body.querySelectorAll('.contacts-feedback-number-item [data-slot="badge"]');
  assert.ok(feedbackDialog || feedbackItems.length >= 2, 'Post-import number feedback dialog renders compact ReUI Badges');
  assert.ok(document.body.textContent.includes('12-invalid'), 'Feedback dialog lists skipped invalid phone number');
  assert.ok(document.body.textContent.includes('Fix number'), 'Feedback dialog offers Fix number action');

  unmount();
});

test('Codebase-wide old-layer removal & documentation accuracy invariants hold', () => {
  function walkFiles(dir, extFilter) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walkFiles(full, extFilter));
      else if (extFilter(entry.name)) out.push(full);
    }
    return out;
  }

  const tsxFiles = walkFiles(new URL('../src', import.meta.url).pathname, (n) => n.endsWith('.tsx'));
  for (const file of tsxFiles) {
    const src = readFileSync(file, 'utf8');
    assert.equal(
      /className=["'][^"']*(?:^|\s)(?:dark-)?spinner(?:\s|["'])/.test(src),
      false,
      `No legacy .spinner/.dark-spinner class in ${path.basename(file)}`
    );
    const withoutExecHtml = src.replace(/execCommand\("insertHTML"[^\n]+/g, '');
    assert.equal(
      /<input[^>]*type=["']checkbox["']/.test(withoutExecHtml),
      false,
      `No raw <input type="checkbox"> in ${path.basename(file)}`
    );
  }

  const mdFiles = [
    'README.md',
    'DEPLOYMENT.md',
    'CALENDAR.md',
    'CONTACTS.md',
    'BUSINESS_CARDS.md',
    'CONNECTIONS.md',
    'ACCOUNT_DATA.md',
    'PDF_STUDIO.md',
    'PHOTO_STUDIO.md',
    'LOAN_TRACKER.md',
    'PASSWORD_VAULT.md',
    'SMART_SCAN_SETUP.md',
    'src/assets/connections/README.md',
  ];
  for (const rel of mdFiles) {
    const text = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
    assert.ok(text.trim().length > 100, `${rel} is populated`);
    assert.equal(
      text.includes('202610210001_password_vault_recovery.sql'),
      false,
      `${rel} does not reference removed pre-consolidation migration files`
    );
  }
});
