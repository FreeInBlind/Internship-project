import 'server-only';

import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';

import { getDb } from './index';
import { contentBlocks, contentVersions, issues, issueWorks } from './schema';

export async function getLibrary() {
  return getDb().select({
    issueWorkKey: issueWorks.issueWorkKey,
    workKey: issueWorks.workKey,
    title: issueWorks.titleAsPrinted,
    author: issueWorks.authorAsPrinted,
    translator: issueWorks.translatorAsPrinted,
    issueTitle: issues.title,
    coverage: issueWorks.coverage,
    contentVersion: issueWorks.contentVersion,
    blockCount: sql<number>`count(${contentBlocks.blockKey})::int`,
  }).from(issueWorks)
    .innerJoin(issues, eq(issues.issueKey, issueWorks.issueKey))
    .leftJoin(contentBlocks, and(
      eq(contentBlocks.issueWorkKey, issueWorks.issueWorkKey),
      eq(contentBlocks.contentVersion, issueWorks.contentVersion),
    ))
    .groupBy(issueWorks.issueWorkKey, issues.issueKey)
    .orderBy(desc(sql`substring(${issues.publishedMonth} from 1 for 4)`), asc(sql`substring(${issues.publishedMonth} from 6 for 2)`), asc(issueWorks.issueOrder), asc(issueWorks.issueWorkKey));
}

export async function searchLibrary(input: { query?: string; issueMonth?: string; author?: string; limit?: number }) {
  const conditions = [
    input.issueMonth ? eq(issues.publishedMonth, input.issueMonth) : undefined,
    input.query?.trim() ? or(ilike(issueWorks.titleAsPrinted, `%${input.query.trim()}%`), ilike(issueWorks.authorAsPrinted, `%${input.query.trim()}%`)) : undefined,
    input.author?.trim() ? ilike(issueWorks.authorAsPrinted, `%${input.author.trim()}%`) : undefined,
  ].filter(Boolean);
  return getDb().select({
    issueWorkKey: issueWorks.issueWorkKey, workKey: issueWorks.workKey, title: issueWorks.titleAsPrinted,
    author: issueWorks.authorAsPrinted, translator: issueWorks.translatorAsPrinted, issueKey: issues.issueKey,
    issueTitle: issues.title, publishedMonth: issues.publishedMonth, coverage: issueWorks.coverage,
    contentVersion: issueWorks.contentVersion,
  }).from(issueWorks).innerJoin(issues, eq(issues.issueKey, issueWorks.issueKey))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(sql`substring(${issues.publishedMonth} from 1 for 4)`), asc(sql`substring(${issues.publishedMonth} from 6 for 2)`), asc(issueWorks.issueOrder), asc(issueWorks.issueWorkKey))
    .limit(Math.max(1, Math.min(input.limit ?? 50, 100)));
}

export async function getRelatedIssueWorks(input: { issueWorkKey: string; workKey: string; titleRoot: string }) {
  const db = getDb();
  const entries = await db.select({
    issueWorkKey: issueWorks.issueWorkKey,
    workKey: issueWorks.workKey,
    title: issueWorks.titleAsPrinted,
    publishedMonth: issues.publishedMonth,
    coverage: issueWorks.coverage,
    contentVersion: issueWorks.contentVersion,
  }).from(issueWorks).innerJoin(issues, eq(issues.issueKey, issueWorks.issueKey))
    .where(eq(issueWorks.workKey, input.workKey))
    .orderBy(asc(issues.publishedMonth), asc(issueWorks.issueOrder), asc(issueWorks.issueWorkKey));
  const related = entries.filter((entry) => entry.title === `${input.titleRoot}（上）` || entry.title === `${input.titleRoot}（下）`)
    .sort((a, b) => Number(a.coverage !== 'complete_issue_work') - Number(b.coverage !== 'complete_issue_work') || a.title.localeCompare(b.title) || a.issueWorkKey.localeCompare(b.issueWorkKey));
  return related.some((entry) => entry.title === `${input.titleRoot}（上）`)
    && related.some((entry) => entry.title === `${input.titleRoot}（下）`) ? related : [];
}

export async function getReadingContent(issueWorkKey: string) {
  const db = getDb();
  const [entry] = await db.select({
    issueWork: issueWorks,
    issueTitle: issues.title,
    review: contentVersions.review,
  }).from(issueWorks)
    .innerJoin(issues, eq(issues.issueKey, issueWorks.issueKey))
    .innerJoin(contentVersions, and(
      eq(contentVersions.contentVersion, issueWorks.contentVersion),
      eq(contentVersions.issueWorkKey, issueWorks.issueWorkKey),
    ))
    .where(eq(issueWorks.issueWorkKey, issueWorkKey)).limit(1);
  if (!entry) return null;

  const blocks = await db.select().from(contentBlocks).where(and(
    eq(contentBlocks.issueWorkKey, issueWorkKey),
    eq(contentBlocks.contentVersion, entry.issueWork.contentVersion),
  )).orderBy(asc(contentBlocks.order));

  return { ...entry, blocks };
}

export function readingHref(issueWorkKey: string, contentVersion: string) {
  return `/read/${encodeURIComponent(issueWorkKey)}?v=${encodeURIComponent(contentVersion)}`;
}
