import 'server-only';

import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { getDb } from './index';
import { contentBlocks, contentVersions, issueWorks } from './schema';

export async function getOrderedEvidenceBlocks(input: { issueWorkKey: string; contentVersion: string; startOrder: number; endOrder: number; limit: number }) {
  const rows = await getDb().select({
    blockKey: contentBlocks.blockKey, issueWorkKey: contentBlocks.issueWorkKey,
    contentVersion: contentBlocks.contentVersion, kind: contentBlocks.kind, order: contentBlocks.order,
    text: contentBlocks.text, contentHash: contentBlocks.contentHash, source: contentBlocks.source,
    qualityStatus: contentBlocks.qualityStatus, workKey: issueWorks.workKey,
    currentVersion: issueWorks.contentVersion, coverage: issueWorks.coverage,
    issueKey: issueWorks.issueKey, title: issueWorks.titleAsPrinted,
    review: contentVersions.review, sourceFileSha256: contentVersions.sourceFileSha256,
    humanReviewStatus: contentBlocks.humanReviewStatus,
  }).from(contentBlocks).innerJoin(issueWorks, and(
    eq(issueWorks.issueWorkKey, contentBlocks.issueWorkKey),
    eq(issueWorks.contentVersion, contentBlocks.contentVersion),
  )).innerJoin(contentVersions, and(eq(contentVersions.issueWorkKey, contentBlocks.issueWorkKey), eq(contentVersions.contentVersion, contentBlocks.contentVersion))).where(and(
    eq(contentBlocks.issueWorkKey, input.issueWorkKey),
    eq(contentBlocks.contentVersion, input.contentVersion),
    gte(contentBlocks.order, input.startOrder),
    lte(contentBlocks.order, input.endOrder),
    eq(contentBlocks.kind, 'body'),
  )).orderBy(asc(contentBlocks.order)).limit(Math.min(input.limit, 120));
  return rows;
}

export async function getEvidenceBlocks(keys: string[]) {
  if (!keys.length) return [];
  return getDb().select({
    blockKey: contentBlocks.blockKey, issueWorkKey: contentBlocks.issueWorkKey,
    contentVersion: contentBlocks.contentVersion, kind: contentBlocks.kind, order: contentBlocks.order,
    text: contentBlocks.text, contentHash: contentBlocks.contentHash, source: contentBlocks.source,
    qualityStatus: contentBlocks.qualityStatus, workKey: issueWorks.workKey,
    currentVersion: issueWorks.contentVersion, coverage: issueWorks.coverage,
    issueKey: issueWorks.issueKey, title: issueWorks.titleAsPrinted,
    review: contentVersions.review, sourceFileSha256: contentVersions.sourceFileSha256,
    humanReviewStatus: contentBlocks.humanReviewStatus,
  }).from(contentBlocks).innerJoin(issueWorks, and(eq(issueWorks.issueWorkKey, contentBlocks.issueWorkKey), eq(issueWorks.contentVersion, contentBlocks.contentVersion)))
    .innerJoin(contentVersions, and(eq(contentVersions.issueWorkKey, contentBlocks.issueWorkKey), eq(contentVersions.contentVersion, contentBlocks.contentVersion)))
    .where(inArray(contentBlocks.blockKey, [...new Set(keys)].slice(0, 16)));
}
