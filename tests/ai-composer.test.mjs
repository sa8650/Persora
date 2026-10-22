import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

const source = await readFile(new URL('../src/lib/password-generator.ts', import.meta.url), 'utf8');
const js = (await transform(source, { loader: 'ts', format: 'esm', target: 'es2022' })).code;
const gen = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

const CANDIDATES = ['amber horizon', 'quiet thunder', 'ember tide', 'silver dawn'];

test('composeAiPassword uses candidate material within the target window', () => {
  const opts = { style: 'poetic', length: 18, capitalize: true, addNumber: false, addSymbol: false };
  for (let run = 0; run < 40; run += 1) {
    const value = gen.composeAiPassword(CANDIDATES, opts);
    assert.ok(value.length >= 8 && value.length <= 22, `length ${value.length} out of window`);
    const normalized = value.toLowerCase().replace(/[\s._-]+/g, ' ');
    assert.ok(CANDIDATES.some((c) => normalized.includes(c)), `no candidate material in ${value}`);
  }
});

test('composeAiPassword inserts numbers and symbols only when requested', () => {
  const withExtras = { style: 'sonnet', length: 20, capitalize: true, addNumber: true, addSymbol: true };
  const without = { style: 'sonnet', length: 20, capitalize: true, addNumber: false, addSymbol: false };
  let sawDigit = false;
  let sawSymbol = false;
  for (let run = 0; run < 80; run += 1) {
    const value = gen.composeAiPassword(CANDIDATES, withExtras);
    if (/\d/.test(value)) sawDigit = true;
    if (/[!@#$%&]/.test(value)) sawSymbol = true;
    const plain = gen.composeAiPassword(CANDIDATES, without);
    assert.ok(!/\d/.test(plain), `digit leaked into no-number output: ${plain}`);
    assert.ok(!/[!@#$%&]/.test(plain), `symbol leaked into no-symbol output: ${plain}`);
  }
  assert.ok(sawDigit && sawSymbol, 'number and symbol insertion were never exercised');
});

test('composeAiPassword outputs vary (randomness comes from local crypto, not the AI)', () => {
  const opts = { style: 'rhythmic', length: 16, capitalize: true, addNumber: true, addSymbol: false };
  const unique = new Set(Array.from({ length: 40 }, () => gen.composeAiPassword(CANDIDATES, opts)));
  assert.ok(unique.size >= 10, `only ${unique.size} unique outputs across 40 runs`);
});

test('composeAiPassword throws on unusable candidates so the caller can fall back', () => {
  assert.throws(() => gen.composeAiPassword([], { style: 'poetic', length: 16, capitalize: true, addNumber: true, addSymbol: false }));
  assert.throws(() => gen.composeAiPassword(['a', '  '], { style: 'poetic', length: 16, capitalize: true, addNumber: true, addSymbol: false }));
});

test('generateAiLocalFallback produces valid output for every AI style', () => {
  for (const style of ['rhythmic', 'pronounceable', 'poetic', 'sonnet', 'passphrase']) {
    for (let run = 0; run < 10; run += 1) {
      const value = gen.generateAiLocalFallback({ style, length: 18, capitalize: true, addNumber: true, addSymbol: true });
      assert.ok(value.length >= 10, `${style} fallback too short: ${value}`);
      const report = gen.evaluateStrength(value, style === 'rhythmic' || style === 'pronounceable' ? { kind: 'pronounceable' } : { kind: 'passphrase' });
      assert.ok(report.bits > 20, `${style} fallback too weak (${report.bits} bits)`);
    }
  }
});

test('AI mode appears in the generator mode list', () => {
  const ids = gen.GENERATOR_MODES.map((mode) => mode.id);
  assert.deepEqual(ids, ['random', 'memorable', 'rhythm', 'ai']);
});
