// Re-run the vocabulary extraction stage for an entire project using the
// existing extracted_pages and detected_units. Wipes extracted_vocabulary
// first. Useful for iterating on the vocab prompt without re-paying for
// Marker / vision.
//
// Usage:
//   tsx scripts/reextract-vocab.ts <projectId> --confirm

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { db } from '../src/lib/db';
import {
  ingestionProjects,
  extractedVocabulary,
  detectedUnits,
} from '../src/lib/db/schema';
import { eq, count } from 'drizzle-orm';
import { runVocabExtractionForProject } from '../src/lib/extraction/process-document';

async function main() {
  const id = process.argv[2];
  const confirm = process.argv.includes('--confirm');
  if (!id) {
    console.error('Usage: tsx scripts/reextract-vocab.ts <projectId> --confirm');
    process.exit(1);
  }

  const project = await db.query.ingestionProjects.findFirst({
    where: eq(ingestionProjects.id, id),
  });
  if (!project) {
    console.error(`No project with id ${id}`);
    process.exit(1);
  }

  const [{ value: vocabCount }] = await db
    .select({ value: count() })
    .from(extractedVocabulary)
    .where(eq(extractedVocabulary.projectId, id));

  const [{ value: unitCount }] = await db
    .select({ value: count() })
    .from(detectedUnits)
    .where(eq(detectedUnits.projectId, id));

  console.log(`Project         : ${project.name}`);
  console.log(`Will DELETE     : ${vocabCount} extracted_vocabulary rows`);
  console.log(`Will RE-RUN     : vocab extraction across ${unitCount} existing units`);
  console.log('(detected_units and extracted_pages are NOT touched)');
  if (!confirm) {
    console.log('\nPass --confirm to proceed.');
    process.exit(0);
  }

  await db
    .delete(extractedVocabulary)
    .where(eq(extractedVocabulary.projectId, id));

  console.log('\nRunning…');
  await runVocabExtractionForProject(id);
  console.log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
