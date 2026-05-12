// Re-run the extraction pipeline for a single source document by ID.
// Usage: tsx scripts/run-pipeline.ts <sourceDocumentId>

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { processDocument } from '../src/lib/extraction/process-document';

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error('Usage: tsx scripts/run-pipeline.ts <sourceDocumentId>');
    process.exit(1);
  }
  console.log(`Running pipeline for source document ${id}…`);
  await processDocument(id);
  console.log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
