import test from 'node:test';
import assert from 'node:assert/strict';

const { resolveAiControls, allAiDisabled, DEFAULT_AI_CONTROLS, AI_CONTROLS_SETTING_KEY } = await import('../cloudflare/ai-controls.js');
const { sanitizeProjectInput, sanitizeFieldPayload, ProjectError } = await import('../cloudflare/projects.js');

test('resolveAiControls defaults every AI surface to enabled', () => {
  assert.deepEqual(resolveAiControls(undefined), { passwordSuggestions: true, smartScanOcr: true, smartScanExtraction: true });
  assert.deepEqual(resolveAiControls(null), DEFAULT_AI_CONTROLS);
  assert.equal(AI_CONTROLS_SETTING_KEY, 'ai_controls');
});

test('resolveAiControls merges stored booleans and ignores junk', () => {
  const out = resolveAiControls({ passwordSuggestions: false, smartScanOcr: 'no', extra: true });
  assert.deepEqual(out, { passwordSuggestions: false, smartScanOcr: true, smartScanExtraction: true });
  assert.deepEqual(resolveAiControls([]), DEFAULT_AI_CONTROLS);
  assert.equal(resolveAiControls('nope').smartScanExtraction, true);
});

test('allAiDisabled only true when every switch is off', () => {
  assert.equal(allAiDisabled({ passwordSuggestions: false, smartScanOcr: false, smartScanExtraction: false }), true);
  assert.equal(allAiDisabled(resolveAiControls({ smartScanOcr: false })), false);
});

test('sanitizeProjectInput validates name/kind and trims', () => {
  const ok = sanitizeProjectInput({ name: '  Website relaunch ', description: 'Ship it', kind: 'shared' });
  assert.deepEqual(ok, { name: 'Website relaunch', description: 'Ship it', kind: 'shared' });
  assert.equal(sanitizeProjectInput({ name: 'Solo' }).kind, 'personal');
  assert.equal(sanitizeProjectInput({ name: 'Solo', kind: 'weird' }).kind, 'personal');
  assert.throws(() => sanitizeProjectInput({ name: ' ' }), ProjectError);
  assert.throws(() => sanitizeProjectInput({ name: 'x'.repeat(121) }), ProjectError);
});

test('sanitizeFieldPayload enforces title requirement and field shapes', () => {
  assert.throws(() => sanitizeFieldPayload({}, { requireTitle: true }), ProjectError);
  assert.throws(() => sanitizeFieldPayload({ title: '' }, { requireTitle: true }), ProjectError);
  assert.throws(() => sanitizeFieldPayload({ title: 'x'.repeat(161) }), ProjectError);
  const field = sanitizeFieldPayload({ title: ' Copy refresh ', status: 'in-progress', progress: 160, dueDate: '2026-11-01' });
  assert.equal(field.title, 'Copy refresh');
  assert.equal(field.progress, 100);
  assert.equal(field.due_date, '2026-11-01');
  assert.throws(() => sanitizeFieldPayload({ title: 'T', status: 'nope' }), ProjectError);
  assert.throws(() => sanitizeFieldPayload({ title: 'T', folderId: 'not-a-uuid' }), ProjectError);
  assert.throws(() => sanitizeFieldPayload({ title: 'T', dueDate: '2026-13-99' }), ProjectError);
});

test('sanitizeFieldPayload keeps explicit clears and omits absent keys', () => {
  const payload = sanitizeFieldPayload({ folderId: null, assigneeId: '', dueDate: null });
  assert.ok('folder_id' in payload && payload.folder_id === '');
  assert.ok('assignee_id' in payload && payload.assignee_id === '');
  assert.ok('due_date' in payload && payload.due_date === '');
  const partial = sanitizeFieldPayload({ progress: 40 });
  assert.deepEqual(Object.keys(partial), ['progress']);
});
