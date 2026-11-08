import { sql } from 'drizzle-orm';

import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const issues = pgTable('issues', {
  issueKey: text('issue_key').primaryKey(),
  title: text('title').notNull(),
  publishedMonth: text('published_month'),
  sourceFile: jsonb('source_file').$type<Record<string, unknown>>().notNull(),
  qualityStatus: text('quality_status').notNull(),
  reviewItems: jsonb('review_items').$type<string[]>().notNull(),
});

export const works = pgTable('works', {
  workKey: text('work_key').primaryKey(),
  title: text('title').notNull(),
  originalTitleAsPrinted: text('original_title_as_printed'),
  authorKey: text('author_key'),
  identityStatus: text('identity_status').notNull(),
  qualityStatus: text('quality_status').notNull(),
  reviewItems: jsonb('review_items').$type<string[]>().notNull(),
});

export const issueWorks = pgTable(
  'issue_works',
  {
    issueWorkKey: text('issue_work_key').primaryKey(),
    issueKey: text('issue_key').notNull().references(() => issues.issueKey),
    workKey: text('work_key').notNull().references(() => works.workKey),
    titleAsPrinted: text('title_as_printed').notNull(),
    authorAsPrinted: text('author_as_printed'),
    translatorAsPrinted: text('translator_as_printed'),
    originalTitleAsPrinted: text('original_title_as_printed'),
    partKind: text('part_kind').notNull(),
    partLabelAsPrinted: text('part_label_as_printed'),
    partOrder: integer('part_order'),
    issueOrder: integer('issue_order'),
    sequenceKey: text('sequence_key'),
    previousIssueWorkKey: text('previous_issue_work_key'),
    nextIssueWorkKey: text('next_issue_work_key'),
    coverage: text('coverage').notNull(),
    sourcePageRange: jsonb('source_page_range').$type<number[]>().notNull(),
    evidence: jsonb('evidence').$type<string[]>().notNull(),
    contentVersion: text('content_version').notNull(),
    qualityStatus: text('quality_status').notNull(),
    reviewItems: jsonb('review_items').$type<string[]>().notNull(),
    humanReviewStatus: text('human_review_status').notNull(),
  },
  (table) => [index('issue_works_work_key_idx').on(table.workKey)],
);

export const contentVersions = pgTable(
  'content_versions',
  {
    contentVersion: text('content_version').primaryKey(),
    issueWorkKey: text('issue_work_key').notNull().references(() => issueWorks.issueWorkKey),
    sourceFileSha256: text('source_file_sha256').notNull(),
    parserVersion: text('parser_version').notNull(),
    normalizationVersion: text('normalization_version').notNull(),
    coverage: text('coverage').notNull(),
    schemaVersion: text('schema_version').notNull(),
    batchKey: text('batch_key').notNull(),
    review: jsonb('review').$type<Record<string, unknown>>().notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('content_versions_issue_work_idx').on(table.issueWorkKey)],
);

export const chapters = pgTable(
  'chapters',
  {
    chapterKey: text('chapter_key').primaryKey(),
    issueWorkKey: text('issue_work_key').notNull().references(() => issueWorks.issueWorkKey),
    contentVersion: text('content_version').notNull().references(() => contentVersions.contentVersion),
    titleAsPrinted: text('title_as_printed').notNull(),
    order: integer('order').notNull(),
    nodeKind: text('node_kind').notNull(),
    source: jsonb('source').$type<Record<string, unknown>>().notNull(),
  },
  (table) => [index('chapters_issue_work_order_idx').on(table.issueWorkKey, table.order)],
);

export const contentBlocks = pgTable(
  'content_blocks',
  {
    blockKey: text('block_key').primaryKey(),
    issueWorkKey: text('issue_work_key').notNull().references(() => issueWorks.issueWorkKey),
    contentVersion: text('content_version').notNull().references(() => contentVersions.contentVersion),
    kind: text('kind').notNull(),
    order: integer('order').notNull(),
    text: text('text').notNull(),
    contentHash: text('content_hash').notNull(),
    chapterKey: text('chapter_key'),
    source: jsonb('source').$type<Record<string, unknown>>().notNull(),
    qualityStatus: text('quality_status').notNull(),
    reviewItems: jsonb('review_items').$type<string[]>().notNull(),
    humanReviewStatus: text('human_review_status'),
  },
  (table) => [
    uniqueIndex('content_blocks_version_order_uq').on(table.contentVersion, table.order),
    index('content_blocks_issue_work_order_idx').on(table.issueWorkKey, table.order),
  ],
);

export const user = pgTable('auth_user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const session = pgTable('auth_session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
}, (table) => [index('auth_session_user_idx').on(table.userId)]);

