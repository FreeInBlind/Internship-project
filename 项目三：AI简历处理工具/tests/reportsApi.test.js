import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import listHandler, { config as listConfig } from '../pages/api/reports/index';
import detailHandler, { config as detailConfig } from '../pages/api/reports/[id]';
import cleanupHandler from '../pages/api/cron/cleanup';
import { readReportBody } from '../lib/reportsApi';

const mocks = vi.hoisted(() => ({ session: vi.fn(), create: vi.fn(), list: vi.fn(), get: vi.fn(), patch: vi.fn(), remove: vi.fn(), cleanup: vi.fn() }));
vi.mock('next-auth/next', () => ({ getServerSession: mocks.session }));
vi.mock('../lib/auth', () => ({ authOptions: {} }));
vi.mock('../lib/reports', () => ({
  createSavedReport: mocks.create, listSavedReports: mocks.list, getActiveSavedReport: mocks.get,
  updateSavedReport: mocks.patch, deleteSavedReport: mocks.remove, cleanupExpiredReports: mocks.cleanup,
  reportDTO: row => { const { userId, ...dto } = row; return dto; },
}));
const id = 'd2719f81-2f77-4a55-9a23-efc2d2cb99a1';
const version = 'a'.repeat(64);
const saveBody = () => ({ saveId: id, title: 'Title', confirmedResumeText: 'resume', jobTitle: 'role', education: 'degree', reportLanguage: 'en', editedMarkdown: '# report' });
const row = () => ({ id, userId: 'owner', title: 'Title', confirmedResumeText: 'resume', jobTitle: 'role', education: 'degree', optionalJd: null, salary: null, reportLanguage: 'en', editedMarkdown: '# report', reportJson: null, createdAt: '2030-01-01T00:00:00.000Z', updatedAt: '2030-01-01T00:00:00.000Z', expiresAt: '2030-01-15T00:00:00.000Z', version });
function request(method = 'GET', extra = {}) { return { method, headers: { origin: 'https://app.example' }, query: {}, ...extra }; }
function response() { return { headers: {}, statusCode: null, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { this.ended = true; return this; } }; }
async function call(handler, req) { const res = response(); await handler(req, res); expect(res.headers['Cache-Control']).toBe('private, no-store'); return res; }

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers(); vi.setSystemTime(new Date('2030-01-02T00:00:00Z'));
  vi.stubEnv('NEXTAUTH_URL', 'https://app.example'); vi.stubEnv('CRON_SECRET', 'synthetic-cron-secret');
  mocks.session.mockResolvedValue({ user: { id: 'owner' } });
  mocks.create.mockResolvedValue({ report: row(), created: true });
  mocks.list.mockResolvedValue({ items: [{ id, title: 'Title' }], nextCursor: null });
  mocks.get.mockResolvedValue(row()); mocks.patch.mockResolvedValue(row()); mocks.remove.mockResolvedValue(true); mocks.cleanup.mockResolvedValue(2);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('saved report API guards and response shapes', () => {
  it('disables automatic body parsing so all errors keep the JSON/no-store contract', () => {
    expect(listConfig.api.bodyParser).toBe(false); expect(detailConfig.api.bodyParser).toBe(false);
  });
  it('authenticates reads and allows missing Origin on GET only', async () => {
    const res = await call(listHandler, request('GET', { headers: {} }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, items: [{ id, title: 'Title' }], nextCursor: null });
    mocks.session.mockResolvedValue(null);
    const denied = await call(detailHandler, request('GET', { headers: {}, query: { id } }));
    expect(denied.statusCode).toBe(401); expect(denied.body).toEqual({ ok: false, error: { code: 'UNAUTHORIZED' } });
  });
  it('requires exact trusted Origin for writes, rejects cross-origin reads and fails closed on missing configuration', async () => {
    for (const headers of [{}, { origin: 'https://evil.example' }, { origin: 'https://app.example.evil.example' }, { origin: 'https://app.example/path' }, { origin: 'https://user@app.example' }, { origin: ['https://app.example'] }]) {
      const res = await call(listHandler, request('POST', { headers, body: saveBody() }));
      expect(res.statusCode).toBe(403);
    }
    expect((await call(listHandler, request('GET', { headers: { origin: 'https://evil.example' } }))).statusCode).toBe(403);
    vi.stubEnv('NEXTAUTH_URL', '');
    expect((await call(listHandler, request('POST', { body: saveBody() }))).statusCode).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('uses 405/Allow and hides session/database failures', async () => {
    const wrong = await call(listHandler, request('PUT'));
    expect(wrong.statusCode).toBe(405); expect(wrong.headers.Allow).toBe('GET, POST');
    mocks.session.mockRejectedValue(new Error('secret session detail'));
    const unavailable = await call(listHandler, request());
    expect(unavailable.statusCode).toBe(503); expect(JSON.stringify(unavailable.body)).not.toContain('secret');
  });
  it('validates pagination without allowing owner/query overrides', async () => {
    const res = await call(listHandler, request('GET', { query: { limit: '20', cursor: 'cursor' } }));
    expect(res.statusCode).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith({ userId: 'owner', limit: 20, cursor: 'cursor' });
    for (const query of [{ limit: '0' }, { limit: ['20'] }, { cursor: ['x'] }, { userId: 'other' }]) expect((await call(listHandler, request('GET', { query }))).statusCode).toBe(422);
  });
  it('POST returns only DTO and ETag, uses session owner, and returns 200 for duplicate', async () => {
    const res = await call(listHandler, request('POST', { body: saveBody() }));
    expect(res.statusCode).toBe(201); expect(res.body.ok).toBe(true); expect(res.body.report).not.toHaveProperty('userId');
    expect(res.headers.ETag).toBe(`"${version}"`);
    expect(mocks.create).toHaveBeenCalledWith({ ...saveBody(), userId: 'owner' });
    mocks.create.mockResolvedValue({ report: row(), created: false });
    expect((await call(listHandler, request('POST', { body: saveBody() }))).statusCode).toBe(200);
    expect((await call(listHandler, request('POST', { body: { ...saveBody(), userId: 'other' } }))).statusCode).toBe(422);
  });
  it('GET details and PATCH reject missing/stale versions, forged fields and gone records', async () => {
    const req = request('PATCH', { query: { id }, body: { title: 'Updated' } });
    expect((await call(detailHandler, req)).statusCode).toBe(428);
    req.headers['if-match'] = '*';
    expect((await call(detailHandler, req)).statusCode).toBe(412);
    req.headers['if-match'] = `"${version}"`;
    const res = await call(detailHandler, req);
    expect(res.statusCode).toBe(200);
    expect(mocks.patch).toHaveBeenCalledWith({ userId: 'owner', id, version, title: 'Updated' });
    expect((await call(detailHandler, { ...req, body: { title: 'Updated', userId: 'other' } })).statusCode).toBe(422);
    expect((await call(detailHandler, { ...req, body: { expiresAt: 'later' } })).statusCode).toBe(422);
    mocks.get.mockResolvedValue(null);
    expect((await call(detailHandler, request('GET', { query: { id } }))).statusCode).toBe(404);
    mocks.patch.mockResolvedValue(null);
    expect((await call(detailHandler, req)).statusCode).toBe(404);
    expect((await call(detailHandler, request('GET', { query: { id: ['x'] } }))).statusCode).toBe(404);
  });
  it('rejects expiry equality immediately before returning a DTO', async () => {
    mocks.get.mockResolvedValue({ ...row(), expiresAt: new Date().toISOString() });
    const res = await call(detailHandler, request('GET', { query: { id } }));
    expect(res.statusCode).toBe(404); expect(res.body).toEqual({ ok: false, error: { code: 'NOT_FOUND' } });
  });
  it('DELETE sends no report body and supports expired owned records', async () => {
    const res = await call(detailHandler, request('DELETE', { query: { id } }));
    expect(res.statusCode).toBe(204); expect(res.ended).toBe(true); expect(res.body).toBeUndefined();
    expect(mocks.remove).toHaveBeenCalledWith({ userId: 'owner', id });
    mocks.remove.mockResolvedValue(false);
    expect((await call(detailHandler, request('DELETE', { query: { id } }))).statusCode).toBe(404);
  });
  it.each([['SAVE_ID_CONFLICT', 409], ['VERSION_CONFLICT', 412], ['NOT_FOUND', 404], ['INVALID_REPORT', 422], ['INPUT_TOO_LARGE', 413], ['P2025', 503]])('maps %s to a fixed safe error', async (code, status) => {
    mocks.create.mockRejectedValue(Object.assign(new Error('private database detail'), { code }));
    const res = await call(listHandler, request('POST', { body: saveBody() }));
    expect(res.statusCode).toBe(status);
    expect(res.body).toEqual({ ok: false, error: { code: status === 503 ? 'SERVICE_UNAVAILABLE' : code } });
  });
  it('streams bounded JSON and gives parser/size failures safe JSON responses', async () => {
    const raw = request('POST', { body: '{bad' });
    expect((await call(listHandler, raw)).statusCode).toBe(422);
    const huge = request('POST', { headers: { origin: 'https://app.example', 'content-length': '524289' }, body: saveBody() });
    expect((await call(listHandler, huge)).statusCode).toBe(413);
    const streamed = { headers: {}, async *[Symbol.asyncIterator]() { yield Buffer.from('{"title":'); yield Buffer.from('"ok"}'); } };
    expect(await readReportBody(streamed)).toEqual({ title: 'ok' });
    await expect(readReportBody({ headers: {}, async *[Symbol.asyncIterator]() { yield Buffer.alloc(524289); } })).rejects.toMatchObject({ code: 'INPUT_TOO_LARGE' });
    await expect(readReportBody({ headers: {}, body: Buffer.from([0xff]) })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('cleanup authentication and output', () => {
  it('requires configured secret and strict Bearer authorization before cleanup', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await call(cleanupHandler, request())).statusCode).toBe(503);
    vi.stubEnv('CRON_SECRET', 'synthetic-cron-secret');
    for (const authorization of [undefined, 'Bearer wrong', 'bearer synthetic-cron-secret', 'Bearer synthetic-cron-secret ', ['Bearer synthetic-cron-secret']]) expect((await call(cleanupHandler, request('GET', { headers: { authorization } }))).statusCode).toBe(401);
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });
  it('only invokes expired-report repository operation and returns a count', async () => {
    const res = await call(cleanupHandler, request('GET', { headers: { authorization: 'Bearer synthetic-cron-secret' } }));
    expect(res.statusCode).toBe(200); expect(res.body).toEqual({ ok: true, deleted: 2 });
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('does not run on wrong method and suppresses database details', async () => {
    expect((await call(cleanupHandler, request('POST'))).statusCode).toBe(405);
    expect(mocks.cleanup).not.toHaveBeenCalled();
    mocks.cleanup.mockRejectedValue(new Error('private detail'));
    const res = await call(cleanupHandler, request('GET', { headers: { authorization: 'Bearer synthetic-cron-secret' } }));
    expect(res.statusCode).toBe(503); expect(res.body).toEqual({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
  });
});
