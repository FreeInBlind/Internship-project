import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import usersHandler from '../pages/api/users';

const { prisma, hashPassword, consumeRateLimit, getServerSession } = vi.hoisted(() => ({
  prisma: { user: { create: vi.fn(), findUnique: vi.fn() }, $executeRaw: vi.fn(), $queryRaw: vi.fn() },
  hashPassword: vi.fn(async (value) => `hash:${value}`),
  consumeRateLimit: vi.fn(async () => ({ allowed: true, retryAfter: 1 })),
  getServerSession: vi.fn(),
}));

vi.mock('../lib/db', () => ({ prisma }));
vi.mock('../lib/credentials', async () => {
  const actual = await vi.importActual('../lib/credentials');
  return { ...actual, hashPassword };
});
vi.mock('../lib/rate', () => ({ consumeRateLimit }));
vi.mock('next-auth/next', () => ({ getServerSession }));

function response() {
  return { headers: {}, statusCode: 200, body: null, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

function expectNoUndefined(value, path = '$') {
  if (value === undefined) throw new Error(`undefined at ${path}`);
  if (Array.isArray(value)) value.forEach((item, index) => expectNoUndefined(item, `${path}[${index}]`));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => expectNoUndefined(item, `${path}.${key}`));
}

describe('stage 2B authentication and authorization', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    consumeRateLimit.mockResolvedValue({ allowed: true, retryAfter: 1 });
    hashPassword.mockImplementation(async (value) => `hash:${value}`);
    process.env.NEXTAUTH_URL = 'https://resume.example.test';
    process.env.NEXTAUTH_SECRET = 'test-secret';
    prisma.user.create.mockResolvedValue({ id: 'u1' });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.$executeRaw.mockResolvedValue(0);
    prisma.$queryRaw.mockResolvedValue([{ count: 1, windowStart: new Date() }]);
  });
  afterEach(() => { delete process.env.NEXTAUTH_URL; delete process.env.NEXTAUTH_SECRET; });

  it('registers valid input with normalized email and generic success', async () => {
    const res = response();
    await usersHandler({ method: 'POST', headers: { origin: 'https://resume.example.test' }, socket: {}, body: { email: ' User@Example.test ', password: 'correct horse battery staple' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(prisma.user.create).toHaveBeenCalledWith({ data: { normalizedEmail: 'user@example.test', passwordHash: 'hash:correct horse battery staple' } });
  });

  it('rejects invalid input and untrusted origins before persistence', async () => {
    const invalid = response();
    await usersHandler({ method: 'POST', headers: { origin: 'https://resume.example.test' }, body: { email: 'bad', password: 'short' } }, invalid);
    expect(invalid.statusCode).toBe(400);
    expect(prisma.user.create).not.toHaveBeenCalled();

    const origin = response();
    await usersHandler({ method: 'POST', headers: { origin: 'https://evil.example.test' }, body: { email: 'a@example.test', password: 'correct horse battery staple' } }, origin);
    expect(origin.statusCode).toBe(403);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('accepts the 72-byte password boundary without truncation', async () => {
    const password = 'a'.repeat(72);
    const res = response();
    await usersHandler({ method: 'POST', headers: { origin: 'https://resume.example.test' }, socket: {}, body: { email: 'boundary@example.test', password } }, res);
    expect(res.statusCode).toBe(200);
    expect(hashPassword).toHaveBeenCalledWith(password);
  });

  it('keeps duplicate registration idempotent under a unique race', async () => {
    prisma.user.create.mockRejectedValue({ code: 'P2002' });
    const res = response();
    await usersHandler({ method: 'POST', headers: { origin: 'https://resume.example.test' }, socket: {}, body: { email: 'duplicate@example.test', password: 'correct horse battery staple' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('returns rate-limit and database failures without leaking details', async () => {
    consumeRateLimit.mockResolvedValueOnce({ allowed: false, retryAfter: 42 });
    const limited = response();
    await usersHandler({ method: 'POST', headers: { origin: 'https://resume.example.test' }, socket: {}, body: { email: 'a@example.test', password: 'correct horse battery staple' } }, limited);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['Retry-After']).toBe(42);
    expect(limited.body.error.code).toBe('RATE_LIMITED');

    consumeRateLimit.mockResolvedValue({ allowed: true, retryAfter: 1 });
    prisma.user.create.mockRejectedValue(new Error('database details'));
    const unavailable = response();
    await usersHandler({ method: 'POST', headers: { origin: 'https://resume.example.test' }, socket: {}, body: { email: 'b@example.test', password: 'correct horse battery staple' } }, unavailable);
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.body).toEqual({ ok: false, error: { code: 'UNAVAILABLE', message: 'Service unavailable.' } });
  });

  it('requires an authenticated server session for protected APIs and SSR pages', async () => {
    const { privatePlaceholder, requireSession } = await import('../lib/requireSession.js');
    getServerSession.mockResolvedValue(null);
    const apiRes = response();
    await privatePlaceholder({}, apiRes, 'hidden');
    expect(apiRes.statusCode).toBe(401);
    expect(apiRes.body.error.code).toBe('UNAUTHORIZED');

    const context = { req: {}, res: response(), resolvedUrl: '/settings?tab=account' };
    const page = await requireSession(context);
    expect(page.redirect.destination).toBe('/login?callbackUrl=%2Fsettings%3Ftab%3Daccount');
    expect(context.res.headers['Cache-Control']).toBe('private, no-store');
  });

  it('enforces bcrypt UTF-8 length boundaries without truncation', async () => {
    const { passwordBytesValid, hashPassword: realHash, verifyPassword } = await vi.importActual('../lib/credentials');
    expect(passwordBytesValid('a'.repeat(11))).toBe(false);
    expect(passwordBytesValid('a'.repeat(12))).toBe(true);
    expect(passwordBytesValid('é'.repeat(36))).toBe(true);
    expect(passwordBytesValid('é'.repeat(37))).toBe(false);
    const password = 'a'.repeat(71) + 'b';
    const hash = await realHash(password);
    expect(await verifyPassword(password, hash)).toBe(true);
    expect(await verifyPassword('a'.repeat(71) + 'c', hash)).toBe(false);
  });

  it('rejects unknown users and wrong passwords at login', async () => {
    const { authOptions } = await import('../lib/auth.js');
    const authorize = authOptions.providers[0].options.authorize;
    expect(await authorize({ email: 'unknown@example.test', password: 'correct horse battery staple' }, { headers: {} })).toBeNull();
    const { hashPassword: realHash } = await vi.importActual('../lib/credentials');
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', normalizedEmail: 'a@example.test', passwordHash: await realHash('correct horse battery staple') });
    consumeRateLimit.mockResolvedValue({ allowed: true, retryAfter: 1 });
    expect(await authorize({ email: 'a@example.test', password: 'incorrect password here' }, { headers: {} })).toBeNull();
    expect(await authorize({ email: 'A@EXAMPLE.TEST', password: 'correct horse battery staple' }, { headers: {} })).toEqual({ id: 'u1', email: 'a@example.test' });
    consumeRateLimit.mockResolvedValue({ allowed: false, retryAfter: 10 });
    prisma.user.findUnique.mockClear();
    expect(await authorize({ email: 'a@example.test', password: 'correct horse battery staple' }, { headers: {} })).toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects unsafe redirects and allows authenticated server access', async () => {
    const { privatePlaceholder, requireSession } = await import('../lib/requireSession.js');
    getServerSession.mockResolvedValue(null);
    const context = { req: {}, res: response(), resolvedUrl: '//evil.test' };
    expect((await requireSession(context)).redirect.destination).toBe('/login?callbackUrl=%2Fupload');
    const session = { expires: '2030-01-01T00:00:00.000Z', user: { id: 'user-1', email: undefined, name: undefined, image: undefined, passwordHash: 'secret-hash', accessToken: 'secret-token' }, token: 'secret-jwt' };
    getServerSession.mockResolvedValue(session);
    const page = await requireSession(context);
    expect(page).toEqual({ props: { session: { expires: session.expires, user: { id: 'user-1', email: null, name: null, image: null } } } });
    expectNoUndefined(page.props);
    expect(JSON.stringify(page.props)).not.toMatch(/passwordHash|secret-hash|accessToken|secret-token|secret-jwt/);
    const res = response();
    await privatePlaceholder({}, res, 'not implemented');
    expect(res.statusCode).toBe(501);
    expect(res.headers['Cache-Control']).toBe('private, no-store');
  });

  it('normalizes optional session fields without leaking token data', async () => {
    const { authOptions } = await import('../lib/auth.js');
    const token = await authOptions.callbacks.jwt({ token: { role: 'admin', passwordHash: 'secret-hash', accessToken: 'secret-token' }, user: { id: 'u1' } });
    const session = await authOptions.callbacks.session({ session: { expires: '2030-01-01T00:00:00.000Z', user: { id: 'client-id', email: undefined, name: undefined, image: undefined }, nested: { optional: undefined } }, token });
    expect(token.userId).toBe('u1');
    expect(session).toEqual({ expires: '2030-01-01T00:00:00.000Z', user: { id: 'u1', email: null, name: null, image: null } });
    expectNoUndefined(session);
    expect(JSON.stringify(session)).not.toMatch(/role|passwordHash|secret-hash|accessToken|secret-token/);
  });

  it('preserves valid public session fields while retaining the server id', async () => {
    const { authOptions } = await import('../lib/auth.js');
    const session = await authOptions.callbacks.session({ session: { expires: '2030-01-01T00:00:00.000Z', user: { id: 'client-id', email: 'fixture@example.invalid', name: 'Fixture User', image: 'https://example.invalid/avatar.png' } }, token: { userId: 'u2' } });
    expect(session).toEqual({ expires: '2030-01-01T00:00:00.000Z', user: { id: 'u2', email: 'fixture@example.invalid', name: 'Fixture User', image: 'https://example.invalid/avatar.png' } });
    expectNoUndefined(session);
  });
});
