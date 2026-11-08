import 'server-only';

import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, lt, sql } from 'drizzle-orm';
import { ApiError, text } from '@/lib/api';
import { getDb } from './index';
import { bookmarks, contentBlocks, contentVersions, issueWorks, readingProgress, works } from './schema';

type ReaderDb = Pick<ReturnType<typeof getDb>, 'select'>;

export async function validateAnchor(db: ReaderDb, workKey: string, issueWorkKey: string, version: string, blockKey: string) {
  const [part] = await db.select().from(issueWorks).where(eq(issueWorks.issueWorkKey, issueWorkKey)).for('share');
  if (!part) throw new ApiError(404, 'CONTENT_NOT_FOUND', '未找到刊载部分');
  if (part.workKey !== workKey) throw new ApiError(400, 'VALIDATION_ERROR', '作品与刊载部分不匹配');
  if (part.contentVersion !== version) {
    throw new ApiError(409, 'CONTENT_VERSION_MISMATCH', '内容版本已更新，请重新定位', { currentContentVersion: part.contentVersion });
  }
  const [anchor] = await db.select({ order: contentBlocks.order }).from(contentBlocks)
    .innerJoin(contentVersions, and(
      eq(contentVersions.contentVersion, contentBlocks.contentVersion),
      eq(contentVersions.issueWorkKey, contentBlocks.issueWorkKey),
    ))
    .where(and(eq(contentBlocks.blockKey, blockKey), eq(contentBlocks.issueWorkKey, issueWorkKey), eq(contentBlocks.contentVersion, version))).limit(1);
  if (!anchor || !Number.isSafeInteger(anchor.order) || anchor.order < 1) {
    throw new ApiError(400, 'INVALID_ANCHOR', '段落不存在或不属于该刊载部分和版本');
  }
  return anchor;
}

export function location(input: Record<string, unknown>) {
  return {
    workKey: text(input.workId, 'workId'),
    issueWorkKey: text(input.issueWorkId, 'issueWorkId'),
    contentVersion: text(input.contentVersion, 'contentVersion'),
    blockKey: text(input.blockKey, 'blockKey'),
  };
}

export function note(value: unknown) {
  if (typeof value !== 'string' || value.length > 500) throw new ApiError(400, 'VALIDATION_ERROR', '短注最多 500 字符');
  return value;
}

export async function validateFilter(workKey: string, issueWorkKey: string | null) {
  const db = getDb();
  if (issueWorkKey) {
    const [part] = await db.select({ workKey: issueWorks.workKey }).from(issueWorks).where(eq(issueWorks.issueWorkKey, issueWorkKey)).limit(1);
    if (!part) throw new ApiError(404, 'CONTENT_NOT_FOUND', '未找到刊载部分');
    if (part.workKey !== workKey) throw new ApiError(400, 'VALIDATION_ERROR', '作品与刊载部分不匹配');
  } else {
    const [work] = await db.select({ key: works.workKey }).from(works).where(eq(works.workKey, workKey)).limit(1);
    if (!work) throw new ApiError(404, 'CONTENT_NOT_FOUND', '未找到作品');
  }
}

export async function listProgress(userId: string, workKey: string, part: string | null) {
  await validateFilter(workKey, part);
  const rows = await getDb().select({ progress: readingProgress, currentVersion: issueWorks.contentVersion })
    .from(readingProgress).innerJoin(issueWorks, eq(readingProgress.issueWorkKey, issueWorks.issueWorkKey))
    .where(and(eq(readingProgress.userId, userId), eq(readingProgress.workKey, workKey), part ? eq(readingProgress.issueWorkKey, part) : undefined))
    .orderBy(asc(readingProgress.issueWorkKey), asc(readingProgress.contentVersion));
  return rows.map(({ progress, currentVersion }) => ({ ...progress, status: progress.contentVersion === currentVersion ? 'active' : 'needs_relocation', currentContentVersion: currentVersion }));
}

export type ReadingRangeMode = 'before_current' | 'read' | 'full';

