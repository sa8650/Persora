// Persora Table migration on PGlite (schema.sql + every migration, in order):
// privileges/RLS, owner isolation (ids from another account never work),
// idempotent create/duplicate, revision-checked saves (stale base → conflict,
// repeated batch → replay, all-or-nothing batches), limits, Trash move/restore
// with attachments, attachment pruning and export.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVaultDatabase } from './password-vault-db.mjs';
import { buildTemplate, blankSpreadsheet } from '../cloudflare/table-templates.js';
import { emptySheetData } from '../cloudflare/table-rules.js';

const ctx = await createVaultDatabase();
const { db, rpc, addMember } = ctx;
const alice = await addMember('table-alice');
const bob = await addMember('table-bob');

const rejects = async (promise, code) => {
  await assert.rejects(promise, (error) => { assert.equal(error.code, code, error.message); return true; });
};
const count = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].count);

async function createSheet(owner, name = 'Budget', id = crypto.randomUUID()) {
  const content = blankSpreadsheet();
  content.sheets[0].data.cells['0:0'] = { v: 'Item' };
  const result = await rpc('persora_table_create', { p_owner: owner.id, p_id: id, p_table: { kind: 'spreadsheet', name }, p_sheets: content.sheets, p_records: [] });
  return { id, result, sheets: content.sheets };
}
async function createSmart(owner, name = 'Expenses', id = crypto.randomUUID()) {
  const content = buildTemplate('expense-tracker', '2026-10-24');
  const result = await rpc('persora_table_create', { p_owner: owner.id, p_id: id, p_table: { kind: 'smart', name, template: 'expense-tracker', meta: content.meta }, p_sheets: [], p_records: content.records });
  return { id, result, meta: content.meta, records: content.records };
}
const save = (owner, id, base, extra = {}) => rpc('persora_table_save', {
  p_owner: owner.id, p_id: id, p_base: base, p_batch: extra.batch || crypto.randomUUID(), p_meta: extra.meta ?? null,
  p_sheet_upserts: extra.sheetUpserts || [], p_sheet_deletes: extra.sheetDeletes || [], p_record_upserts: extra.recordUpserts || [], p_record_deletes: extra.recordDeletes || [],
});
const get = (owner, id, touch = false) => rpc('persora_table_get', { p_owner: owner.id, p_id: id, p_touch: touch });

test('tables are closed to anon/authenticated; internal helpers are closed even to service_role', async () => {
  const { id } = await createSheet(alice);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      for (const table of ['persora_tables', 'persora_table_sheets', 'persora_table_records', 'persora_table_attachments']) await rejects(db.query(`select * from public.${table}`), '42501');
      await rejects(db.query(`select public.persora_tables_list('${alice.id}')`), '42501');
      await rejects(db.query(`select public.persora_table_get('${alice.id}', '${id}', false)`), '42501');
      await rejects(db.query(`select public.persora_tables_export('${alice.id}')`), '42501');
    } finally { await db.exec('reset role'); }
  }
  await db.exec('set role service_role');
  try {
    await rejects(db.query(`select public.persora_table_refresh_stats('${id}')`), '42501');
    await rejects(db.query(`select public.persora_table_uuid_array('[]'::jsonb)`), '42501');
  } finally { await db.exec('reset role'); }
  const rls = await db.query(`select relname, relrowsecurity from pg_class where relname like 'persora_table%' and relkind = 'r' order by relname`);
  assert.equal(rls.rows.length, 4);
  assert.ok(rls.rows.every((row) => row.relrowsecurity));
});

test('create is idempotent, counts and size are tracked, and get returns the whole table', async () => {
  const { id, result, records } = await createSmart(alice);
  assert.equal(result.replayed, false);
  assert.equal(result.table.record_count, records.length);
  assert.ok(result.table.size_bytes > 100);
  const again = await rpc('persora_table_create', { p_owner: alice.id, p_id: id, p_table: { kind: 'smart', name: 'Other' }, p_sheets: [], p_records: [] });
  assert.equal(again.replayed, true);
  assert.equal(again.table.name, 'Expenses');
  assert.equal(await count('select count(*) from persora_table_records where table_id = $1', [id]), records.length);
  // The same id cannot be claimed by another account.
  await rejects(rpc('persora_table_create', { p_owner: bob.id, p_id: id, p_table: { kind: 'smart', name: 'Mine' }, p_sheets: [], p_records: [] }), 'P0409');
  const detail = await get(alice, id, true);
  assert.equal(detail.table.kind, 'smart');
  assert.equal(detail.table.meta.fields.length > 3, true);
  assert.equal(detail.records.length, records.length);
  assert.equal(detail.records[0].example, true);
  assert.ok(detail.table.opened_at);
  // Kind/content mismatches are refused.
  await rejects(rpc('persora_table_create', { p_owner: alice.id, p_id: crypto.randomUUID(), p_table: { kind: 'spreadsheet', name: 'x' }, p_sheets: [], p_records: [] }), 'P0422');
  await rejects(rpc('persora_table_create', { p_owner: alice.id, p_id: crypto.randomUUID(), p_table: { kind: 'smart', name: 'x' }, p_sheets: blankSpreadsheet().sheets, p_records: [] }), 'P0422');
  await rejects(rpc('persora_table_create', { p_owner: alice.id, p_id: crypto.randomUUID(), p_table: { kind: 'chart', name: 'x' }, p_sheets: [], p_records: [] }), '23514');
});

