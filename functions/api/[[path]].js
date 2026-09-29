import worker from "../../cloudflare/api.js";

// Route /api/* on the Pages origin into Persora's authenticated API.
// Runtime variables, secrets, and the VAULT_FILES R2 binding come from Pages settings.
export function onRequest({ request, env }) {
  return worker.fetch(request, env);
}
