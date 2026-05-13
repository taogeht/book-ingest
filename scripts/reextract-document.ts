// Re-run Marker + vision fallback for a single source document, wiping its
// existing extracted_pages first. Useful while iterating on extraction
// quality — saves re-uploading the PDF.
//
// Usage:
//   tsx scripts/reextract-document.ts <sourceDocumentId> --confirm

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { db } from '../src/lib/db';
import { sourceDocuments, extractedPages } from '../src/lib/db/schema';
import { eq, count } from 'drizzle-orm';
import { extractPages } from '../src/lib/extraction/process-document';

async function main() {
  const id = process.argv[2];
  const confirm = process.argv.includes('--confirm');
  if (!id) {
    console.error('Usage: tsx scripts/reextract-document.ts <sourceDocumentId> --confirm');
    process.exit(1);
  }

  const doc = await db.query.sourceDocuments.findFirst({
    where: eq(sourceDocuments.id, id),
  });
  if (!doc) {
    console.error(`No source document with id ${id}`);
    process.exit(1);
  }

  const [{ value: pageCount }] = await db
    .select({ value: count() })
    .from(extractedPages)
    .where(eq(extractedPages.sourceDocumentId, id));

  console.log(`Source document : ${doc.filename}`);
  console.log(`Project         : ${doc.projectId}`);
  console.log(`Will DELETE     : ${pageCount} extracted_pages rows`);
  console.log(`Will RE-RUN     : Marker + page-image rendering + vision fallback`);
  console.log(`(R2 page images at ingestion-pages/${doc.projectId}/${doc.id}/ will be overwritten)`);
  if (!confirm) {
    console.log('\nPass --confirm to proceed.');
    process.exit(0);
  }

  console.log('\nRunning…');
  await extractPages(id);
  console.log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
