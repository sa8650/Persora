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