test('owner isolation: another account cannot read, save, rename, duplicate, trash or attach', async () => {
  const { id } = await createSheet(alice, 'Private');
  await rejects(get(bob, id), 'P0404');
  await rejects(save(bob, id, 1, { sheetUpserts: [{ id: crypto.randomUUID(), name: 'Evil', position: 1, data: emptySheetData() }] }), 'P0404');
  await rejects(rpc('persora_table_update_info', { p_owner: bob.id, p_id: id, p_name: 'Hacked', p_label: null, p_starred: true }), 'P0404');
  await rejects(rpc('persora_table_duplicate', { p_owner: bob.id, p_source: id, p_new_id: crypto.randomUUID(), p_name: 'Copy' }), 'P0404');
  await rejects(rpc('persora_table_trash_move', { p_owner: bob.id, p_id: id }), 'P0404');
  await rejects(rpc('persora_table_attachment_add', { p_owner: bob.id, p_table: id, p_id: crypto.randomUUID(), p_key: `${bob.id}/persora-table/x`, p_name: 'x', p_type: 'text/plain', p_size: 1 }), 'P0404');
  const list = await rpc('persora_tables_list', { p_owner: bob.id });
  assert.ok(!list.some((row) => row.id === id));
  const detail = await get(alice, id);
  assert.equal(detail.table.name, 'Private');
  assert.equal(detail.table.revision, 1);
  // A sheet/record id that belongs to another table cannot be overwritten through your own table.
  const bobs = await createSheet(bob, 'Bob sheet');
  await rejects(save(bob, bobs.id, 1, { sheetUpserts: [{ ...detail.sheets[0], name: 'Stolen', position: 5 }] }), 'P0403');
  assert.equal((await get(alice, id)).sheets[0].name, detail.sheets[0].name);
});

test('saves are revision-checked, replay-safe and all-or-nothing', async () => {
  const { id, sheets } = await createSheet(alice, 'Rev');
  const sheet = sheets[0];
  const batch = crypto.randomUUID();
  const edited = { ...sheet, data: { ...sheet.data, cells: { ...sheet.data.cells, '1:0': { v: 42 } } } };
  const first = await save(alice, id, 1, { batch, sheetUpserts: [edited] });
  assert.equal(first.ok, true);
  assert.equal(first.table.revision, 2);
  // Retrying the same batch (lost response) does not apply twice or conflict.
  const replay = await save(alice, id, 1, { batch, sheetUpserts: [edited] });
  assert.equal(replay.ok, true);
  assert.equal(replay.replayed, true);
  assert.equal(replay.table.revision, 2);
  // Another tab still based on revision 1 gets a conflict and writes nothing.
  const stale = await save(alice, id, 1, { sheetUpserts: [{ ...sheet, name: 'Overwrite' }] });
  assert.equal(stale.ok, false);
  assert.equal(stale.conflict, true);
  assert.equal(stale.table.revision, 2);
  let detail = await get(alice, id);
  assert.equal(detail.sheets[0].name, sheet.name);
  assert.equal(detail.sheets[0].data.cells['1:0'].v, 42);
  // Add a sheet, then try a batch that would leave duplicate names: nothing in it applies.
  const second = { id: crypto.randomUUID(), name: 'Sheet2', position: 1, data: emptySheetData() };
  assert.equal((await save(alice, id, 2, { sheetUpserts: [second] })).table.sheet_count, 2);
  await rejects(save(alice, id, 3, { sheetUpserts: [{ ...second, name: 'sheet1', data: { ...second.data, cells: { '0:0': { v: 'lost' } } } }, { ...edited, position: 0 }] }), 'P0422');
  detail = await get(alice, id);
  assert.equal(detail.table.revision, 3);
  assert.equal(detail.sheets[1].name, 'Sheet2');
  assert.deepEqual(detail.sheets[1].data.cells, {});
  // Swapping names inside one batch is fine (checked after the batch).
  const swap = await save(alice, id, 3, { sheetUpserts: [{ ...edited, name: 'Sheet2' }, { ...second, name: 'Sheet1' }] });
  assert.equal(swap.ok, true);
  // The last sheet cannot be deleted.
  await rejects(save(alice, id, 4, { sheetDeletes: [sheet.id, second.id] }), 'P0422');
  // Deleting one sheet works.
  const del = await save(alice, id, 4, { sheetDeletes: [second.id] });
  assert.equal(del.table.sheet_count, 1);
  // Spreadsheets refuse record/meta changes.
  await rejects(save(alice, id, 5, { recordUpserts: [{ id: crypto.randomUUID(), position: 1, values: {} }] }), 'P0422');
  await rejects(save(alice, id, 5, { meta: { fields: [] } }), 'P0422');
});

