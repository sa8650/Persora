// Persora Table Sharing — end-to-end DB, RLS, member permissions, public links,
// cell/thread commenting, Smart Table collaboration, and revocation tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createVaultDatabase } from './password-vault-db.mjs';
import { handleTables, handlePublicTables } from '../cloudflare/tables.js';
import { blankSpreadsheet, buildTemplate } from '../cloudflare/table-templates.js';

const ORIGIN = 'https://persora.example';
const env = { SUPABASE_URL: 'https://db.example.test', SUPABASE_SECRET_KEY: 'test-service-key' };
const ctx = await createVaultDatabase();
const { db } = ctx;

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (!url.pathname.startsWith('/rest/v1/rpc/')) return Response.json([]);
  const name = url.pathname.split('/').pop();
  const args = init.body ? JSON.parse(init.body) : {};
  try {
    const result = await ctx.rpc(name, args);
    return Response.json(result ?? null);
  } catch (error) {
    return Response.json({ code: error.code, message: error.message }, { status: 400 });
  }
};

function memoryBucket() {
  const objects = new Map();
  return {
    objects,
    async put(key, body, options = {}) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      objects.set(key, {
        bytes,
        httpMetadata: options.httpMetadata || {},
        customMetadata: options.customMetadata || {},
      });
    },
    async get(key) {
      const entry = objects.get(key);
      return entry
        ? {
            body: new Blob([entry.bytes]).stream(),
            size: entry.bytes.byteLength,
            httpMetadata: entry.httpMetadata,
            customMetadata: entry.customMetadata,
          }
        : null;
    },
    async head(key) {
      const entry = objects.get(key);
      return entry ? { size: entry.bytes.byteLength, customMetadata: entry.customMetadata } : null;
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}

const aliceRow = await ctx.addMember('share-alice');
const bobRow = await ctx.addMember('share-bob');
const carolRow = await ctx.addMember('share-carol');
const eveRow = await ctx.addMember('share-eve');

async function loadProfile(id) {
  const { rows } = await db.query(
    `select id, login_id, email, full_name from public.profiles where id = $1`,
    [id],
  );
  return rows[0];
}

const alice = await loadProfile(aliceRow.id);
const bob = await loadProfile(bobRow.id);
const carol = await loadProfile(carolRow.id);
const eve = await loadProfile(eveRow.id);

const memberDirectory = [alice, bob, carol, eve];

const notifications = [];
const shareServices = {
  async resolveShareRecipient(rawRecipient, ownerId) {
    const q = String(rawRecipient || '').trim().toLowerCase().replace(/^#/, '');
    if (!q) throw Object.assign(new Error('Enter a Persora 7-digit ID or email.'), { status: 400 });
    const found = memberDirectory.find(
      (m) => m.login_id.toLowerCase() === q || m.email.toLowerCase() === q,
    );
    if (!found) throw Object.assign(new Error('No Persora account matched that ID or email.'), { status: 404 });
    if (found.id === ownerId) throw Object.assign(new Error('You already own this table.'), { status: 400 });
    return found;
  },
  async writeShareNotification(recipientId, actorId, actorName, itemTitle, kind, message) {
    notifications.push({ recipientId, actorId, actorName, itemTitle, kind, message });
  },
};

async function callAuth(method, path, body, who = alice, extraServices = {}, extraEnv = {}) {
  const init = { method };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const res = await handleTables(
    new Request(`${ORIGIN}/api${path}`, init),
    who,
    { ...env, ...extraEnv },
    ORIGIN,
    { ...shareServices, ...extraServices },
  );
  const ct = res.headers.get('content-type') || '';
  return {
    status: res.status,
    body: ct.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer()),
  };
}

async function callPublic(method, path, body, signedInWho = null, extraEnv = {}) {
  const init = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const res = await handlePublicTables(
    new Request(`${ORIGIN}/api${path}`, init),
    { ...env, ...extraEnv },
    ORIGIN,
    signedInWho,
  );
  const ct = res.headers.get('content-type') || '';
  return {
    status: res.status,
    body: ct.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer()),
  };
}