export async function getReadingRange(userId: string, workKey: string, issueWorkKey: string, mode: ReadingRangeMode) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [part] = await tx.select({
      workKey: issueWorks.workKey,
      contentVersion: issueWorks.contentVersion,
      coverage: issueWorks.coverage,
    }).from(issueWorks).where(eq(issueWorks.issueWorkKey, issueWorkKey)).for('share');
    if (!part) throw new ApiError(404, 'CONTENT_NOT_FOUND', '未找到刊载部分');
    if (part.workKey !== workKey) throw new ApiError(400, 'VALIDATION_ERROR', '作品与刊载部分不匹配');
    const [version] = await tx.select({ contentVersion: contentVersions.contentVersion }).from(contentVersions)
      .where(and(eq(contentVersions.contentVersion, part.contentVersion), eq(contentVersions.issueWorkKey, issueWorkKey))).limit(1);
    if (!version) throw new ApiError(409, 'CONTENT_VERSION_MISMATCH', '当前内容版本暂不可用');

    const base = {
      workKey,
      issueWorkKey,
      contentVersion: part.contentVersion,
      coverage: part.coverage,
      mode,
    };
    const empty = (reason: 'no_progress' | 'at_start' | 'no_content') => ({ ...base, range: null, emptyReason: reason });

    if (mode !== 'full') {
      const [progress] = await tx.select().from(readingProgress).where(and(
        eq(readingProgress.userId, userId),
        eq(readingProgress.workKey, workKey),
        eq(readingProgress.issueWorkKey, issueWorkKey),
        eq(readingProgress.contentVersion, part.contentVersion),
      ));
      if (!progress) return empty('no_progress');
      const currentAnchor = await validateAnchor(tx, workKey, issueWorkKey, part.contentVersion, progress.currentBlockKey);
      const furthestAnchor = await validateAnchor(tx, workKey, issueWorkKey, part.contentVersion, progress.furthestBlockKey);

      if (mode === 'before_current') {
        const [end] = await tx.select({ blockKey: contentBlocks.blockKey, order: contentBlocks.order }).from(contentBlocks)
          .where(and(
            eq(contentBlocks.issueWorkKey, issueWorkKey),
            eq(contentBlocks.contentVersion, part.contentVersion),
            lt(contentBlocks.order, currentAnchor.order),
          )).orderBy(desc(contentBlocks.order)).limit(1);
        if (!end) return empty('at_start');
        const [start] = await tx.select({ blockKey: contentBlocks.blockKey, order: contentBlocks.order }).from(contentBlocks)
          .where(and(eq(contentBlocks.issueWorkKey, issueWorkKey), eq(contentBlocks.contentVersion, part.contentVersion)))
          .orderBy(asc(contentBlocks.order)).limit(1);
        if (!start) return empty('no_content');
        return { ...base, range: { startBlockKey: start.blockKey, startOrder: start.order, endBlockKey: end.blockKey, endOrder: end.order }, emptyReason: null };
      }

      const [start] = await tx.select({ blockKey: contentBlocks.blockKey, order: contentBlocks.order }).from(contentBlocks)
        .where(and(eq(contentBlocks.issueWorkKey, issueWorkKey), eq(contentBlocks.contentVersion, part.contentVersion)))
        .orderBy(asc(contentBlocks.order)).limit(1);
      if (!start) return empty('no_content');
      return { ...base, range: { startBlockKey: start.blockKey, startOrder: start.order, endBlockKey: progress.furthestBlockKey, endOrder: furthestAnchor.order }, emptyReason: null };
    }

    const [first] = await tx.select({ blockKey: contentBlocks.blockKey, order: contentBlocks.order }).from(contentBlocks)
      .where(and(eq(contentBlocks.issueWorkKey, issueWorkKey), eq(contentBlocks.contentVersion, part.contentVersion)))
      .orderBy(asc(contentBlocks.order)).limit(1);
    const [last] = await tx.select({ blockKey: contentBlocks.blockKey, order: contentBlocks.order }).from(contentBlocks)
      .where(and(eq(contentBlocks.issueWorkKey, issueWorkKey), eq(contentBlocks.contentVersion, part.contentVersion)))
      .orderBy(desc(contentBlocks.order)).limit(1);
    if (!first || !last) return empty('no_content');
    return { ...base, range: { startBlockKey: first.blockKey, startOrder: first.order, endBlockKey: last.blockKey, endOrder: last.order }, emptyReason: null };
  });
}

