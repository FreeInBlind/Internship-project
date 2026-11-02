import { randomBytes, randomUUID } from 'crypto';
import { prisma } from './db';

export const OFFICIAL_DAILY_LIMIT = 5;
// Longer than the upstream timeout, with room for validation and settlement.
export const QUOTA_LEASE_MS = 90 * 1000;

export class QuotaError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

// Retry only confirmed transaction aborts; never retry an uncertain connection failure.
const SERIALIZABLE_RETRY_LIMIT = 8;

function isSerializableConflict(error) {
  return error?.code === 'P2034' || error?.meta?.code === '40001' || error?.code === '40001';
}

async function runSerializable(db, operation) {
  for (let attempt = 0; attempt < SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
    try {
      return await db.$transaction(operation, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (!isSerializableConflict(error) || attempt === SERIALIZABLE_RETRY_LIMIT - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
  throw new QuotaError('QUOTA_STORAGE_UNAVAILABLE');
}

export function shanghaiDayKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function quotaStorageEnabled(env = process.env) {
  return env.GROQ_QUOTA_MIGRATION_ENABLED === 'true';
}

function asDbDate(dayKey) {
  return new Date(`${dayKey}T00:00:00.000Z`);
}

function rowLock(tx, dayKey) {
  return tx.$queryRaw`SELECT "dayKey", "reserved", "used" FROM "public"."OfficialQuotaDay" WHERE "dayKey" = ${asDbDate(dayKey)}::date FOR UPDATE`;
}

export async function reserveOfficialAttempt({ userId, requestId, requestHash, now = new Date(), db = prisma, leaseMs = QUOTA_LEASE_MS, env = process.env }) {
  if (!quotaStorageEnabled(env)) throw new QuotaError('QUOTA_STORAGE_UNAVAILABLE');
  const dayKey = shanghaiDayKey(now);
  const day = asDbDate(dayKey);
  const id = randomUUID();
  const leaseToken = randomBytes(32).toString('hex');
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);
  try {
    // Reclaim expired reservations before admitting a new attempt. This is a bounded,
    // database-backed recovery path; no scheduler is required for correctness.
    await expireOfficialReservations({ now, batchSize: 100, db, env });
    return await runSerializable(db, async (tx) => {
      const existing = await tx.analysisAttempt.findUnique({ where: { userId_requestId: { userId, requestId } } });
      if (existing) {
        if (existing.requestHash !== requestHash) throw new QuotaError('IDEMPOTENCY_CONFLICT');
        return { kind: existing.status === 'succeeded' ? 'completed' : existing.status === 'reserved' ? 'in_progress' : 'previously_failed', attemptId: existing.id };
      }
      await tx.$executeRaw`INSERT INTO "public"."OfficialQuotaDay" ("dayKey", "reserved", "used", "updatedAt") VALUES (${day}::date, 0, 0, ${now}) ON CONFLICT ("dayKey") DO NOTHING`;
      const rows = await rowLock(tx, dayKey);
      if (!rows.length || rows[0].reserved + rows[0].used >= OFFICIAL_DAILY_LIMIT) return { kind: 'exhausted' };
      const changed = await tx.$executeRaw`UPDATE "public"."OfficialQuotaDay" SET "reserved" = "reserved" + 1, "updatedAt" = ${now} WHERE "dayKey" = ${day}::date AND "reserved" + "used" < ${OFFICIAL_DAILY_LIMIT}`;
      if (changed !== 1) throw new QuotaError('QUOTA_STORAGE_UNAVAILABLE');
      const attempt = await tx.analysisAttempt.create({ data: { id, userId, requestId, requestHash, dayKey: day, status: 'reserved', leaseToken, leaseExpiresAt, createdAt: now, updatedAt: now } });
      return { kind: 'reserved', attemptId: attempt.id, dayKey, leaseToken, leaseExpiresAt };
    });
  } catch (error) {
    if (error instanceof QuotaError) throw error;
    if (error?.code === 'P2002') {
      try {
        const existing = await db.analysisAttempt.findUnique({ where: { userId_requestId: { userId, requestId } } });
        if (existing?.requestHash === requestHash) {
          return {
            kind: existing.status === 'succeeded'
              ? 'completed'
              : existing.status === 'reserved'
                ? 'in_progress'
                : 'previously_failed',
            attemptId: existing.id,
          };
        }
        if (existing) throw new QuotaError('IDEMPOTENCY_CONFLICT');
      } catch (lookupError) {
        if (lookupError instanceof QuotaError) throw lookupError;
        throw new QuotaError('QUOTA_STORAGE_UNAVAILABLE');
      }
    }
    throw new QuotaError('QUOTA_STORAGE_UNAVAILABLE');
  }
}

async function settle({ attemptId, leaseToken, now, success, db, env = process.env }) {
  if (!quotaStorageEnabled(env)) throw new QuotaError('QUOTA_STORAGE_UNAVAILABLE');
  try {
    return await runSerializable(db, async (tx) => {
      const rows = await tx.$queryRaw`SELECT "dayKey" FROM "public"."AnalysisAttempt" WHERE "id" = ${attemptId} AND "status" = 'reserved' AND "leaseToken" = ${leaseToken} AND "leaseExpiresAt" > ${now}`;
      if (!rows.length) return false;
      const dayKey = new Date(rows[0].dayKey).toISOString().slice(0, 10);
      await rowLock(tx, dayKey);
      const updatedAttempt = await tx.analysisAttempt.updateMany({ where: { id: attemptId, status: 'reserved', leaseToken, leaseExpiresAt: { gt: now } }, data: { status: success ? 'succeeded' : 'failed', updatedAt: now } });
      if (updatedAttempt.count !== 1) return false;
      const delta = success ? 1 : 0;
      const changed = await tx.$executeRaw`UPDATE "public"."OfficialQuotaDay" SET "reserved" = "reserved" - 1, "used" = "used" + ${delta}, "updatedAt" = ${now} WHERE "dayKey" = ${asDbDate(dayKey)}::date AND "reserved" > 0 AND "used" + ${delta} <= ${OFFICIAL_DAILY_LIMIT}`;
      if (changed !== 1) throw new QuotaError('QUOTA_STORAGE_UNAVAILABLE');
      return true;
    });
  } catch (error) {
    if (error instanceof QuotaError) throw error;
    throw new QuotaError('QUOTA_STORAGE_UNAVAILABLE');
  }
}

export function settleOfficialAttempt({ attemptId, leaseToken, now = new Date(), db = prisma, env = process.env }) {
  return settle({ attemptId, leaseToken, now, success: true, db, env });
}

export function releaseOfficialAttempt({ attemptId, leaseToken, now = new Date(), db = prisma, env = process.env }) {
  return settle({ attemptId, leaseToken, now, success: false, db, env });
}

export async function expireOfficialReservations({ now = new Date(), batchSize = 100, db = prisma, env = process.env } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new QuotaError('QUOTA_STORAGE_UNAVAILABLE');
  if (!quotaStorageEnabled(env)) throw new QuotaError('QUOTA_STORAGE_UNAVAILABLE');
  try {
    const candidates = await db.analysisAttempt.findMany({
      where: { status: 'reserved', leaseExpiresAt: { lte: now } },
      select: { id: true, dayKey: true },
      orderBy: [{ dayKey: 'asc' }, { leaseExpiresAt: 'asc' }, { id: 'asc' }],
      take: batchSize,
    });
    let count = 0;
    for (const item of candidates) {
      const dayKey = new Date(item.dayKey).toISOString().slice(0, 10);
      const expired = await runSerializable(db, async (tx) => {
        await rowLock(tx, dayKey);
        const updated = await tx.analysisAttempt.updateMany({ where: { id: item.id, status: 'reserved', leaseExpiresAt: { lte: now } }, data: { status: 'expired', updatedAt: now } });
        if (updated.count !== 1) return false;
        const changed = await tx.$executeRaw`UPDATE "public"."OfficialQuotaDay" SET "reserved" = "reserved" - 1, "updatedAt" = ${now} WHERE "dayKey" = ${asDbDate(dayKey)}::date AND "reserved" > 0`;
        if (changed !== 1) throw new QuotaError('QUOTA_STORAGE_UNAVAILABLE');
        return true;
      });
      if (expired) count += 1;
    }
    return count;
  } catch (error) {
    if (error instanceof QuotaError) throw error;
    throw new QuotaError('QUOTA_STORAGE_UNAVAILABLE');
  }
}