test('schema & RLS: sharing tables enforce RLS with persora_jwt_uid() and never call raw auth.uid()', async () => {
  const rls = await db.query(
    `select relname, relrowsecurity from pg_class
     where relnamespace = 'public'::regnamespace
       and relname in ('table_shares', 'table_share_links', 'table_comments')
     order by relname`,
  );
  assert.equal(rls.rows.length, 3);
  for (const row of rls.rows) {
    assert.equal(row.relrowsecurity, true, `${row.relname} must have RLS enabled`);
  }

  const migrationSql = readFileSync(
    new URL('../supabase/migrations/20261028000000_table_sharing_and_forms.sql', import.meta.url),
    'utf8',
  ).replace(/--.*$/gm, '');
  assert.ok(!/\bauth\.uid\s*\(/i.test(migrationSql), 'migration must use public.persora_jwt_uid(), never raw auth.uid()');
  assert.ok(/public\.persora_jwt_uid\(\)/.test(migrationSql));
});

test('member sharing: view, comment, and edit permissions are enforced server-side and preserve ownership', async () => {
  const content = blankSpreadsheet();
  content.sheets[0].data.cells['0:0'] = { v: 'Revenue', s: { b: 1 } };
  content.sheets[0].data.cells['0:1'] = { v: 12500 };

  const created = await callAuth('POST', '/tables', {
    id: crypto.randomUUID(),
    kind: 'spreadsheet',
    name: 'Q4 Forecast',
    sheets: content.sheets,
  }, alice);
  assert.equal(created.status, 201);
  const tableId = created.body.table.id;
  const sheetId = content.sheets[0].id;

  // Cannot share with oneself
  const selfShare = await callAuth('POST', `/tables/${tableId}/sharing/members`, {
    recipient: alice.login_id,
    permission: 'edit',
  }, alice);
  assert.equal(selfShare.status, 400);

  // Share with Bob as 'view' (by 7-digit login_id) and Carol as 'comment' (by email)
  const bobShare = await callAuth('POST', `/tables/${tableId}/sharing/members`, {
    recipient: bob.login_id,
    permission: 'view',
  }, alice);
  assert.equal(bobShare.status, 201);
  assert.equal(bobShare.body.share.permission, 'view');

  const carolShare = await callAuth('POST', `/tables/${tableId}/sharing/members`, {
    recipient: carol.email,
    permission: 'comment',
  }, alice);
  assert.equal(carolShare.status, 201);
  assert.equal(carolShare.body.share.permission, 'comment');

  // Bob sees Q4 Forecast in his Table list with shared=true & owner identity
  const bobList = await callAuth('GET', '/tables', undefined, bob);
  assert.equal(bobList.status, 200);
  const bobItem = bobList.body.tables.find((t) => t.id === tableId);
  assert.ok(bobItem, 'shared table appears in recipient table list');
  assert.equal(bobItem.shared, true);
  assert.equal(bobItem.permission, 'view');
  assert.equal(bobItem.ownerId, alice.id);
  assert.equal(bobItem.ownerLoginId, alice.login_id);

  // Eve (unshared) cannot list or open Alice's table
  const eveOpen = await callAuth('GET', `/tables/${tableId}`, undefined, eve);
  assert.equal(eveOpen.status, 404);

  // Bob ('view') can open, CANNOT edit content, CANNOT comment, CANNOT view share settings or delete
  const bobOpen = await callAuth('GET', `/tables/${tableId}`, undefined, bob);
  assert.equal(bobOpen.status, 200);
  assert.equal(bobOpen.body.sheets[0].data.cells['0:1'].v, 12500);

  const bobEditAttempt = await callAuth('PUT', `/tables/${tableId}/content`, {
    baseRevision: bobOpen.body.table.revision,
    batchId: crypto.randomUUID(),
    sheets: content.sheets,
  }, bob);
  assert.equal(bobEditAttempt.status, 403);

  const bobCommentAttempt = await callAuth('POST', `/tables/${tableId}/comments`, {
    kind: 'thread',
    body: 'Trying to comment as viewer',
  }, bob);
  assert.equal(bobCommentAttempt.status, 403);

  const bobSharingOverview = await callAuth('GET', `/tables/${tableId}/sharing`, undefined, bob);
  assert.equal(bobSharingOverview.status, 404);

  // Carol ('comment') CANNOT edit cells, but CAN post cell and thread comments
  const carolEditAttempt = await callAuth('PUT', `/tables/${tableId}/content`, {
    baseRevision: bobOpen.body.table.revision,
    batchId: crypto.randomUUID(),
    sheets: content.sheets,
  }, carol);
  assert.equal(carolEditAttempt.status, 403);

  const carolCellComment = await callAuth('POST', `/tables/${tableId}/comments`, {
    kind: 'cell',
    sheetId,
    row: 0,
    col: 1,
    text: 'Please double-check October revenue.',
  }, carol);
  assert.equal(carolCellComment.status, 201);
  assert.equal(carolCellComment.body.cellKey, '0:1');
  assert.equal(carolCellComment.body.comment.text, 'Please double-check October revenue.');

  const carolThreadComment = await callAuth('POST', `/tables/${tableId}/comments`, {
    kind: 'thread',
    body: 'Overall numbers look solid!',
  }, carol);
  assert.equal(carolThreadComment.status, 201);

  // Upgrade Bob to 'edit' and verify he can edit cells while ownership stays with Alice
  const upgradeBob = await callAuth(
    'PATCH',
    `/tables/${tableId}/sharing/members/${bobShare.body.share.id}`,
    { permission: 'edit' },
    alice,
  );
  assert.equal(upgradeBob.status, 200);
  assert.equal(upgradeBob.body.share.permission, 'edit');

  const bobFresh = await callAuth('GET', `/tables/${tableId}`, undefined, bob);
  const editedSheets = bobFresh.body.sheets;
  editedSheets[0].data.cells['0:1'] = { v: 15900 };
  const bobSave = await callAuth('PUT', `/tables/${tableId}/content`, {
    baseRevision: bobFresh.body.table.revision,
    batchId: crypto.randomUUID(),
    sheets: { upsert: editedSheets },
  }, bob);
  assert.equal(bobSave.status, 200);
  const aliceVerifyBobEdit = await callAuth('GET', `/tables/${tableId}`, undefined, alice);
  assert.equal(aliceVerifyBobEdit.body.sheets[0].data.cells['0:1'].v, 15900);

  // Editor still cannot delete or rename owner's table
  const bobDeleteAttempt = await callAuth('DELETE', `/tables/${tableId}`, undefined, bob);
  assert.equal(bobDeleteAttempt.status, 404);

  // Verify table owner in DB is still Alice
  const ownerRow = await db.query(`select user_id from public.persora_tables where id = $1`, [tableId]);
  assert.equal(ownerRow.rows[0].user_id, alice.id);

  // Revoke Bob's share -> immediate 404
  const revokeBob = await callAuth(
    'DELETE',
    `/tables/${tableId}/sharing/members/${bobShare.body.share.id}`,
    undefined,
    alice,
  );
  assert.equal(revokeBob.status, 200);
  const bobAfterRevoke = await callAuth('GET', `/tables/${tableId}`, undefined, bob);
  assert.equal(bobAfterRevoke.status, 404);
});

test('public link sharing: Viewer vs Commenter permissions, R2 attachment scoping, link regeneration, and disable', async () => {
  const bucket = memoryBucket();
  const smart = buildTemplate('expense-tracker', '2026-10-28');
  const baseSpreadsheet = blankSpreadsheet();
  const created = await callAuth('POST', '/tables', {
    id: crypto.randomUUID(),
    kind: 'spreadsheet',
    name: 'Public Roadmap',
    sheets: baseSpreadsheet.sheets,
  }, alice);
  assert.equal(created.status, 201);
  const tableId = created.body.table.id;
  const sheetId = baseSpreadsheet.sheets[0].id;

  // Enable public Viewer link
  const enableViewer = await callAuth('PUT', `/tables/${tableId}/sharing/link`, {
    enabled: true,
    permission: 'view',
  }, alice);
  assert.equal(enableViewer.status, 200);
  const token1 = enableViewer.body.link.shareToken;
  assert.ok(token1 && token1.length >= 32, 'cryptographically secure share token generated');

  // Public GET works anonymously without exposing private owner info or other tables
  const pubView = await callPublic('GET', `/public/tables/${token1}`);
  assert.equal(pubView.status, 200);
  assert.equal(pubView.body.permission, 'view');
  assert.equal(pubView.body.table.name, 'Public Roadmap');
  assert.equal(pubView.body.table.ownerId, undefined);
  assert.equal(pubView.body.table.ownerEmail, undefined);
  assert.equal(pubView.body.table.ownerLoginId, undefined);

  // Viewer link blocks anonymous comments
  const blockedComment = await callPublic('POST', `/public/tables/${token1}/comments`, {
    kind: 'thread',
    body: 'Should fail on Viewer link',
  });
  assert.equal(blockedComment.status, 403);

  // Switch link to Commenter -> anonymous cell & thread comments succeed, edits stay blocked
  const enableCommenter = await callPublic('PUT', `/public/tables/${token1}`, { name: 'Hacked' });
  assert.equal(enableCommenter.status, 405);

  const switchToCommenter = await callAuth('PUT', `/tables/${tableId}/sharing/link`, {
    enabled: true,
    permission: 'comment',
  }, alice);
  assert.equal(switchToCommenter.status, 200);
  assert.equal(switchToCommenter.body.link.shareToken, token1);

  const guestCellComment = await callPublic('POST', `/public/tables/${token1}/comments`, {
    kind: 'cell',
    sheetId,
    row: 2,
    col: 3,
    text: 'Can we move Q4 launch up by one week?',
    authorName: 'External Partner',
  });
  assert.equal(guestCellComment.status, 201);
  assert.equal(guestCellComment.body.comment.author, 'External Partner');

  const guestThread = await callPublic('POST', `/public/tables/${token1}/comments`, {
    kind: 'thread',
    body: 'Excited about this roadmap!',
    authorName: 'External Partner',
  });
  assert.equal(guestThread.status, 201);

  // Regenerating link revokes token1 and issues token2
  const regenerated = await callAuth('PUT', `/tables/${tableId}/sharing/link`, {
    enabled: true,
    permission: 'comment',
    regenerate: true,
  }, alice);
  assert.equal(regenerated.status, 200);
  const token2 = regenerated.body.link.shareToken;
  assert.notEqual(token2, token1);

  const oldTokenRes = await callPublic('GET', `/public/tables/${token1}`);
  assert.equal(oldTokenRes.status, 404);
  const newTokenRes = await callPublic('GET', `/public/tables/${token2}`);
  assert.equal(newTokenRes.status, 200);

  // Disabling link revokes token2 immediately
  const disabled = await callAuth('PUT', `/tables/${tableId}/sharing/link`, {
    enabled: false,
  }, alice);
  assert.equal(disabled.status, 200);
  const afterDisable = await callPublic('GET', `/public/tables/${token2}`);
  assert.equal(afterDisable.status, 404);

  // Smart Table collaborator R2 attachment upload stores under owner's prefix
  const smartRes = await callAuth('POST', '/tables', {
    id: crypto.randomUUID(),
    kind: 'smart',
    name: 'Shared Expenses',
    meta: smart.meta,
    records: smart.records,
  }, alice);
  const smartId = smartRes.body.table.id;
  await callAuth('POST', `/tables/${smartId}/sharing/members`, {
    recipient: bob.login_id,
    permission: 'edit',
  }, alice);

  const fd = new FormData();
  fd.append('id', crypto.randomUUID());
  fd.append('file', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'receipt.png', { type: 'image/png' }));
  const bobUpload = await callAuth(
    'POST',
    `/tables/${smartId}/attachments`,
    fd,
    bob,
    { storageUsage: async () => ({ bytesUsed: 0, storageLimitBytes: 100 * 1024 * 1024 }) },
    { VAULT_FILES: bucket },
  );
  assert.equal(bobUpload.status, 201);
  const attId = bobUpload.body.attachment.id;
  const storedKeys = [...bucket.objects.keys()];
  assert.equal(storedKeys.length, 1);
  assert.ok(storedKeys[0].startsWith(`${alice.id}/persora-table/`), 'collaborator attachment stored under owner namespace');

  // Public Smart Table link serves attachment while enabled and blocks once disabled
  const smartLink = await callAuth('PUT', `/tables/${smartId}/sharing/link`, { enabled: true, permission: 'view' }, alice);
  const smartToken = smartLink.body.link.shareToken;
  const pubAtt = await callPublic('GET', `/public/tables/${smartToken}/attachments/${attId}`, undefined, null, { VAULT_FILES: bucket });
  assert.equal(pubAtt.status, 200);
  await callAuth('PUT', `/tables/${smartId}/sharing/link`, { enabled: false }, alice);
  const pubAttDisabled = await callPublic('GET', `/public/tables/${smartToken}/attachments/${attId}`, undefined, null, { VAULT_FILES: bucket });
  assert.equal(pubAttDisabled.status, 404);
});

