// Convenience script: prints a sample login flow.
// Auth is just INGEST_PASSWORD env var compared in constant time, so there's
// no DB password to set. This script exists so deployment docs can reference
// a single command.

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

const pw = process.env.INGEST_PASSWORD;
if (!pw) {
  console.error('INGEST_PASSWORD is not set in .env');
  process.exit(1);
}
console.log(
  `INGEST_PASSWORD is set (length ${pw.length}). Visit /login and enter this value.`,
);
console.log(
  'To rotate: edit .env or Coolify env vars, restart container. All existing sessions are invalidated automatically because session_token_hash is overwritten on next /api/login.',
);
