// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../pages/api/roast';
import { officialAiAvailable } from '../lib/aiAvailability';

const mocks = vi.hoisted(() => ({ session: vi.fn(), config: vi.fn(), storage: vi.fn(), reserve: vi.fn(), settle: vi.fn(), release: vi.fn(), analyze: vi.fn(), fetch: vi.fn() }));
vi.mock('next-auth/next', () => ({ getServerSession: mocks.session }));
vi.mock('../lib/auth', () => ({ authOptions: {} }));
vi.mock('../lib/quota', () => ({ QuotaError: class extends Error {}, quotaStorageEnabled: mocks.storage, reserveOfficialAttempt: mocks.reserve, settleOfficialAttempt: mocks.settle, releaseOfficialAttempt: mocks.release }));
vi.mock('../lib/groq', () => ({ GroqError: class extends Error {}, GROQ_MAX_INPUT_CHARS: 20000, readGroqConfig: mocks.config, analyzeWithGroq: mocks.analyze }));
function response() { return { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } }; }
const headers = { origin: 'https://resume.example.test' };
const valid = { text: 'Entirely fictional resume.', jobTitle: 'Engineer', education: 'Not provided', reportLanguage: 'en', requestId: 'd2719f81-2f77-4a55-9a23-efc2d2cb99a1' };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NEXTAUTH_URL', headers.origin);
  vi.stubEnv('GROQ_UPSTREAM_ENABLED', 'true');
  vi.stubEnv('GROQ_QUOTA_MIGRATION_ENABLED', 'true');
  vi.stubEnv('GROQ_API_KEY', 'offline-fixture-not-a-real-key');
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.session.mockResolvedValue({ user: { id: 'fixture-user' } });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function expectNoAnalysisEffects() {
  for (const fn of [mocks.config, mocks.storage, mocks.reserve, mocks.settle, mocks.release, mocks.analyze, mocks.fetch]) expect(fn).not.toHaveBeenCalled();
}
describe('official AI is closed by default, independent of old environment flags', () => {
  it('cannot be reopened by inherited environment switches', () => { expect(officialAiAvailable()).toBe(false); });
  it.each([valid, {}, null, { ...valid, provider: 'custom', baseUrl: 'https://provider.example.test/v1' }])('rejects direct POST before parsing input or touching any analysis dependency', async body => {
    const res = response();
    await handler({ method: 'POST', headers, body }, res);
    expect(res.statusCode).toBe(503);
    expect(res.headers['Cache-Control']).toBe('private, no-store');
    expect(res.body).toEqual({ ok: false, error: { code: 'SERVICE_DISABLED', message: 'Official AI is currently unavailable.' } });
    expect(res.body.report).toBeUndefined();
    expectNoAnalysisEffects();
  });
  it('retains method, genuine session and same-origin guards', async () => {
    let res = response();
    await handler({ method: 'GET', headers }, res);
    expect(res.statusCode).toBe(405); expect(res.headers.Allow).toBe('POST'); expect(mocks.session).not.toHaveBeenCalled();
    mocks.session.mockResolvedValueOnce(null);
    res = response(); await handler({ method: 'POST', headers, body: valid }, res); expect(res.statusCode).toBe(401);
    res = response(); await handler({ method: 'POST', headers: { origin: 'https://untrusted.example.test' }, body: valid }, res); expect(res.statusCode).toBe(403);
    expectNoAnalysisEffects();
  });
});
