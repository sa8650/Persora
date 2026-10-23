// FROZEN COPY of the retired src/lib/password-vault-crypto.ts (commit 242752c), used
// only by tests/password-vault-migration.test.mjs to produce records exactly as the
// encrypted release stored them. Not shipped; delete together with the migration.
// Persora Password Manager cryptography (vault format v3). Runs in the browser.
//
//   master password ──Argon2id(salt, m=64 MiB, t=3, p=1)──▶ KEK (AES-256-GCM)
//   random 256-bit vault key (DEK) ──wrapped by KEK──▶ wrappedDek
//   DEK ──AES-256-GCM, one record per login──▶ item ciphertexts
//   DEK ──ECIES to the server escrow public key──▶ escrow (trusted email recovery)
//
// Every ciphertext is bound with AES-GCM additional data to the member id, the
// record id and the key generation, so records can't be swapped between users,
// entries or key generations without failing authentication. Plaintext entries,
// the master password and the raw vault key never leave the browser in normal
// use. The escrow copy can be opened by the Persora server (only after an
// emailed one-time code), which is why recovery is a *trusted* mechanism and
// the vault is not zero-knowledge. See PASSWORD_VAULT_RECOVERY.md.

export type VaultEntry = { id:string; title:string; login:string; password:string; url:string; notes:string; questions:{question:string;answer:string}[]; folder:string; favorite:boolean; pinned:boolean; updated:number; trash?:{deletedAt:number;expiresAt:number} };

export type KdfParams = { algorithm: "argon2id"; version: 19; memoryKiB: number; iterations: number; parallelism: number };
export type Sealed = { iv: string; ciphertext: string };
export type EciesBlob = { alg: "ECDH-P256+HKDF-SHA256+A256GCM"; epk: string; salt: string; iv: string; ciphertext: string };
export type EscrowPublicKey = { keyId: string; publicKey: JsonWebKey };
/** Everything the server stores to let the master password (or escrow) unlock the vault. */
export type VaultKeyMaterial = { kdf: KdfParams; salt: string; wrappedDek: Sealed; keyCheck: Sealed; escrow: EciesBlob | null; escrowKeyId: string | null };
/** Server-side vault metadata (no escrow blob is ever sent to the browser). */
export type VaultKeyInfo = Pick<VaultKeyMaterial, "kdf" | "salt" | "wrappedDek" | "keyCheck"> & { keyGeneration: number; escrowKeyId: string | null };

export const DEFAULT_KDF: KdfParams = { algorithm: "argon2id", version: 19, memoryKiB: 65536, iterations: 3, parallelism: 1 };
export const MASTER_PASSWORD_MIN_LENGTH = 10;
export const KEY_CHECK_PLAINTEXT = "persora-vault-key-check-v1";
export const ESCROW_INFO = "persora-vault-escrow-v1";
export const TRANSPORT_INFO = "persora-vault-recovery-transport-v1";
const ECIES_ALG = "ECDH-P256+HKDF-SHA256+A256GCM" as const;

export const aad = {
  dek: (userId: string, generation: number) => `persora-vault/dek/v1|${userId}|${generation}`,
  check: (userId: string, generation: number) => `persora-vault/check/v1|${userId}|${generation}`,
  item: (userId: string, generation: number, itemId: string) => `persora-vault/item/v1|${userId}|${generation}|${itemId}`,
  escrow: (userId: string, generation: number, keyId: string) => `persora-vault/escrow/v1|${userId}|${generation}|${keyId}`,
  transport: (userId: string, generation: number) => `persora-vault/recovery/v1|${userId}|${generation}`,
};

export class WrongMasterPasswordError extends Error {
  constructor() { super("Unable to unlock. Check your master password."); this.name = "WrongMasterPasswordError"; }
}
export class VaultIntegrityError extends Error {
  constructor(message = "Part of your vault couldn't be decrypted. Nothing was changed.") { super(message); this.name = "VaultIntegrityError"; }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const bytes = (value: ArrayBuffer | Uint8Array) => new Uint8Array(value instanceof Uint8Array ? value : new Uint8Array(value));
export function toBase64(data: Uint8Array): string {
  let text = "";
  for (let offset = 0; offset < data.length; offset += 0x8000) text += String.fromCharCode(...data.subarray(offset, offset + 0x8000));
  return btoa(text);
}
export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
export const randomBytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));