export const account = pgTable('auth_account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index('auth_account_user_idx').on(table.userId)]);

export const verification = pgTable('auth_verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index('auth_verification_identifier_idx').on(table.identifier)]);

export const readingProgress = pgTable('reading_progress', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  workKey: text('work_key').notNull().references(() => works.workKey),
  issueWorkKey: text('issue_work_key').notNull().references(() => issueWorks.issueWorkKey),
  contentVersion: text('content_version').notNull().references(() => contentVersions.contentVersion),
  currentBlockKey: text('current_block_key').notNull().references(() => contentBlocks.blockKey),
  currentOrder: integer('current_order').notNull(),
  furthestBlockKey: text('furthest_block_key').notNull().references(() => contentBlocks.blockKey),
  furthestOrder: integer('furthest_order').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('reading_progress_user_part_version_uq').on(table.userId, table.issueWorkKey, table.contentVersion),
  index('reading_progress_user_work_idx').on(table.userId, table.workKey),
  check('reading_progress_order_check', sql`${table.currentOrder} > 0 AND ${table.furthestOrder} > 0`),
]);

export const bookmarks = pgTable('bookmarks', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  workKey: text('work_key').notNull().references(() => works.workKey),
  issueWorkKey: text('issue_work_key').notNull().references(() => issueWorks.issueWorkKey),
  contentVersion: text('content_version').notNull().references(() => contentVersions.contentVersion),
  blockKey: text('block_key').notNull().references(() => contentBlocks.blockKey),
  note: text('note').default('').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('bookmarks_user_part_version_block_uq').on(table.userId, table.issueWorkKey, table.contentVersion, table.blockKey),
  index('bookmarks_user_work_idx').on(table.userId, table.workKey),
  check('bookmarks_note_length_check', sql`char_length(${table.note}) <= 500`),
]);

export const ragIndexRuns = pgTable('rag_index_runs', {
  runKey: text('run_key').primaryKey(),
  corpusHash: text('corpus_hash').notNull(),
  configFingerprint: text('config_fingerprint').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  dimensions: integer('dimensions').notNull(),
  chunkerVersion: text('chunker_version').notNull(),
  preprocessingVersion: text('preprocessing_version').notNull(),
  tokenBudget: integer('token_budget').notNull(),
  indexName: text('index_name').notNull(),
  targetHost: text('target_host').notNull(),
  namespace: text('namespace').notNull(),
  phase: text('phase').notNull(),
  expectedCount: integer('expected_count').notNull(),
  embeddedCount: integer('embedded_count').notNull(),
  upsertedCount: integer('upserted_count').notNull(),
  checkpoint: jsonb('checkpoint').$type<Record<string, unknown>>().notNull(),
  verificationSummary: jsonb('verification_summary').$type<Record<string, unknown>>(),
  verificationTime: timestamp('verification_time', { withTimezone: true }),
  errorCode: text('error_code'),
  resumePhase: text('resume_phase'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check('rag_index_runs_phase_check', sql`${table.phase} IN ('tokenizing', 'prepared', 'embedding_in_progress', 'embedded', 'upsert_in_progress', 'indexed', 'verified')`),
  check('rag_index_runs_counts_check', sql`${table.expectedCount} >= 0 AND ${table.embeddedCount} >= 0 AND ${table.upsertedCount} >= 0 AND ${table.embeddedCount} <= ${table.expectedCount} AND ${table.upsertedCount} <= ${table.expectedCount}`),
]);

export const ragChunks = pgTable('rag_chunks', {
  runKey: text('run_key').notNull().references(() => ragIndexRuns.runKey),
  chunkId: text('chunk_id').notNull(),
  ordinal: integer('ordinal').notNull(),
  workKey: text('work_key').notNull(),
  issueWorkKey: text('issue_work_key').notNull().references(() => issueWorks.issueWorkKey),
  contentVersion: text('content_version').notNull().references(() => contentVersions.contentVersion),
  blockKey: text('block_key').notNull().references(() => contentBlocks.blockKey),
  blockOrder: integer('block_order').notNull(),
  coverage: text('coverage').notNull(),
  spanStart: integer('span_start').notNull(),
  spanEnd: integer('span_end').notNull(),
  blockTextHash: text('block_text_hash').notNull(),
  chunkTextHash: text('chunk_text_hash').notNull(),
  tokenCount: integer('token_count').notNull(),
  embeddingState: text('embedding_state').notNull(),
  upsertState: text('upsert_state').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('rag_chunks_run_chunk_uq').on(table.runKey, table.chunkId),
  uniqueIndex('rag_chunks_run_ordinal_uq').on(table.runKey, table.ordinal),
  index('rag_chunks_run_part_order_idx').on(table.runKey, table.issueWorkKey, table.blockOrder),
  check('rag_chunks_span_check', sql`${table.spanStart} >= 0 AND ${table.spanEnd} > ${table.spanStart}`),
  check('rag_chunks_token_count_check', sql`${table.tokenCount} > 0`),
  check('rag_chunks_embedding_state_check', sql`${table.embeddingState} IN ('pending', 'confirmed')`),
  check('rag_chunks_upsert_state_check', sql`${table.upsertState} IN ('pending', 'confirmed')`),
]);

export const importBatches = pgTable('import_batches', {
  batchKey: text('batch_key').primaryKey(),
  schemaVersion: text('schema_version').notNull(),
  candidateSha256: text('candidate_sha256').notNull(),
  manifest: jsonb('manifest').$type<Record<string, unknown>>().notNull(),
  review: jsonb('review').$type<Record<string, unknown>>().notNull(),
  recordCount: integer('record_count').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

