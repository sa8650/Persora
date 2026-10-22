import worker from "../../cloudflare/api.js";

// Route /api/* on the Pages origin into Persora's authenticated API.
// Runtime variables, secrets, and the VAULT_FILES R2 binding come from Pages settings.
// The execution context is forwarded so the worker can finish background work
// (trash purge sweeps) after the response with waitUntil.
export function onRequest(context) {
  return worker.fetch(context.request, context.env, context);
}
