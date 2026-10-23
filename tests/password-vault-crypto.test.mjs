import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = await build({
  stdin: { contents: `export * from './src/lib/password-vault-crypto.ts'; export * as legacy from './src/lib/password-vault-legacy.ts';`, resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false,
});
const file = join(await mkdtemp(join(tmpdir(), 'persora-vault-crypto-')), 'crypto.mjs');
await writeFile(file, out.outputFiles[0].text);
const vault = await import(pathToFileURL(file).href);

const userId = '7d1c2f0e-1111-4222-8333-944455556666';
const sample = { id: '0b5f3c1e-2b7a-4c1d-9e8f-1a2b3c4d5e6f', title: 'Email', login: 'user@example.test', password: 'not-for-real-use', url: '', notes: '', questions: [], folder: '', favorite: false, pinned: false, updated: 1 };
const escrowPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const escrowJwk = await crypto.subtle.exportKey('jwk', escrowPair.publicKey);
const escrowKey = { keyId: 'test-escrow-key-01', publicKey: { kty: 'EC', crv: 'P-256', x: escrowJwk.x, y: escrowJwk.y } };

async function freshVault(password = 'correct horse battery staple', generation = 1) {
  const dekRaw = vault.generateDek();
  const material = await vault.createKeyMaterial({ userId, generation, password, dekRaw: new Uint8Array(dekRaw), escrowKey });
  return { dekRaw, material, info: { ...material, keyGeneration: generation } };
}

test('master password unwraps the vault key with Argon2id defaults; wrong password is a typed error', async () => {
  const { material, info } = await freshVault();
  assert.deepEqual(material.kdf, { algorithm: 'argon2id', version: 19, memoryKiB: 65536, iterations: 3, parallelism: 1 });
  assert.equal(Buffer.from(material.salt, 'base64').length, 16);
  const { dek } = await vault.unwrapDek(userId, info, 'correct horse battery staple');
  const sealed = await vault.encryptEntry(dek, userId, 1, sample);
  assert.deepEqual(await vault.decryptEntry(dek, userId, 1, sample.id, sealed), sample);
  await assert.rejects(vault.unwrapDek(userId, info, 'correct horse battery stapl3'), (error) => error.name === 'WrongMasterPasswordError');
});

test('AES-GCM additional data binds ciphertext to member, entry id and key generation', async () => {
  const { info } = await freshVault();
  const { dek } = await vault.unwrapDek(userId, info, 'correct horse battery staple');
  const sealed = await vault.encryptEntry(dek, userId, 1, sample);
  await assert.rejects(vault.decryptEntry(dek, '00000000-0000-4000-8000-000000000000', 1, sample.id, sealed), (e) => e.name === 'VaultIntegrityError');
  await assert.rejects(vault.decryptEntry(dek, userId, 1, '11111111-1111-4111-8111-111111111111', sealed), (e) => e.name === 'VaultIntegrityError');
  await assert.rejects(vault.decryptEntry(dek, userId, 2, sample.id, sealed), (e) => e.name === 'VaultIntegrityError');
  const tampered = { ...sealed, ciphertext: sealed.ciphertext.slice(0, -4) + (sealed.ciphertext.endsWith('AAAA') ? 'BBBB' : 'AAAA') };
  await assert.rejects(vault.decryptEntry(dek, userId, 1, sample.id, tampered), (e) => e.name === 'VaultIntegrityError');
  // The wrapped key is bound to its generation too.
  await assert.rejects(vault.unwrapDek(userId, { ...info, keyGeneration: 2 }, 'correct horse battery staple'), (e) => e.name === 'WrongMasterPasswordError');
});

test('escrow copy opens only with the escrow private key and the right context', async () => {
  const { dekRaw, material } = await freshVault();
  const opened = await vault.eciesOpen(escrowPair.privateKey, material.escrow, vault.aad.escrow(userId, 1, escrowKey.keyId), vault.ESCROW_INFO);
  assert.deepEqual([...opened], [...dekRaw]);
  const other = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  await assert.rejects(vault.eciesOpen(other.privateKey, material.escrow, vault.aad.escrow(userId, 1, escrowKey.keyId), vault.ESCROW_INFO));
  await assert.rejects(vault.eciesOpen(escrowPair.privateKey, material.escrow, vault.aad.escrow(userId, 2, escrowKey.keyId), vault.ESCROW_INFO));
  assert.equal(Buffer.from(material.escrow.ciphertext, 'base64').length, 48);
});

test('recovery transport delivers the key only to the requesting browser key pair', async () => {
  const dekRaw = vault.generateDek();
  const browser = await vault.createTransportKeyPair();
  assert.equal(browser.publicKey.d, undefined, 'only the public half is sent');
  const blob = await vault.eciesSeal(browser.publicKey, dekRaw, vault.aad.transport(userId, 3), vault.TRANSPORT_INFO);
  assert.deepEqual([...(await vault.openTransport(browser.privateKey, userId, 3, blob))], [...dekRaw]);
  const eavesdropper = await vault.createTransportKeyPair();
  await assert.rejects(vault.openTransport(eavesdropper.privateKey, userId, 3, blob));
});

test('weak or unknown KDF settings are refused', async () => {
  for (const kdf of [{ ...vault.DEFAULT_KDF, memoryKiB: 4096 }, { ...vault.DEFAULT_KDF, iterations: 1 }, { ...vault.DEFAULT_KDF, algorithm: 'pbkdf2' }]) {
    assert.throws(() => vault.assertKdf(kdf), /unsupported key-derivation/);
  }
  assert.doesNotThrow(() => vault.assertKdf(vault.DEFAULT_KDF));
});

test('legacy on-device formats are still readable for migration', async () => {
  const enc = new TextEncoder(); const salt = crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey('raw', enc.encode('legacy password'), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12)); const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify([sample])));
  const b64 = (u) => Buffer.from(u).toString('base64');
  const v1 = JSON.stringify({ salt: b64(salt), iv: b64(iv), cipher: b64(new Uint8Array(cipher)) });
  assert.deepEqual(await vault.legacy.unlockLegacyVault(v1, 'legacy password'), [sample]);
  await assert.rejects(vault.legacy.unlockLegacyVault(v1, 'wrong legacy password'));
  assert.equal(vault.legacy.legacyHasRecoveryKey(v1), false);
  await assert.rejects(vault.legacy.recoverLegacyVault(v1, 'anything'), /before recovery keys/);
});