export async function saveProgress(userId: string, input: Record<string, unknown>) {
  const loc = location(input);
  return getDb().transaction(async (tx) => {
    const anchor = await validateAnchor(tx, loc.workKey, loc.issueWorkKey, loc.contentVersion, loc.blockKey);
    if (input.advanceRead !== undefined && typeof input.advanceRead !== 'boolean') throw new ApiError(400, 'VALIDATION_ERROR', 'advanceRead 必须为布尔值');
    if (input.expectedUpdatedAt !== undefined && input.expectedUpdatedAt !== null && (typeof input.expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(input.expectedUpdatedAt)))) throw new ApiError(400, 'VALIDATION_ERROR', 'expectedUpdatedAt 无效');
    // Serialize this user's part/version, including the first insert, before comparing revisions.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([userId, loc.issueWorkKey, loc.contentVersion])}, 0))`);
    const [previous] = await tx.select().from(readingProgress).where(and(eq(readingProgress.userId, userId), eq(readingProgress.issueWorkKey, loc.issueWorkKey), eq(readingProgress.contentVersion, loc.contentVersion)));
    if (input.expectedUpdatedAt !== undefined && (previous?.updatedAt.toISOString() ?? null) !== input.expectedUpdatedAt) {
      throw new ApiError(409, 'PROGRESS_CONFLICT', '阅读位置已由另一请求更新，请重新加载进度');
    }
    const [first] = await tx.select({ blockKey: contentBlocks.blockKey, order: contentBlocks.order }).from(contentBlocks).where(and(eq(contentBlocks.issueWorkKey, loc.issueWorkKey), eq(contentBlocks.contentVersion, loc.contentVersion))).orderBy(asc(contentBlocks.order)).limit(1);
    const advance = input.advanceRead !== false;
    const readAnchor = input.readThroughBlockKey === undefined ? null : await validateAnchor(tx, loc.workKey, loc.issueWorkKey, loc.contentVersion, text(input.readThroughBlockKey, 'readThroughBlockKey'));
    const readKey = readAnchor ? String(input.readThroughBlockKey) : advance ? loc.blockKey : first.blockKey;
    const readOrder = readAnchor ? readAnchor.order : advance ? anchor.order : first.order;
    const [result] = await tx.insert(readingProgress).values({
      id: randomUUID(), userId, workKey: loc.workKey, issueWorkKey: loc.issueWorkKey,
      contentVersion: loc.contentVersion, currentBlockKey: loc.blockKey, currentOrder: anchor.order,
      furthestBlockKey: readKey, furthestOrder: readOrder,
      updatedAt: sql`date_trunc('milliseconds', clock_timestamp())`,
    }).onConflictDoUpdate({
      target: [readingProgress.userId, readingProgress.issueWorkKey, readingProgress.contentVersion],
      set: {
        currentBlockKey: loc.blockKey,
        currentOrder: anchor.order,
        furthestBlockKey: sql`CASE WHEN ${readingProgress.furthestOrder} < ${readOrder} THEN ${readKey} ELSE ${readingProgress.furthestBlockKey} END`,
        furthestOrder: sql`greatest(${readingProgress.furthestOrder}, ${readOrder})`,
        updatedAt: sql`greatest(date_trunc('milliseconds', clock_timestamp()), ${readingProgress.updatedAt} + interval '1 millisecond')`,
      },
      // Repeated identical saves perform no UPDATE and leave updatedAt unchanged.
      setWhere: sql`${readingProgress.currentBlockKey} <> ${loc.blockKey} OR ${readingProgress.furthestOrder} < ${readOrder}`,
    }).returning();
    if (result) return result;
    const [existing] = await tx.select().from(readingProgress).where(and(
      eq(readingProgress.userId, userId), eq(readingProgress.issueWorkKey, loc.issueWorkKey), eq(readingProgress.contentVersion, loc.contentVersion),
    ));
    return existing;
  });
}

export async function listBookmarks(userId: string, workKey: string, part: string | null, cursor: string | null) {
  await validateFilter(workKey, part);
  const rows = await getDb().select({ bookmark: bookmarks, currentVersion: issueWorks.contentVersion }).from(bookmarks)
    .innerJoin(issueWorks, eq(bookmarks.issueWorkKey, issueWorks.issueWorkKey))
    .where(and(eq(bookmarks.userId, userId), eq(bookmarks.workKey, workKey), part ? eq(bookmarks.issueWorkKey, part) : undefined, cursor ? gt(bookmarks.id, cursor) : undefined))
    .orderBy(asc(bookmarks.id)).limit(101);
  return {
    items: rows.slice(0, 100).map(({ bookmark, currentVersion }) => ({ ...bookmark, status: bookmark.contentVersion === currentVersion ? 'active' : 'needs_relocation', currentContentVersion: currentVersion })),
    nextCursor: rows.length > 100 ? rows[99].bookmark.id : null,
  };
}

export async function createBookmark(userId: string, input: Record<string, unknown>) {
  const loc = location(input);
  const shortNote = input.note === undefined ? '' : note(input.note);
  return getDb().transaction(async (tx) => {
    await validateAnchor(tx, loc.workKey, loc.issueWorkKey, loc.contentVersion, loc.blockKey);
    const [created] = await tx.insert(bookmarks).values({ id: randomUUID(), userId, ...loc, note: shortNote })
      .onConflictDoNothing({ target: [bookmarks.userId, bookmarks.issueWorkKey, bookmarks.contentVersion, bookmarks.blockKey] }).returning();
    if (created) return { bookmark: created, created: true };
    const [existing] = await tx.select().from(bookmarks).where(and(eq(bookmarks.userId, userId), eq(bookmarks.issueWorkKey, loc.issueWorkKey), eq(bookmarks.contentVersion, loc.contentVersion), eq(bookmarks.blockKey, loc.blockKey)));
    return { bookmark: existing, created: false };
  });
}

export async function updateBookmark(userId: string, id: string, shortNote: string) {
  const [updated] = await getDb().update(bookmarks).set({ note: shortNote, updatedAt: sql`now()` })
    .where(and(eq(bookmarks.id, id), eq(bookmarks.userId, userId))).returning();
  if (!updated) throw new ApiError(404, 'RESOURCE_NOT_FOUND', '未找到书签');
  return updated;
}

export async function deleteBookmark(userId: string, id: string) {
  // Idempotent, including absent and other users' IDs, without disclosing ownership.
  await getDb().delete(bookmarks).where(and(eq(bookmarks.id, id), eq(bookmarks.userId, userId)));
}
