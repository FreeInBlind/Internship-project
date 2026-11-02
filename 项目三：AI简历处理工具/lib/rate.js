import { createHmac } from 'crypto';
import { prisma } from './db';

const MAX_KEYS = 100000;
export function rateKey(scope, value) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('Authentication is not configured');
  return createHmac('sha256', secret).update(`${scope}:${value}`).digest('hex');
}

export async function consumeRateLimit(scope, value, limit, windowMs) {
  const key = rateKey(scope, value);
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowMs);
  // Serialize cleanup and admission so the capacity is a hard bound under concurrency.
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(192837465)`;
    await tx.$executeRaw`DELETE FROM "public"."AuthRateLimit" WHERE "windowStart" <= ${new Date(now.getTime() - 24 * 60 * 60 * 1000)}`;
    return tx.$queryRaw`
    INSERT INTO "public"."AuthRateLimit" ("key", "windowStart", "count")
    SELECT ${key}, ${now}, 1
    WHERE (SELECT COUNT(*) FROM "public"."AuthRateLimit") < ${MAX_KEYS}
       OR EXISTS (SELECT 1 FROM "public"."AuthRateLimit" WHERE "key" = ${key})
    ON CONFLICT ("key") DO UPDATE SET
      "windowStart" = CASE WHEN "AuthRateLimit"."windowStart" <= ${cutoff} THEN ${now} ELSE "AuthRateLimit"."windowStart" END,
      "count" = CASE WHEN "AuthRateLimit"."windowStart" <= ${cutoff} THEN 1 ELSE "AuthRateLimit"."count" + 1 END
    RETURNING "count", "windowStart"`;
  });
  if (!rows.length) return { allowed: false, retryAfter: Math.ceil(windowMs / 1000), unavailable: true };
  return { allowed: rows[0].count <= limit, retryAfter: Math.max(1, Math.ceil((new Date(rows[0].windowStart).getTime() + windowMs - now.getTime()) / 1000)) };
}
