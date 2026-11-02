import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../pages/api/custom-ai/test';

const mocks = vi.hoisted(() => ({ guard: vi.fn(), validate: vi.fn(), test: vi.fn(), begin: vi.fn(), abort: vi.fn() }));
vi.mock('../lib/customAiReport', () => ({ testCustomAiConnection: mocks.test }));
vi.mock('../lib/customAiConfigStore', () => ({ validateCustomAiConfig: mocks.validate, loadSavedCustomAiConfig: vi.fn() }));
vi.mock('../lib/customAiApi', () => ({
  beginCustomAiRequest: mocks.begin,
  customAiAbortSignal: mocks.abort,
  customAiFail: (res, status, code) => res.status(status).json({ ok: false, error: { code } }),
  customAiPublicError: (res, error) => res.status(502).json({ ok: false, error: { code: error.code || 'UPSTREAM_UNAVAILABLE' } }),
  guardCustomAi: mocks.guard,
  validCustomAiBody: (body, fields) => body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).every(key => fields.includes(key)),
}));

const config = { baseUrl: 'https://provider.example/v1', apiKey: 'fixture-key', model: 'fixture-model' };
const requestId = 'd2719f81-2f77-4a55-9a23-efc2d2cb99a1';
function response() { return { statusCode: null, headers: {}, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
function request(body = { config, requestId }) { return { method: 'POST', body, once: vi.fn(), removeListener: vi.fn() }; }

beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockResolvedValue('user-1');
  mocks.validate.mockReturnValue({ ...config });
  mocks.begin.mockReturnValue({ release: vi.fn() });
  mocks.abort.mockReturnValue({ signal: new AbortController().signal, cleanup: vi.fn() });
  mocks.test.mockResolvedValue({ ok: true });
});

describe('custom AI explicit connection-test API', () => {
  it('validates and sends one request, returning no provider output or key', async () => {
    const res = response();
    await handler(request(), res);
    expect(mocks.test).toHaveBeenCalledTimes(1);
    expect(mocks.test).toHaveBeenCalledWith(config, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(JSON.stringify(res.body)).not.toContain(config.apiKey);
    expect(mocks.begin).toHaveBeenCalledWith('user-1', requestId);
  });

  it('rejects absent configuration before opening an upstream attempt', async () => {
    const res = response();
    await handler(request({ requestId }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
    expect(mocks.test).not.toHaveBeenCalled();
  });

  it('returns only a fixed public error and releases the request guard', async () => {
    const attempt = { release: vi.fn() };
    mocks.begin.mockReturnValue(attempt);
    mocks.test.mockRejectedValue(new Error(`${config.apiKey} provider-private-detail`));
    const res = response();
    await handler(request(), res);
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ ok: false, error: { code: 'UPSTREAM_UNAVAILABLE' } });
    expect(JSON.stringify(res.body)).not.toContain(config.apiKey);
    expect(JSON.stringify(res.body)).not.toContain('provider-private-detail');
    expect(attempt.release).toHaveBeenCalledOnce();
  });
});