test('smart records: upsert, delete, meta change and the 5,000-record limit', async () => {
  const { id, meta, records } = await createSmart(alice, 'Records');
  const amount = meta.fields.find((field) => field.type === 'currency');
  const added = { id: crypto.randomUUID(), position: 100, values: { [amount.id]: 99 }, example: false };
  const res = await save(alice, id, 1, { recordUpserts: [added, { ...records[0], values: { ...records[0].values, [amount.id]: 5 } }], recordDeletes: [records[1].id] });
  assert.equal(res.table.record_count, records.length);
  const detail = await get(alice, id);
  assert.equal(detail.records.find((row) => row.id === records[0].id).values[amount.id], 5);
  assert.ok(!detail.records.some((row) => row.id === records[1].id));
  assert.equal(detail.records.at(-1).id, added.id);
  const renamed = { ...meta, fields: meta.fields.map((field) => (field.id === amount.id ? { ...field, name: 'Cost' } : field)) };
  await save(alice, id, 2, { meta: renamed });
  assert.equal((await get(alice, id)).table.meta.fields.find((field) => field.id === amount.id).name, 'Cost');
  // Smart tables refuse sheets.
  await rejects(save(alice, id, 3, { sheetUpserts: blankSpreadsheet().sheets }), 'P0422');
  // Over the record limit: refused as a whole.
  const many = Array.from({ length: 5001 }, (_, index) => ({ id: crypto.randomUUID(), position: 1000 + index, values: {}, example: false }));
  await rejects(save(alice, id, 3, { recordUpserts: many }), 'P0422');
  assert.equal((await get(alice, id)).table.record_count, records.length);
});

test('size limit refuses oversized tables without writing', async () => {
  const { id } = await createSmart(alice, 'Big');
  const blob = 'x'.repeat(60000);
  const rows = Array.from({ length: 220 }, (_, index) => ({ id: crypto.randomUUID(), position: 500 + index, values: { note: blob }, example: false }));
  await rejects(save(alice, id, 1, { recordUpserts: rows }), 'P0413');
  assert.equal((await get(alice, id)).table.revision, 1);
});

test('rename, star and duplicate (idempotent, attachments shared)', async () => {
  const { id } = await createSmart(alice, 'Original');
  const info = await rpc('persora_table_update_info', { p_owner: alice.id, p_id: id, p_name: '  Renamed  ', p_label: 'Home', p_starred: true });
  assert.equal(info.name, 'Renamed');
  assert.equal(info.label, 'Home');
  assert.equal(info.starred, true);
  assert.equal(info.revision, 1);
  const key = `${alice.id}/persora-table/${crypto.randomUUID()}`;
  const attachment = await rpc('persora_table_attachment_add', { p_owner: alice.id, p_table: id, p_id: crypto.randomUUID(), p_key: key, p_name: 'receipt.pdf', p_type: 'application/pdf', p_size: 1234 });
  const copyId = crypto.randomUUID();
  const copy = await rpc('persora_table_duplicate', { p_owner: alice.id, p_source: id, p_new_id: copyId, p_name: 'Renamed copy' });
  assert.equal(copy.replayed, false);
  const again = await rpc('persora_table_duplicate', { p_owner: alice.id, p_source: id, p_new_id: copyId, p_name: 'Renamed copy' });
  assert.equal(again.replayed, true);
  const source = await get(alice, id);
  const dup = await get(alice, copyId);
  assert.equal(dup.table.name, 'Renamed copy');
  assert.equal(dup.records.length, source.records.length);
  assert.ok(dup.records.every((row) => !source.records.some((other) => other.id === row.id)));
  assert.equal(dup.attachments[0].id, attachment.id);
  assert.equal(await count('select count(*) from persora_table_attachments where file_key = $1', [key]), 2);
  // Attachment keys must live under the owner's persora-table prefix.
  await rejects(rpc('persora_table_attachment_add', { p_owner: alice.id, p_table: id, p_id: crypto.randomUUID(), p_key: `${bob.id}/persora-table/x`, p_name: 'x', p_type: 'text/plain', p_size: 1 }), '23514');
});