/** Rejects parameters weaker than OWASP's Argon2id minimum or absurdly large. */
export function assertKdf(kdf: KdfParams): KdfParams {
  const ok = kdf && kdf.algorithm === "argon2id" && kdf.version === 19
    && Number.isInteger(kdf.memoryKiB) && kdf.memoryKiB >= 19456 && kdf.memoryKiB <= 1048576
    && Number.isInteger(kdf.iterations) && kdf.iterations >= 2 && kdf.iterations <= 20
    && Number.isInteger(kdf.parallelism) && kdf.parallelism >= 1 && kdf.parallelism <= 8;
  if (!ok) throw new Error("This vault uses unsupported key-derivation settings.");
  return kdf;
}

async function argon2idKey(password: string, salt: Uint8Array, kdf: KdfParams): Promise<CryptoKey> {
  assertKdf(kdf);
  const { argon2id } = await import("hash-wasm"); // ~30 KB WASM, loaded only when the vault opens
  const derived = await argon2id({ password: password.normalize("NFC"), salt, parallelism: kdf.parallelism, iterations: kdf.iterations, memorySize: kdf.memoryKiB, hashLength: 32, outputType: "binary" });
  try {
    return await crypto.subtle.importKey("raw", new Uint8Array(derived), "AES-GCM", false, ["encrypt", "decrypt"]);
  } finally { derived.fill(0); }
}

export async function importDek(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== 32) throw new VaultIntegrityError("The vault key has an invalid length.");
  return crypto.subtle.importKey("raw", new Uint8Array(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function seal(key: CryptoKey, plaintext: Uint8Array, additional: string): Promise<Sealed> {
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(additional) }, key, new Uint8Array(plaintext));
  return { iv: toBase64(iv), ciphertext: toBase64(bytes(ciphertext)) };
}
async function open(key: CryptoKey, sealed: Sealed, additional: string): Promise<Uint8Array> {
  return bytes(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(sealed.iv), additionalData: encoder.encode(additional) }, key, fromBase64(sealed.ciphertext)));
}