test('public Editor link: PUT /public/tables/:token/content enforces edit permission, optimistic concurrency, and preserves owner_id', async () => {
  const sheetDoc = blankSpreadsheet();
  sheetDoc.sheets[0].data.cells['0:0'] = { v: 'Task' };
  sheetDoc.sheets[0].data.cells['1:0'] = { v: 'Initial draft' };

  const created = await callAuth('POST', '/tables', {
    id: crypto.randomUUID(),
    kind: 'spreadsheet',
    name: 'Public Sprint Sheet',
    sheets: sheetDoc.sheets,
  }, alice);
  assert.equal(created.status, 201);
  const tableId = created.body.table.id;

  // 1) Viewer link blocks public content save with 403
  const viewLink = await callAuth('PUT', `/tables/${tableId}/sharing/link`, {
    enabled: true,
    permission: 'view',
  }, alice);
  const token = viewLink.body.link.shareToken;

  const viewBlockedSave = await callPublic('PUT', `/public/tables/${token}/content`, {
    baseRevision: created.body.table.revision,
    batchId: crypto.randomUUID(),
    sheets: sheetDoc.sheets,
  });
  assert.equal(viewBlockedSave.status, 403);

  // 2) Commenter link ALSO blocks public content save with 403
  await callAuth('PUT', `/tables/${tableId}/sharing/link`, {
    enabled: true,
    permission: 'comment',
  }, alice);
  const commentBlockedSave = await callPublic('PUT', `/public/tables/${token}/content`, {
    baseRevision: created.body.table.revision,
    batchId: crypto.randomUUID(),
    sheets: sheetDoc.sheets,
  });
  assert.equal(commentBlockedSave.status, 403);

  // 3) Upgrade public link to Editor ('edit') -> GET reports 'edit' and PUT /content succeeds!
  const editLink = await callAuth('PUT', `/tables/${tableId}/sharing/link`, {
    enabled: true,
    permission: 'edit',
  }, alice);
  assert.equal(editLink.status, 200);
  assert.equal(editLink.body.link.permission, 'edit');

  const pubBefore = await callPublic('GET', `/public/tables/${token}`);
  assert.equal(pubBefore.status, 200);
  assert.equal(pubBefore.body.permission, 'edit');

  const updatedSheets = structuredClone(pubBefore.body.sheets);
  updatedSheets[0].data.cells['1:0'] = { v: 'Edited via public link' };
  updatedSheets[0].data.cells['1:1'] = { v: 42 };

  const pubSave = await callPublic('PUT', `/public/tables/${token}/content`, {
    baseRevision: pubBefore.body.table.revision,
    batchId: crypto.randomUUID(),
    sheets: { upsert: updatedSheets },
  });
  assert.equal(pubSave.status, 200);
  assert.ok(pubSave.body.table.revision > pubBefore.body.table.revision);

  // Stale revision triggers 409 conflict
  const staleSave = await callPublic('PUT', `/public/tables/${token}/content`, {
    baseRevision: pubBefore.body.table.revision,
    batchId: crypto.randomUUID(),
    sheets: { upsert: updatedSheets },
  });
  assert.equal(staleSave.status, 409);

  // Owner sees the public edit and still owns table + sheets
  const ownerCheck = await callAuth('GET', `/tables/${tableId}`, undefined, alice);
  assert.equal(ownerCheck.status, 200);
  assert.equal(ownerCheck.body.sheets[0].data.cells['1:0'].v, 'Edited via public link');
  assert.equal(ownerCheck.body.sheets[0].data.cells['1:1'].v, 42);

  const sheetOwners = await db.query(
    `select distinct user_id from public.persora_table_sheets where table_id = $1`,
    [tableId],
  );
  assert.deepEqual(sheetOwners.rows.map((r) => r.user_id), [alice.id]);
});

