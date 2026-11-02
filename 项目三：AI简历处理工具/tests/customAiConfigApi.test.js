// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler, { config as routeConfig } from '../pages/api/custom-ai/config';

const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), remove: vi.fn(), session: vi.fn(), origin: vi.fn() }));
vi.mock('next-auth/next', () => ({ getServerSession: mocks.session }));
vi.mock('../lib/auth', () => ({ authOptions: {} }));
vi.mock('../lib/origin', () => ({ hasTrustedOrigin: mocks.origin }));
vi.mock('../lib/db', () => ({ prisma: {} }));
vi.mock('node:dns', () => ({ lookup: vi.fn(() => { throw new Error('UNEXPECTED_DNS'); }) }));
vi.mock('node:https', () => ({ request: vi.fn(() => { throw new Error('UNEXPECTED_PROVIDER'); }) }));
vi.mock('../lib/customAiConfigStore', async importOriginal => ({
  ...await importOriginal(), getSavedCustomAiConfig: mocks.get, saveCustomAiConfig: mocks.save, deleteCustomAiConfig: mocks.remove,
}));

const token = 'a'.repeat(43);
const metadata = { baseUrl: 'https://api.provider.com/v1', model: 'model-a', hasKey: true, maskedKey: '••••••••',
  storage: 'account-encrypted', configVersion: token, updatedAt: '2026-11-02T00:00:00.000Z' };
const temporary = { baseUrl: metadata.baseUrl, model: metadata.model, apiKey: 'fixture-key-private' };
function response() { return { statusCode: null, headers: {}, setHeader(key, value) { this.headers[key] = value; },
  status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
async function call(method, { headers = {}, body } = {}) {
  const res = response();
  await handler({ method, headers, body }, res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 'owner-a' } });
  mocks.origin.mockReturnValue(true);
  mocks.get.mockResolvedValue({ config: metadata, persistenceAvailable: true });
  mocks.save.mockResolvedValue(metadata);
  mocks.remove.mockResolvedValue(undefined);
});

describe('custom AI account configuration API', () => {
  it('limits config bodies to 32kb and returns metadata plus strong ETag without secrets', async () => {
    expect(routeConfig.api.bodyParser.sizeLimit).toBe('32kb');
    const res = await call('GET');
    expect(mocks.get).toHaveBeenCalledWith('owner-a');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, config: metadata, persistenceAvailable: true });
    expect(res.headers.ETag).toBe(`"${token}"`);
    expect(res.headers['Cache-Control']).toBe('private, no-store');
    expect(res.headers.Pragma).toBe('no-cache');
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(JSON.stringify(res.body)).not.toContain(temporary.apiKey);
  });

  it('returns null when no config exists and preserves metadata when persistence is unavailable', async () => {
    mocks.get.mockResolvedValueOnce({ config: null, persistenceAvailable: false });
    expect((await call('GET')).body).toEqual({ ok: true, config: null, persistenceAvailable: false });
    mocks.get.mockResolvedValueOnce({ config: metadata, persistenceAvailable: false });
    expect((await call('GET')).body.config).toEqual(metadata);
  });

  it('accepts ordinary same-origin browser GET without Origin, but rejects cross-site reads and origin-less writes', async () => {
    mocks.origin.mockReturnValue(false);
    expect((await call('GET', { headers: { 'sec-fetch-site': 'same-origin' } })).statusCode).toBe(200);
    expect((await call('GET')).statusCode).toBe(200);
    expect((await call('GET', { headers: { 'sec-fetch-site': 'cross-site' } })).statusCode).toBe(403);
    expect((await call('GET', { headers: { origin: 'https://evil.invalid' } })).statusCode).toBe(403);
    for (const method of ['POST', 'PUT', 'DELETE']) expect((await call(method)).statusCode).toBe(403);
  });

  it('requires account authentication for both read and mutation', async () => {
    mocks.session.mockResolvedValue({ user: {} });
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) expect((await call(method)).statusCode).toBe(401);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('keeps temporary POST validation independent of persistence and storage availability', async () => {
    const res = await call('POST', { body: { config: temporary } });
    expect(res.statusCode).toBe(200);
    expect(res.body.config).toEqual({ configured: true, baseUrl: temporary.baseUrl, model: temporary.model, hasKey: true, maskedKey: '••••••••', storage: 'page-memory' });
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('requires explicit first-save precondition and accepts quoted update versions', async () => {
    const first = await call('PUT', { headers: { 'if-none-match': '*' }, body: { config: temporary } });
    expect(first.statusCode).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith('owner-a', temporary, { create: true });
    const edit = { baseUrl: temporary.baseUrl, model: 'model-b' };
    await call('PUT', { headers: { 'if-match': `"${token}"` }, body: { config: edit } });
    expect(mocks.save).toHaveBeenCalledWith('owner-a', edit, { version: token });
  });

  it('requires mutation versions with 428, rejects weak validators, and returns 412 for races', async () => {
    for (const method of ['PUT', 'DELETE']) {
      const res = await call(method, { body: { config: temporary } });
      expect(res.statusCode).toBe(428);
      expect(res.body.error.code).toBe('CONFIG_PRECONDITION_REQUIRED');
    }
    expect((await call('DELETE', { headers: { 'if-match': `W/"${token}"` } })).statusCode).toBe(422);
    mocks.save.mockRejectedValueOnce(Object.assign(new Error('SQL fixture-key-private'), { code: 'CONFIG_VERSION_CONFLICT' }));
    const stale = await call('PUT', { headers: { 'if-match': token }, body: { config: temporary } });
    expect(stale.statusCode).toBe(412);
    expect(JSON.stringify(stale.body)).not.toContain(temporary.apiKey);
  });

  it('deletes without key access and returns the chosen empty config contract', async () => {
    const res = await call('DELETE', { headers: { 'if-match': token } });
    expect(mocks.remove).toHaveBeenCalledWith('owner-a', token);
    expect(res.body).toEqual({ ok: true, config: null });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each([['AI_CONFIG_ENCRYPTION_UNAVAILABLE', 503], ['AI_CONFIG_DECRYPTION_FAILED', 503], ['AI_CONFIG_STORAGE_UNAVAILABLE', 503], ['API_KEY_REQUIRED', 422]])('exposes only safe %s errors', async (code, status) => {
    mocks.save.mockRejectedValueOnce(Object.assign(new Error('private SQL credential'), { code }));
    const res = await call('PUT', { headers: { 'if-match': token }, body: { config: temporary } });
    expect(res.statusCode).toBe(status);
    expect(res.body.error.code).toBe(code);
    expect(JSON.stringify(res.body)).not.toContain('private SQL credential');
  });
});
