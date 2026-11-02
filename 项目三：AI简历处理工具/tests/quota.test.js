import { describe, expect, it, vi } from 'vitest';
import { expireOfficialReservations, quotaStorageEnabled, reserveOfficialAttempt, settleOfficialAttempt, shanghaiDayKey } from '../lib/quota';

const disabled = { GROQ_QUOTA_MIGRATION_ENABLED: 'false' };
describe('official analysis quota gates', () => {
  it('uses the Asia/Shanghai calendar day around UTC midnight', () => {
    expect(shanghaiDayKey(new Date('2026-11-01T15:59:59.000Z'))).toBe('2026-11-01');
    expect(shanghaiDayKey(new Date('2026-11-01T16:00:00.000Z'))).toBe('2026-11-02');
  });

  it.each(['P2034', '40001'])('retries confirmed serialization aborts (%s)', async (code) => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([]) };
    const db = { $transaction: vi.fn()
      .mockRejectedValueOnce({ code })
      .mockImplementation((operation) => operation(tx)) };
    await expect(settleOfficialAttempt({ attemptId: 'a', leaseToken: 't', db, env: { GROQ_QUOTA_MIGRATION_ENABLED: 'true' } })).resolves.toBe(false);
    expect(db.$transaction).toHaveBeenCalledTimes(2);
  });

  it('does not retry uncertain storage failures', async () => {
    const db = { $transaction: vi.fn().mockRejectedValue({ code: 'P1001' }) };
    await expect(settleOfficialAttempt({ attemptId: 'a', leaseToken: 't', db, env: { GROQ_QUOTA_MIGRATION_ENABLED: 'true' } })).rejects.toMatchObject({ code: 'QUOTA_STORAGE_UNAVAILABLE' });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it('bounds transaction conflict retries and fails closed when exhausted', async () => {
    const db = { $transaction: vi.fn().mockRejectedValue({ code: 'P2034' }) };
    await expect(settleOfficialAttempt({ attemptId: 'a', leaseToken: 't', db, env: { GROQ_QUOTA_MIGRATION_ENABLED: 'true' } })).rejects.toMatchObject({ code: 'QUOTA_STORAGE_UNAVAILABLE' });
    expect(db.$transaction).toHaveBeenCalledTimes(8);
  });

  it.each([
    ['reserved', 'in_progress'],
    ['succeeded', 'completed'],
    ['failed', 'previously_failed'],
    ['expired', 'previously_failed'],
  ])('recovers a unique conflict with the correct %s status', async (status, kind) => {
    const db = {
      analysisAttempt: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue({ id: 'existing', requestHash: 'h', status }),
      },
      $transaction: vi.fn().mockRejectedValue({ code: 'P2002' }),
    };
    await expect(reserveOfficialAttempt({ userId: 'u', requestId: 'r', requestHash: 'h', db, env: { GROQ_QUOTA_MIGRATION_ENABLED: 'true' } }))
      .resolves.toEqual({ kind, attemptId: 'existing' });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it('sanitizes a failed unique-conflict recovery lookup without retrying', async () => {
    const db = {
      analysisAttempt: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockRejectedValue({ code: 'P1001', message: 'private database error' }),
      },
      $transaction: vi.fn().mockRejectedValue({ code: 'P2002' }),
    };
    await expect(reserveOfficialAttempt({ userId: 'u', requestId: 'r', requestHash: 'h', db, env: { GROQ_QUOTA_MIGRATION_ENABLED: 'true' } }))
      .rejects.toMatchObject({ code: 'QUOTA_STORAGE_UNAVAILABLE', message: 'QUOTA_STORAGE_UNAVAILABLE' });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.analysisAttempt.findUnique).toHaveBeenCalledTimes(1);
  });

  it('preserves hash conflicts during unique-conflict recovery', async () => {
    const db = {
      analysisAttempt: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue({ id: 'existing', requestHash: 'other', status: 'reserved' }),
      },
      $transaction: vi.fn().mockRejectedValue({ code: 'P2002' }),
    };
    await expect(reserveOfficialAttempt({ userId: 'u', requestId: 'r', requestHash: 'h', db, env: { GROQ_QUOTA_MIGRATION_ENABLED: 'true' } }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('fails closed when the unique-conflict winner cannot be found', async () => {
    const db = {
      analysisAttempt: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi.fn().mockRejectedValue({ code: 'P2002' }),
    };
    await expect(reserveOfficialAttempt({ userId: 'u', requestId: 'r', requestHash: 'h', db, env: { GROQ_QUOTA_MIGRATION_ENABLED: 'true' } }))
      .rejects.toMatchObject({ code: 'QUOTA_STORAGE_UNAVAILABLE' });
  });

  it('fails closed before touching storage until migration is explicitly enabled', async () => {
    expect(quotaStorageEnabled(disabled)).toBe(false);
    await expect(reserveOfficialAttempt({ userId: 'u', requestId: 'r', requestHash: 'h', env: disabled, db: {} })).rejects.toMatchObject({ code: 'QUOTA_STORAGE_UNAVAILABLE' });
    await expect(expireOfficialReservations({ env: disabled, db: {} })).rejects.toMatchObject({ code: 'QUOTA_STORAGE_UNAVAILABLE' });
  });
});
