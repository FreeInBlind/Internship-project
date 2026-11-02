import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../pages/api/roast';

const mocks = vi.hoisted(() => ({ session: vi.fn(), reserve: vi.fn(), settle: vi.fn(), release: vi.fn(), analyze: vi.fn() }));
vi.mock('next-auth/next', () => ({ getServerSession: mocks.session }));
vi.mock('../lib/auth', () => ({ authOptions: {} }));
// Only this offline suite reopens the retained reservation branch via a module mock.
vi.mock('../lib/aiAvailability', () => ({
  officialAiAvailable: () => true,
  officialAiServerAvailable: () => true,
}));
vi.mock('../lib/quota', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, reserveOfficialAttempt: mocks.reserve, settleOfficialAttempt: mocks.settle, releaseOfficialAttempt: mocks.release };
});
vi.mock('../lib/groq', async importOriginal => ({ ...await importOriginal(), analyzeWithGroq: mocks.analyze }));

function response() { return { statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } }; }
const body = { text: 'Entirely fictional resume text for the offline API gate.', jobTitle: 'Engineer', education: '不便提供', reportLanguage: 'zh', requestId: 'd2719f81-2f77-4a55-9a23-efc2d2cb99a1' };

describe('roast acceptance gate reservation handling (all storage and upstream mocked)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    for (const [key, value] of Object.entries({ NEXTAUTH_URL: 'https://resume.example.test', NEXTAUTH_SECRET: 'offline-auth-secret-over-16', GROQ_API_KEY: 'fixture-key', GROQ_MODEL: 'openai/gpt-oss-120b', GROQ_QUOTA_MIGRATION_ENABLED: 'true', GROQ_UPSTREAM_ENABLED: 'true' })) vi.stubEnv(key, value);
    mocks.session.mockResolvedValue({ user: { id: 'fixture-user' } });
    mocks.reserve.mockResolvedValue({ kind: 'reserved', attemptId: 'fixture-attempt', leaseToken: 'fixture-lease' });
    mocks.release.mockResolvedValue(true);
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(['ACCEPTANCE_BUDGET_SPENT', 'ACCEPTANCE_BUDGET_UNAVAILABLE'])('releases the new reservation on %s without settling or exposing details', async code => {
    mocks.analyze.mockRejectedValue(Object.assign(new Error('fixture-key confidential resume'), { code }));
    const res = response();
    await handler({ method: 'POST', headers: { origin: 'https://resume.example.test' }, body }, res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Analysis service is currently unavailable.' } });
    expect(mocks.release).toHaveBeenCalledWith({ attemptId: 'fixture-attempt', leaseToken: 'fixture-lease' });
    expect(mocks.settle).not.toHaveBeenCalled();
    expect(JSON.stringify(res.body)).not.toMatch(/fixture-key|confidential resume/);
  });

  it.each(['UPSTREAM_TIMEOUT', 'UPSTREAM_NETWORK'])('preserves uncertain reservation semantics on %s', async code => {
    mocks.analyze.mockRejectedValue(Object.assign(new Error(code), { code }));
    const res = response();
    await handler({ method: 'POST', headers: { origin: 'https://resume.example.test' }, body }, res);
    expect(res.statusCode).toBe(code === 'UPSTREAM_TIMEOUT' ? 504 : 502);
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled();
  });
});