test('trash move snapshots everything; restore brings it back; expired or repeated restores are refused', async () => {
  const { id, records } = await createSmart(alice, 'Trashable');
  const key = `${alice.id}/persora-table/${crypto.randomUUID()}`;
  await rpc('persora_table_attachment_add', { p_owner: alice.id, p_table: id, p_id: crypto.randomUUID(), p_key: key, p_name: 'photo.png', p_type: 'image/png', p_size: 10 });
  await save(alice, id, 1, { recordDeletes: [records[0].id] });
  const trash = await rpc('persora_table_trash_move', { p_owner: alice.id, p_id: id });
  assert.equal(trash.kind, 'persora_table');
  assert.deepEqual(trash.file_keys, [key]);
  assert.equal(trash.payload, undefined);
  await rejects(get(alice, id), 'P0404');
  assert.equal(await count('select count(*) from persora_table_records where table_id = $1', [id]), 0);
  await rejects(rpc('persora_table_trash_restore', { p_owner: bob.id, p_trash_id: id }), 'P0409');
  const restored = await rpc('persora_table_trash_restore', { p_owner: alice.id, p_trash_id: id });
  assert.equal(restored.ok, true);
  const detail = await get(alice, id);
  assert.equal(detail.table.name, 'Trashable');
  assert.equal(detail.table.revision, 2);
  assert.equal(detail.records.length, records.length - 1);
  assert.equal(detail.attachments.length, 1);
  assert.equal(await count('select count(*) from trash_items where id = $1', [id]), 0);
  await rejects(rpc('persora_table_trash_restore', { p_owner: alice.id, p_trash_id: id }), 'P0409');
  // A save after restore continues from the restored revision.
  assert.equal((await save(alice, id, 2, { recordDeletes: [] })).ok, true);
  // Expired entries cannot be restored.
  await rpc('persora_table_trash_move', { p_owner: alice.id, p_id: id });
  await db.query(`update trash_items set deleted_at = now() - interval '9 days', expires_at = now() - interval '1 day' where id = $1`, [id]);
  await rejects(rpc('persora_table_trash_restore', { p_owner: alice.id, p_trash_id: id }), 'P0409');
});

test('attachment prune removes only unreferenced rows older than the cutoff', async () => {
  const { id } = await createSmart(alice, 'Files');
  const keep = crypto.randomUUID(); const drop = crypto.randomUUID(); const fresh = crypto.randomUUID();
  for (const [attId, name] of [[keep, 'keep'], [drop, 'drop'], [fresh, 'fresh']]) {
    await rpc('persora_table_attachment_add', { p_owner: alice.id, p_table: id, p_id: attId, p_key: `${alice.id}/persora-table/${name}`, p_name: name, p_type: 'text/plain', p_size: 1 });
  }
  await db.query(`update persora_table_attachments set created_at = now() - interval '2 days' where table_id = $1 and id <> $2`, [id, fresh]);
  const removed = await rpc('persora_table_attachments_prune', { p_owner: alice.id, p_table: id, p_keep: [keep], p_before: new Date(Date.now() - 864e5).toISOString() });
  assert.deepEqual(removed, [`${alice.id}/persora-table/drop`]);
  assert.deepEqual((await get(alice, id)).attachments.map((row) => row.name).sort(), ['fresh', 'keep']);
  // Bob's call touches nothing of Alice's.
  assert.deepEqual(await rpc('persora_table_attachments_prune', { p_owner: bob.id, p_table: id, p_keep: [], p_before: new Date().toISOString() }), []);
  // Re-adding an existing id with the same key is idempotent; a different key is refused.
  await rpc('persora_table_attachment_add', { p_owner: alice.id, p_table: id, p_id: keep, p_key: `${alice.id}/persora-table/keep`, p_name: 'keep', p_type: 'text/plain', p_size: 1 });
  await rejects(rpc('persora_table_attachment_add', { p_owner: alice.id, p_table: id, p_id: keep, p_key: `${alice.id}/persora-table/other`, p_name: 'keep', p_type: 'text/plain', p_size: 1 }), 'P0409');
});

