// Keeps the local stack running for manual checks: node tests/e2e/serve.mjs [stopBeforeMigration]
import { startDatabase, startApp, APP_PORT } from './local-stack.mjs';
const { pending } = await startDatabase({ stopBefore: process.argv[2] });
await startApp();
console.log(`Persora local stack on http://127.0.0.1:${APP_PORT} (pending migrations: ${pending.join(', ') || 'none'})`);
setInterval(() => {}, 1 << 30);
