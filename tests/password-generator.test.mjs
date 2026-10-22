import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

const source = await readFile(new URL('../src/lib/password-generator.ts', import.meta.url), 'utf8');
const js = (await transform(source, { loader: 'ts', format: 'esm', target: 'es2022' })).code;
const gen = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

const AMBIGUOUS = new Set('l1IO0o|'.split(''));
const WORDS = gen.WORDS;

test('random generator honours length, enabled classes and guarantees coverage', () => {
  for (let run = 0; run < 80; run += 1) {
    const value = gen.generateRandom({ length: 20, upper: true, lower: true, digits: true, symbols: true, excludeAmbiguous: false });
    assert.equal(value.length, 20);
    assert.match(value, /[a-z]/);
    assert.match(value, /[A-Z]/);
    assert.match(value, /\d/);
    assert.match(value, /[^A-Za-z0-9]/);
  }
});

test('random generator restricts to the selected classes only', () => {
  for (let run = 0; run < 50; run += 1) {
    const value = gen.generateRandom({ length: 12, upper: false, lower: true, digits: true, symbols: false, excludeAmbiguous: false });
    assert.match(value, /^[a-z0-9]{12}$/);
  }
});

test('random generator can exclude ambiguous characters in every class', () => {
  for (let run = 0; run < 120; run += 1) {
    const value = gen.generateRandom({ length: 24, upper: true, lower: true, digits: true, symbols: true, excludeAmbiguous: true });
    for (const char of value) assert.ok(!AMBIGUOUS.has(char), `ambiguous ${char} in ${value}`);
  }
});

test('memorable generator uses wordlist words, separators and word count', () => {
  const wordSet = new Set(WORDS.map((word) => word.toLowerCase()));
  for (let run = 0; run < 50; run += 1) {
    const value = gen.generateMemorable({ wordCount: 5, capitalization: 'lower', separator: '-', addNumber: false, addSymbol: false });
    const parts = value.split('-');
    assert.equal(parts.length, 5, value);
    for (const part of parts) assert.ok(wordSet.has(part), `unknown word ${part}`);
  }
  const capitalized = gen.generateMemorable({ wordCount: 3, capitalization: 'capital', separator: '_', addNumber: false, addSymbol: false });
  assert.match(capitalized, /^[A-Z][a-z]+_[A-Z][a-z]+_[A-Z][a-z]+$/);
  const upper = gen.generateMemorable({ wordCount: 2, capitalization: 'upper', separator: '.', addNumber: false, addSymbol: false });
  assert.match(upper, /^[A-Z]+\.[A-Z]+$/);
  const withNumber = gen.generateMemorable({ wordCount: 3, capitalization: 'lower', separator: '-', addNumber: true, addSymbol: false });
  assert.match(withNumber, /\d{2}/, withNumber);
  const withSymbol = gen.generateMemorable({ wordCount: 3, capitalization: 'lower', separator: '-', addNumber: false, addSymbol: true });
  assert.ok(/[!@#$%&]/.test(withSymbol), withSymbol);
});

test('rhythm generator hits the exact length and stays pronounceable', () => {
  const vowels = (value) => (value.match(/[aeiou]/g) || []).length / value.length;
  for (let run = 0; run < 80; run += 1) {
    const value = gen.generateRhythm({ length: 14, pattern: 'syllable', capitalize: false, addNumber: false, addSymbol: false });
    assert.equal(value.length, 14);
    assert.match(value, /^[a-z]+$/);
    assert.ok(vowels(value) > 0.25 && vowels(value) < 0.75, `vowel ratio ${vowels(value)} in ${value}`);
  }
  const alternating = gen.generateRhythm({ length: 12, pattern: 'alternating', capitalize: false, addNumber: false, addSymbol: false });
  assert.match(alternating, /^[a-z]{12}$/);
  const capital = gen.generateRhythm({ length: 10, pattern: 'syllable', capitalize: true, addNumber: false, addSymbol: false });
  assert.match(capital, /^[A-Z][a-z]{9}$/);
  const extras = gen.generateRhythm({ length: 12, pattern: 'syllable', capitalize: false, addNumber: true, addSymbol: true });
  assert.match(extras, /\d/);
  assert.ok(/[!@#$%&]/.test(extras), extras);
});

test('strength meter flags known common passwords as weak', () => {
  for (const weak of ['password', 'P@ssw0rd', '123456', 'qwerty123!']) {
    const report = gen.evaluateStrength(weak);
    assert.equal(report.level, 'weak', `${weak} → ${report.level}`);
    assert.ok(report.tips.length > 0);
  }
});

test('strength meter penalizes sequences and repetition honestly', () => {
  const sequenceReport = gen.evaluateStrength('abcdefgh12345');
  assert.ok(['weak', 'fair'].includes(sequenceReport.level), sequenceReport.level);
  assert.ok(sequenceReport.issues.some((issue) => /ordered|sequences?|runs/i.test(issue)));
  const repeatReport = gen.evaluateStrength('aaaaaaaaaaaaaaaaaa');
  assert.equal(repeatReport.level, 'weak');
  const chunkReport = gen.evaluateStrength('abc abc XYZ abc XYZ 9'.replace(/ /g, ''));
  assert.ok(chunkReport.issues.length > 0);
});

test('strength meter scores long generated values above weak, with guidance', () => {
  const longPassphrase = gen.generateMemorable({ wordCount: 6, capitalization: 'lower', separator: 'random', addNumber: true, addSymbol: false });
  const report = gen.evaluateStrength(longPassphrase, { kind: 'passphrase' });
  assert.ok(['fair', 'strong', 'very-strong'].includes(report.level), `${longPassphrase} → ${report.level}`);
  const veryRandom = gen.generateRandom({ length: 20, upper: true, lower: true, digits: true, symbols: true, excludeAmbiguous: false });
  const strongReport = gen.evaluateStrength(veryRandom);
  assert.ok(['strong', 'very-strong'].includes(strongReport.level), strongReport.level);
  assert.ok(strongReport.tips.length > 0);
});

test('rhythm passwords are scored below fully random strings of the same length', () => {
  const rhythm = gen.generateRhythm({ length: 16, pattern: 'syllable', capitalize: true, addNumber: true, addSymbol: true });
  const rhythmBits = gen.evaluateStrength(rhythm, { kind: 'pronounceable' }).bits;
  const random = gen.generateRandom({ length: 16, upper: true, lower: true, digits: true, symbols: true, excludeAmbiguous: false });
  const randomBits = gen.evaluateStrength(random).bits;
  assert.ok(rhythmBits < randomBits, `${rhythmBits} !< ${randomBits}`);
  assert.ok(!gen.evaluateStrength(rhythm, { kind: 'pronounceable' }).common);
});

test('empty input stays weak with a prompt to generate', () => {
  const report = gen.evaluateStrength('');
  assert.equal(report.level, 'weak');
  assert.match(report.tips[0], /generate/i);
});