test('table count limit, export scope and account deletion cascade', async () => {
  const carol = await addMember('table-carol');
  await createSheet(carol, 'One');
  const smart = await createSmart(carol, 'Two');
  const exported = await rpc('persora_tables_export', { p_owner: carol.id });
  assert.equal(exported.tables.length, 2);
  assert.equal(exported.sheets.length, 1);
  assert.equal(exported.records.length, smart.records.length);
  assert.ok(exported.tables.every((row) => row.meta));
  // Filling up to the limit directly, then one more is refused.
  await db.query(`insert into persora_tables (id, user_id, kind, name) select gen_random_uuid(), $1, 'smart', 'Filler ' || g from generate_series(1, 298) g`, [carol.id]);
  await rejects(createSmart(carol, 'Too many'), 'P0409');
  await rejects(rpc('persora_table_duplicate', { p_owner: carol.id, p_source: smart.id, p_new_id: crypto.randomUUID(), p_name: 'Copy' }), 'P0409');
  await db.query('delete from profiles where id = $1', [carol.id]);
  assert.equal(await count('select count(*) from persora_tables where user_id = $1', [carol.id]), 0);
  assert.equal(await count('select count(*) from persora_table_records where user_id = $1', [carol.id]), 0);
});

test('head returns the revision (and fields on request); attachment lookup is owner-scoped', async () => {
  const { id } = await createSmart(alice, 'Head');
  const head = await rpc('persora_table_head', { p_owner: alice.id, p_id: id, p_meta: false });
  assert.equal(head.revision, 1);
  assert.equal(head.meta, undefined);
  assert.ok((await rpc('persora_table_head', { p_owner: alice.id, p_id: id, p_meta: true })).meta.fields.length);
  await rejects(rpc('persora_table_head', { p_owner: bob.id, p_id: id, p_meta: true }), 'P0404');
  const attId = crypto.randomUUID();
  await rpc('persora_table_attachment_add', { p_owner: alice.id, p_table: id, p_id: attId, p_key: `${alice.id}/persora-table/a.png`, p_name: 'a.png', p_type: 'image/png', p_size: 5 });
  const row = await rpc('persora_table_attachment_get', { p_owner: alice.id, p_table: id, p_id: attId });
  assert.equal(row.file_key, `${alice.id}/persora-table/a.png`);
  await rejects(rpc('persora_table_attachment_get', { p_owner: bob.id, p_table: id, p_id: attId }), 'P0404');
  await rejects(rpc('persora_table_attachment_get', { p_owner: alice.id, p_table: crypto.randomUUID(), p_id: attId }), 'P0404');
});

test('people: me first, then accounts linked through projects or shares; strangers and suspended accounts are excluded', async () => {
  const owner = await addMember('people-owner');
  const teammate = await addMember('people-teammate');
  const recipient = await addMember('people-recipient');
  const stranger = await addMember('people-stranger');
  const suspended = await addMember('people-suspended');
  const { rows } = await db.query(`insert into projects (owner_id, name) values ($1, 'Team') returning id`, [teammate.id]);
  await db.query(`insert into project_members (project_id, user_id) values ($1, $2), ($1, $3)`, [rows[0].id, owner.id, suspended.id]);
  await db.query(`update profiles set account_status = 'suspended' where id = $1`, [suspended.id]);
  await db.query(`insert into record_shares (resource_type, resource_id, owner_id, recipient_id) values ('contact', gen_random_uuid(), $1, $2)`, [owner.id, recipient.id]);
  const people = await rpc('persora_table_people', { p_owner: owner.id });
  assert.equal(people[0].id, owner.id);
  assert.equal(people[0].me, true);
  const ids = people.map((person) => person.id);
  assert.ok(ids.includes(teammate.id));
  assert.ok(ids.includes(recipient.id));
  assert.ok(!ids.includes(stranger.id));
  assert.ok(!ids.includes(suspended.id));
  assert.deepEqual(Object.keys(people[1]).sort(), ['id', 'me', 'name']);
  assert.deepEqual((await rpc('persora_table_people', { p_owner: stranger.id })).map((person) => person.id), [stranger.id]);
});
