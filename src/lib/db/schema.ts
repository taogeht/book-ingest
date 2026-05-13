import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  smallint,
  pgEnum,
  jsonb,
  decimal,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const projectStatusEnum = pgEnum('ingest_project_status', [
  'created',
  'uploading',
  'extracting',
  'reviewing',
  'exported',
]);

export const sourceFileTypeEnum = pgEnum('ingest_source_file_type', [
  'pdf_digital',
  'pdf_scanned',
  'docx',
  'other',
]);

export const sourceStatusEnum = pgEnum('ingest_source_status', [
  'uploaded',
  'parsed',
  'failed',
]);

// Track which extraction method populated each page's raw_text:
//   marker          — Marker's text/layout extraction only
//   vision          — Claude vision call only (marker produced nothing usable)
//   marker+vision   — Marker ran, then vision augmented/replaced its output
//                     because the page was empty or picture-heavy.
export const extractionMethodEnum = pgEnum('ingest_extraction_method', [
  'marker',
  'vision',
  'marker+vision',
]);

export const ingestionProjects = pgTable('ingestion_projects', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  curriculumName: text('curriculum_name').notNull(),
  targetLevel: smallint('target_level'),
  language: text('language').notNull().default('en'),
  status: projectStatusEnum('status').notNull().default('created'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sourceDocuments = pgTable(
  'source_documents',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => ingestionProjects.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    fileType: sourceFileTypeEnum('file_type').notNull(),
    storageKey: text('storage_key').notNull(),
    pageCount: smallint('page_count'),
    status: sourceStatusEnum('status').notNull().default('uploaded'),
    parseError: text('parse_error'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectIdx: index('source_documents_project_idx').on(t.projectId),
  }),
);

export const extractedPages = pgTable(
  'extracted_pages',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    sourceDocumentId: uuid('source_document_id')
      .notNull()
      .references(() => sourceDocuments.id, { onDelete: 'cascade' }),
    pageNumber: smallint('page_number').notNull(),
    rawText: text('raw_text').notNull().default(''),
    layoutJson: jsonb('layout_json'),
    pageImageKey: text('page_image_key'),
    extractionMethod: extractionMethodEnum('extraction_method').notNull().default('marker'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sourceIdx: index('extracted_pages_source_idx').on(t.sourceDocumentId),
    pageUnique: uniqueIndex('extracted_pages_source_page_unique').on(
      t.sourceDocumentId,
      t.pageNumber,
    ),
  }),
);

export const detectedUnits = pgTable(
  'detected_units',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => ingestionProjects.id, { onDelete: 'cascade' }),
    sourceDocumentId: uuid('source_document_id')
      .notNull()
      .references(() => sourceDocuments.id, { onDelete: 'cascade' }),
    unitNumber: smallint('unit_number').notNull(),
    unitTitle: text('unit_title').notNull(),
    startPage: smallint('start_page').notNull(),
    endPage: smallint('end_page').notNull(),
    detectionConfidence: decimal('detection_confidence', { precision: 3, scale: 2 }),
    llmReasoning: text('llm_reasoning'),
    reviewed: boolean('reviewed').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectIdx: index('detected_units_project_idx').on(t.projectId),
  }),
);

export const extractedVocabulary = pgTable(
  'extracted_vocabulary',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => ingestionProjects.id, { onDelete: 'cascade' }),
    unitId: uuid('unit_id').references(() => detectedUnits.id, { onDelete: 'set null' }),
    word: text('word').notNull(),
    partOfSpeech: text('part_of_speech'),
    inferredCefr: text('inferred_cefr'),
    multiWord: boolean('multi_word').notNull().default(false),
    sourcePage: smallint('source_page'),
    extractionConfidence: decimal('extraction_confidence', { precision: 3, scale: 2 }),
    llmReasoning: text('llm_reasoning'),
    reviewed: boolean('reviewed').notNull().default(false),
    approved: boolean('approved'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectIdx: index('extracted_vocabulary_project_idx').on(t.projectId),
    unitIdx: index('extracted_vocabulary_unit_idx').on(t.unitId),
  }),
);

export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type IngestionProject = typeof ingestionProjects.$inferSelect;
export type SourceDocument = typeof sourceDocuments.$inferSelect;
export type ExtractedPage = typeof extractedPages.$inferSelect;
export type DetectedUnit = typeof detectedUnits.$inferSelect;
export type ExtractedVocabulary = typeof extractedVocabulary.$inferSelect;
