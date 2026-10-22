import test from 'node:test';
import assert from 'node:assert/strict';

const mod = await import('../cloudflare/ai-password.js');
const { sanitizeAiPasswordCandidates, validateAiPasswordRequest, aiPasswordCandidates, AIPasswordError, AI_PASSWORD_STYLES } = mod;

test('sanitizer dedupes, trims, and normalizes whitespace', () => {
  const out = sanitizeAiPasswordCandidates(['amber horizon', 'Amber Horizon', '  drift  swift ', 'veratilo', 'Sortilune Rainflight']);
  assert.deepEqual(out, ['amber horizon', 'drift swift', 'veratilo', 'Sortilune Rainflight']);
});

test('sanitizer rejects control characters, markup, non-strings, and bad lengths', () => {
  const out = sanitizeAiPasswordCandidates([
    'ab',                         // too short
    'x'.repeat(80),                // too long
    123, null, {},                 // non-strings
    '<script>alert(1)</script>',   // markup
    'emoji 😀 password',           // emoji
    'bad',              // control chars stripped hello? -> 'bad' is only 3 chars -> dropped
    '9led with digit',             // must start with a letter
    'ok.dots-here',                // valid
  ]);
  assert.deepEqual(out, ['ok.dots-here']);
});

test('sanitizer caps the number of candidates', () => {
  const many = Array.from({ length: 30 }, (_, i) => `candidate-${i}`);
  const out = sanitizeAiPasswordCandidates(many, { maxCount: 6 });
  assert.equal(out.length, 6);
});

test('request validation enforces styles, count and length bounds', () => {
  assert.throws(() => validateAiPasswordRequest({ style: 'nonsense' }), AIPasswordError);
  assert.deepEqual(validateAiPasswordRequest({ style: 'poetic', count: '4', maxLength: '700' }), { style: 'poetic', count: 4, maxLength: 32 });
  assert.deepEqual(validateAiPasswordRequest({ style: 'passphrase', count: 99, maxLength: 3 }), { style: 'passphrase', count: 4, maxLength: 32 });
  assert.equal(AI_PASSWORD_STYLES.size, 5);
});

test('AI candidates fail closed (503) when the AI binding is missing', async () => {
  await assert.rejects(() => aiPasswordCandidates({}, { style: 'rhythmic', count: 4, maxLength: 24 }), (error) => error instanceof AIPasswordError && error.status === 503);
});

test('AI candidates fail closed (503) when the model returns unusable output', async () => {
  const fakeEnv = { AI: { run: async () => ({ response: 'not json at all' }) } };
  await assert.rejects(() => aiPasswordCandidates(fakeEnv, { style: 'sonnet', count: 4, maxLength: 24 }), (error) => error instanceof AIPasswordError && error.status === 503);
});

test('AI candidates sanitize wrapped/prose model output before returning', async () => {
  const fakeEnv = { AI: { run: async () => ({ response: '```json\n{"candidates": ["amber horizon", "<b>evil</b>", "quiet thunder"]}\n```' }) } };
  const out = await aiPasswordCandidates(fakeEnv, { style: 'poetic', count: 4, maxLength: 24 });
  assert.deepEqual(out, ['amber horizon', 'quiet thunder']);
});

test('successful Workers AI response with neuron usage reaches candidate output', async () => {
  let requestedModel = '';
  const fakeEnv = { AI: { run: async (model, options) => {
    requestedModel = model;
    assert.equal(options.response_format.type, 'json_object');
    return { response: '{"candidates":["quiet thunder","amber horizon"]}', usage: { neuron_count: 12 } };
  } } };
  const out = await aiPasswordCandidates(fakeEnv, { style: 'poetic', count: 2, maxLength: 24 });
  assert.equal(requestedModel, mod.AI_PASSWORD_MODEL);
  assert.deepEqual(out, ['quiet thunder', 'amber horizon']);
});

test('Workers AI candidate parser handles compatible response envelopes', async () => {
  const fakeEnv = { AI: { run: async () => ({ choices: [{ message: { content: '{"candidates":["cobalt river lantern"]}' } }] }) } };
  assert.deepEqual(await aiPasswordCandidates(fakeEnv, { style: 'passphrase', count: 1, maxLength: 32 }), ['cobalt river lantern']);
});

test('Workers AI provider failure preserves a useful fallback reason', async () => {
  const fakeEnv = { AI: { run: async () => { throw new Error('rate limited'); } } };
  await assert.rejects(() => aiPasswordCandidates(fakeEnv, { style: 'rhythmic', count: 4, maxLength: 24 }), (error) => error instanceof AIPasswordError && error.status === 503 && /Cloudflare Workers AI did not complete/.test(error.message));
});
