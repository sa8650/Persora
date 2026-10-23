// ONE-TIME MIGRATION — delete after 202610240002 has been applied.
//
// Converts Password Manager records saved by the retired browser-encryption
// release into plain JSON records, using the escrow key that release relied on.
// Same logic as POST /api/password-vault/admin/migrate-legacy (use that route
// instead if you don't have an offline copy of the escrow key: Cloudflare
// encrypted secrets can't be read back, but the deployed Worker can use them).
//
//   SUPABASE_URL=https://<project>.supabase.co \
//   SUPABASE_SECRET_KEY=sb_secret_... \
//   PASSWORD_VAULT_ESCROW_PRIVATE_KEY='{"kty":"EC",...}' \
//   npm run vault:migrate-legacy -- [--dry-run]
//
// Prints counts only — never record contents. Safe to re-run.
import { migrateLegacyVaults } from "../cloudflare/password-vault-legacy-migration.js";

const env = process.env;
const dryRun = process.argv.includes("--dry-run");
const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !secret || !env.PASSWORD_VAULT_ESCROW_PRIVATE_KEY) {
  console.error("Set SUPABASE_URL, SUPABASE_SECRET_KEY and PASSWORD_VAULT_ESCROW_PRIVATE_KEY.");
  process.exit(2);
}
async function rpc(fn, args) {
  const response = await fetch(`${base}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: secret, ...(String(secret).startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${secret}` }) },
    body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error(`${fn} failed with HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.json();
}

const report = await migrateLegacyVaults({ rpc, env, limit: 100, maxVaults: Number.MAX_SAFE_INTEGER, dryRun });
console.log(JSON.stringify(report, null, 2));
if (report.pending > 0 && !dryRun) {
  console.error(`${report.pending} legacy record(s) are still pending. Check the "failed" list (escrow_key_unavailable usually means PASSWORD_VAULT_ESCROW_RETIRED_KEYS is missing an older key).`);
  process.exit(1);
}
