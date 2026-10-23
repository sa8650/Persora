// Generates the Password Manager recovery (escrow) key pair.
//   node scripts/generate-vault-escrow-key.mjs
// Store the printed JWK as the encrypted Cloudflare Pages secret
// PASSWORD_VAULT_ESCROW_PRIVATE_KEY (Production and Preview). Never commit it,
// paste it in chat, or keep it in the database: whoever holds this key plus a
// copy of the database can open vault keys. See PASSWORD_VAULT_RECOVERY.md.
const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const { kty, crv, x, y, d } = await crypto.subtle.exportKey('jwk', pair.privateKey);
process.stdout.write(`${JSON.stringify({ kty, crv, x, y, d })}\n`);
