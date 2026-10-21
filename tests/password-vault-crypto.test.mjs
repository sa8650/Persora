import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

const source = await readFile(new URL('../src/lib/password-vault-crypto.ts', import.meta.url), 'utf8');
const js = (await transform(source, { loader: 'ts', format: 'esm', target: 'es2022' })).code;
const vault = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const sample = [{ id: 'a1', title: 'Email', login: 'user@example.test', password: 'not-for-real-use', url: '', notes: '', questions: [], folder: '', favorite: false, pinned: false, updated: 1 }];

test('new vault requires confirmation-capable recovery key and unlocks with master password', async () => {
 const created = await vault.createVault(sample, 'correct horse battery staple');
 assert.equal(created.recoveryKey.length, 43);
 assert.deepEqual((await vault.unlockVault(JSON.stringify(created.envelope), 'correct horse battery staple')).entries, sample);
});

test('recovery key decrypts entries; invalid recovery key fails authentication', async () => {
 const created = await vault.createVault(sample, 'master password 123');
 assert.deepEqual(await vault.recoverVault(JSON.stringify(created.envelope), created.recoveryKey), sample);
 await assert.rejects(vault.recoverVault(JSON.stringify(created.envelope), 'invalid recovery key'), /operation|decrypt|AES/i);
});

test('re-wrap changes only the master-key wrap and preserves encrypted vault payload', async () => {
 const created = await vault.createVault(sample, 'master password 123');
 const before = JSON.stringify(created.envelope);
 const updated = await vault.rewrapMaster(before, created.recoveryKey, 'new master password 456');
 assert.equal(updated.dataIv, created.envelope.dataIv);
 assert.equal(updated.dataCiphertext, created.envelope.dataCiphertext);
 assert.equal(updated.recoveryWrap, created.envelope.recoveryWrap);
 assert.deepEqual((await vault.unlockVault(JSON.stringify(updated), 'new master password 456')).entries, sample);
 await assert.rejects(vault.unlockVault(JSON.stringify(updated), 'master password 123'));
});

test('invalid/tampered ciphertext is rejected without mutating the input envelope', async () => {
 const created = await vault.createVault(sample, 'master password 123');
 const before = JSON.stringify(created.envelope);
 const tampered = { ...created.envelope, dataCiphertext: created.envelope.dataCiphertext.slice(0, -2) + 'AA' };
 await assert.rejects(vault.recoverVault(JSON.stringify(tampered), created.recoveryKey));
 assert.equal(JSON.stringify(created.envelope), before);
});

test('legacy v1 vault decrypts for migration but remains explicitly unconfigured for recovery', async () => {
 const enc = new TextEncoder(); const salt = crypto.getRandomValues(new Uint8Array(16));
 const material = await crypto.subtle.importKey('raw', enc.encode('legacy password'), 'PBKDF2', false, ['deriveKey']);
 const key = await crypto.subtle.deriveKey({ name:'PBKDF2', salt, iterations:310000, hash:'SHA-256' }, material, { name:'AES-GCM', length:256 }, false, ['encrypt']);
 const iv = crypto.getRandomValues(new Uint8Array(12)); const cipher = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, enc.encode(JSON.stringify(sample)));
 const legacy = JSON.stringify({ salt:btoa(String.fromCharCode(...salt)), iv:btoa(String.fromCharCode(...iv)), cipher:btoa(String.fromCharCode(...new Uint8Array(cipher))) });
 const unlocked = await vault.unlockVault(legacy, 'legacy password');
 assert.deepEqual(unlocked.entries, sample); assert.equal(unlocked.envelope, null);
 await assert.rejects(vault.recoverVault(legacy, vault.generateRecoveryKey()), /not completed/);
});
