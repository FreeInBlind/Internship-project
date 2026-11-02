// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import testHandler from '../pages/api/custom-ai/test';
import analyzeHandler, { config as analysisConfig } from '../pages/api/custom-ai/analyze';

const mocks = vi.hoisted(() => ({ load: vi.fn(), validate: vi.fn(), test: vi.fn(), analyze: vi.fn(), session: vi.fn(), origin: vi.fn(), markdown: vi.fn() }));
vi.mock('next-auth/next', () => ({ getServerSession: mocks.session }));
vi.mock('../lib/auth', () => ({ authOptions: {} }));
vi.mock('../lib/origin', () => ({ hasTrustedOrigin: mocks.origin }));
vi.mock('../lib/customAiConfigStore', () => ({ loadSavedCustomAiConfig: mocks.load, validateCustomAiConfig: mocks.validate }));
vi.mock('../lib/customAiReport', () => ({ testCustomAiConnection: mocks.test, analyzeWithCustomAi: mocks.analyze }));
vi.mock('../lib/reportSchema', () => ({ reportToMarkdown: mocks.markdown }));
// Any accidental official quota coupling fails module import; all provider work
// is represented by mocks above, never real network or official fallback.
vi.mock('../lib/quota', () => { throw new Error('CUSTOM_AI_MUST_NOT_IMPORT_OFFICIAL_QUOTA'); });

const token = 'b'.repeat(43);
const config = { baseUrl: 'https://api.provider.com/v1', model: 'saved-model', apiKey: 'fixture-saved-private-key' };
const metadata = { baseUrl: config.baseUrl, model: config.model, configVersion: token, hasKey: true, maskedKey: '••••••••',
  storage: 'account-encrypted', updatedAt: '2026-11-02T00:00:00.000Z' };
const input = { resumeText: 'fixture resume' };
let sequence = 0;
function nextId() { return `c2719f81-2f77-4a55-9a23-${(++sequence).toString().padStart(12, '0')}`; }
function response() { return { statusCode: null, headers: {}, setHeader(key, value) { this.headers[key] = value; },
  status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, once: vi.fn(), removeListener: vi.fn() }; }
async function call(handler, body) {
  const res = response();
  await handler({ method: 'POST', headers: { origin: 'https://workspace.local' }, body, once: vi.fn(), removeListener: vi.fn() }, res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 'owner-a' } });
  mocks.origin.mockReturnValue(true);
  mocks.load.mockResolvedValue({ config, metadata });
  mocks.validate.mockReturnValue(config);
  mocks.test.mockResolvedValue({ ok: true });
  mocks.analyze.mockResolvedValue({ title: 'fixture report' });
  mocks.markdown.mockReturnValue('fixture markdown');
});

