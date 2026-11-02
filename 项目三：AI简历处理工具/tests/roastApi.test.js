import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../pages/api/roast';
const { getServerSession } = vi.hoisted(() => ({ getServerSession: vi.fn() }));
vi.mock('next-auth/next', () => ({ getServerSession }));
// Retain coverage of the dormant implementation; default closure has its own suite.
vi.mock('../lib/aiAvailability', () => ({ officialAiAvailable: () => true, officialAiServerAvailable: () => true }));
vi.mock('../lib/auth', () => ({ authOptions: {} }));
function response() { return { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } }; }
describe('roast API safety gate', () => {
  beforeEach(() => { vi.resetAllMocks(); process.env.NEXTAUTH_URL = 'https://resume.example.test'; delete process.env.GROQ_QUOTA_MIGRATION_ENABLED; delete process.env.GROQ_UPSTREAM_ENABLED; });
  it('requires session and trusted origin; rejects extra fields', async () => {
    getServerSession.mockResolvedValue(null);
    let res = response(); await handler({ method: 'POST', headers: { origin: 'https://resume.example.test' }, body: {} }, res);
    expect(res.statusCode).toBe(401);
    getServerSession.mockResolvedValue({ user: { id: 'u1' } });
    res = response(); await handler({ method: 'POST', headers: { origin: 'https://evil.test' }, body: {} }, res); expect(res.statusCode).toBe(403);
    res = response(); await handler({ method: 'POST', headers: { origin: 'https://resume.example.test' }, body: { prompt: 'x' } }, res); expect(res.statusCode).toBe(400);
  });
  it('validates required fields and fails closed before any upstream call', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1' } });
    const base = { text: 'resume', jobTitle: 'Engineer', education: '不便提供', reportLanguage: 'zh' };
    const body = { ...base, text: 'A sufficiently detailed resume text for analysis.', requestId: 'd2719f81-2f77-4a55-9a23-efc2d2cb99a1' };
    let res = response(); await handler({ method: 'POST', headers: { origin: 'https://resume.example.test' }, body }, res);
    expect(res.statusCode).toBe(503); expect(res.body.error.code).toBe('SERVICE_DISABLED');
    res = response(); await handler({ method: 'POST', headers: { origin: 'https://resume.example.test' }, body: { ...body, jobTitle: '' } }, res); expect(res.statusCode).toBe(422);
  });
});