// ── ECIES (escrow + recovery transport) ─────────────────────────────────────
async function eciesKey(privateKey: CryptoKey, publicKey: CryptoKey, salt: Uint8Array, info: string, usage: KeyUsage): Promise<CryptoKey> {
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  const hkdf = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(salt), info: encoder.encode(info) }, hkdf, { name: "AES-GCM", length: 256 }, false, [usage]);
}
export async function eciesSeal(recipient: JsonWebKey, plaintext: Uint8Array, additional: string, info: string): Promise<EciesBlob> {
  const publicKey = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: recipient.x, y: recipient.y, ext: true }, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const salt = randomBytes(16);
  const key = await eciesKey(ephemeral.privateKey, publicKey, salt, info, "encrypt");
  const sealed = await seal(key, plaintext, additional);
  return { alg: ECIES_ALG, epk: toBase64(bytes(await crypto.subtle.exportKey("raw", ephemeral.publicKey))), salt: toBase64(salt), iv: sealed.iv, ciphertext: sealed.ciphertext };
}
export async function eciesOpen(privateKey: CryptoKey, blob: EciesBlob, additional: string, info: string): Promise<Uint8Array> {
  if (!blob || blob.alg !== ECIES_ALG) throw new VaultIntegrityError("Unsupported recovery envelope.");
  const publicKey = await crypto.subtle.importKey("raw", fromBase64(blob.epk), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const key = await eciesKey(privateKey, publicKey, fromBase64(blob.salt), info, "decrypt");
  return open(key, blob, additional);
}

// ── Vault keys ──────────────────────────────────────────────────────────────
export function generateDek(): Uint8Array { return randomBytes(32); }

/**
 * Wraps a vault key for storage: Argon2id master-password wrap, key-check value
 * and (when the server offers recovery) the escrow copy. `dekRaw` is not kept.
 */
export async function createKeyMaterial(input: { userId: string; generation: number; password: string; dekRaw: Uint8Array; escrowKey: EscrowPublicKey | null; kdf?: KdfParams }): Promise<VaultKeyMaterial> {
  const kdf = assertKdf(input.kdf || DEFAULT_KDF);
  const salt = randomBytes(16);
  const kek = await argon2idKey(input.password, salt, kdf);
  const dek = await importDek(input.dekRaw);
  const wrappedDek = await seal(kek, input.dekRaw, aad.dek(input.userId, input.generation));
  const keyCheck = await seal(dek, encoder.encode(KEY_CHECK_PLAINTEXT), aad.check(input.userId, input.generation));
  const escrow = input.escrowKey ? await sealEscrow(input.escrowKey, input.userId, input.generation, input.dekRaw) : null;
  return { kdf, salt: toBase64(salt), wrappedDek, keyCheck, escrow, escrowKeyId: input.escrowKey?.keyId || null };
}

export function sealEscrow(escrowKey: EscrowPublicKey, userId: string, generation: number, dekRaw: Uint8Array): Promise<EciesBlob> {
  return eciesSeal(escrowKey.publicKey, dekRaw, aad.escrow(userId, generation, escrowKey.keyId), ESCROW_INFO);
}

/** Confirms that a DEK belongs to this vault generation (AES-GCM key check). */
export async function verifyKeyCheck(dek: CryptoKey, userId: string, info: Pick<VaultKeyInfo, "keyCheck" | "keyGeneration">): Promise<void> {
  let plain: Uint8Array;
  try { plain = await open(dek, info.keyCheck, aad.check(userId, info.keyGeneration)); } catch { throw new VaultIntegrityError("The vault key doesn't match this vault."); }
  if (decoder.decode(plain) !== KEY_CHECK_PLAINTEXT) throw new VaultIntegrityError("The vault key doesn't match this vault.");
}

/** Derives the KEK with Argon2id and unwraps the vault key. Wrong password → WrongMasterPasswordError. */
export async function unwrapDek(userId: string, info: VaultKeyInfo, password: string): Promise<{ dek: CryptoKey; dekRaw: Uint8Array }> {
  const kek = await argon2idKey(password, fromBase64(info.salt), info.kdf);
  let dekRaw: Uint8Array;
  try { dekRaw = await open(kek, info.wrappedDek, aad.dek(userId, info.keyGeneration)); } catch { throw new WrongMasterPasswordError(); }
  const dek = await importDek(dekRaw);
  await verifyKeyCheck(dek, userId, info);
  return { dek, dekRaw };
}

// ── Items ───────────────────────────────────────────────────────────────────
export async function encryptEntry(dek: CryptoKey, userId: string, generation: number, entry: VaultEntry): Promise<Sealed> {
  return seal(dek, encoder.encode(JSON.stringify(entry)), aad.item(userId, generation, entry.id));
}
export async function decryptEntry(dek: CryptoKey, userId: string, generation: number, id: string, sealed: Sealed): Promise<VaultEntry> {
  let plain: Uint8Array;
  try { plain = await open(dek, sealed, aad.item(userId, generation, id)); } catch { throw new VaultIntegrityError(); }
  const entry = JSON.parse(decoder.decode(plain)) as VaultEntry;
  if (!entry || entry.id !== id) throw new VaultIntegrityError();
  return entry;
}

// ── Recovery transport ──────────────────────────────────────────────────────
/** Ephemeral key pair the browser sends so the escrowed key is re-sealed to it in transit. */
export async function createTransportKeyPair(): Promise<{ privateKey: CryptoKey; publicKey: JsonWebKey }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { privateKey: pair.privateKey, publicKey: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y } };
}
export async function openTransport(privateKey: CryptoKey, userId: string, generation: number, blob: EciesBlob): Promise<Uint8Array> {
  return eciesOpen(privateKey, blob, aad.transport(userId, generation), TRANSPORT_INFO);
}