describe.each([['test', testHandler], ['analyze', analyzeHandler]])('saved custom AI %s API', (_name, handler) => {
  function body(overrides = {}) { return { source: 'saved', configVersion: token, requestId: nextId(), ...(handler === analyzeHandler ? { input } : {}), ...overrides }; }
  function provider() { return handler === analyzeHandler ? mocks.analyze : mocks.test; }

  it('loads credentials only by authenticated owner and exact version and returns aligned metadata', async () => {
    const res = await call(handler, body());
    expect(mocks.load).toHaveBeenCalledWith('owner-a', token, undefined);
    expect(provider()).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, config: metadata, effectiveModel: config.model });
    expect(JSON.stringify(res.body)).not.toContain(config.apiKey);
    if (handler === analyzeHandler) expect(mocks.analyze).toHaveBeenCalledWith(input, expect.objectContaining({ config }));
    else expect(mocks.test).toHaveBeenCalledWith(config, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('supports a model-only override while preserving the original saved metadata', async () => {
    mocks.load.mockResolvedValueOnce({ config: { ...config, model: 'one-time-model' }, metadata });
    const res = await call(handler, body({ model: 'one-time-model' }));
    expect(mocks.load).toHaveBeenCalledWith('owner-a', token, 'one-time-model');
    expect(res.body.effectiveModel).toBe('one-time-model');
    expect(res.body.config.model).toBe('saved-model');
  });

  it('rejects saved/temp mixtures and endpoint or credential overrides before loading or sending', async () => {
    for (const extra of [{ config }, { baseUrl: config.baseUrl }, { apiKey: config.apiKey }, { userId: 'owner-b' }, { source: 'other' }]) {
      expect((await call(handler, body(extra))).statusCode).toBe(400);
    }
    expect(mocks.load).not.toHaveBeenCalled();
    expect(provider()).not.toHaveBeenCalled();
  });

  it('requires saved config version with 428 and stale versions fail 412 before provider work', async () => {
    expect((await call(handler, body({ configVersion: undefined }))).statusCode).toBe(428);
    expect(mocks.load).not.toHaveBeenCalled();
    mocks.load.mockRejectedValueOnce(Object.assign(new Error('private storage detail'), { code: 'CONFIG_VERSION_CONFLICT' }));
    const stale = await call(handler, body());
    expect(stale.statusCode).toBe(412);
    expect(stale.body.error.code).toBe('CONFIG_VERSION_CONFLICT');
    expect(provider()).not.toHaveBeenCalled();
    expect(JSON.stringify(stale.body)).not.toContain('private storage detail');
  });

  it.each(['AI_CONFIG_ENCRYPTION_UNAVAILABLE', 'AI_CONFIG_DECRYPTION_FAILED', 'AI_CONFIG_STORAGE_UNAVAILABLE'])('fails closed on %s without provider work', async code => {
    mocks.load.mockRejectedValueOnce(Object.assign(new Error(config.apiKey), { code }));
    const res = await call(handler, body());
    expect(res.statusCode).toBe(503);
    expect(res.body.error.code).toBe(code);
    expect(provider()).not.toHaveBeenCalled();
    expect(JSON.stringify(res.body)).not.toContain(config.apiKey);
  });

  it('retains requestId guard and does not retry the provider after a failure', async () => {
    const request = body();
    provider().mockRejectedValueOnce(new Error(`private provider ${config.apiKey}`));
    const first = await call(handler, request);
    expect(first.statusCode).toBe(502);
    expect(first.body.error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(JSON.stringify(first.body)).not.toContain(config.apiKey);
    const second = await call(handler, request);
    expect(second.statusCode).toBe(409);
    expect(second.body.error.code).toBe('REQUEST_ALREADY_HANDLED');
    expect(provider()).toHaveBeenCalledOnce();
  });

  it('rejects invalid request IDs and guards concurrent saved calls per account', async () => {
    const invalid = await call(handler, body({ requestId: 'not-a-request-id' }));
    expect(invalid.statusCode).toBe(422);
    expect(provider()).not.toHaveBeenCalled();
    let finish;
    let started;
    const entered = new Promise(resolve => { started = resolve; });
    provider().mockImplementationOnce(() => { started(); return new Promise(resolve => { finish = resolve; }); });
    const pending = call(handler, body());
    await entered;
    const concurrent = await call(handler, body());
    expect(concurrent.statusCode).toBe(409);
    expect(concurrent.body.error.code).toBe('REQUEST_IN_PROGRESS');
    expect(provider()).toHaveBeenCalledOnce();
    finish(handler === analyzeHandler ? { title: 'fixture report' } : { ok: true });
    expect((await pending).statusCode).toBe(200);
  });

  it('retains temporary path independently of master key and saved storage', async () => {
    const res = await call(handler, { config, requestId: nextId(), ...(handler === analyzeHandler ? { input } : {}) });
    expect(res.statusCode).toBe(200);
    expect(mocks.validate).toHaveBeenCalledWith(config);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(res.body.config).toBeUndefined();
  });
});

it('preserves the existing analysis body size limit', () => {
  expect(analysisConfig.api.bodyParser.sizeLimit).toBe('256kb');
});

it.each([config.apiKey, 'fixture-"quoted-key', 'fixture-\\backslash-key'])('rejects generated reports containing a decrypted key even when JSON escapes it', async (apiKey) => {
  mocks.load.mockResolvedValueOnce({ config: { ...config, apiKey }, metadata });
  mocks.analyze.mockResolvedValueOnce({ nested: [{ overview: `Provider echoed ${apiKey}` }] });
  const res = await call(analyzeHandler, { source: 'saved', configVersion: token, input, requestId: nextId() });
  expect(res.statusCode).toBe(502);
  expect(res.body.error.code).toBe('INVALID_REPORT');
  expect(JSON.stringify(res.body)).not.toContain(config.apiKey);
});
