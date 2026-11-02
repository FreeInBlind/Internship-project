import { describe, expect, it, vi, beforeEach } from 'vitest';
import handler from '../pages/api/upload';
import { getServerSession } from 'next-auth/next';
import { decodeUtf8Text, validateUploadMetadata, validateText } from '../lib/extraction';

vi.mock('next-auth/next', () => ({ getServerSession: vi.fn() }));
vi.mock('../lib/auth', () => ({ authOptions: {}, normalizeSession: (session) => session }));

function response() { return { headers: {}, statusCode: null, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } }; }
function request(body = {}, method = 'POST') { return { method, body, headers: { origin: 'http://localhost:3000' } }; }

describe('stage 3 extraction contracts', () => {
  beforeEach(() => { process.env.NEXTAUTH_URL = 'http://localhost:3000'; vi.clearAllMocks(); });
  it('validates supported metadata and 3MB boundary', () => {
    expect(validateUploadMetadata({ fileName: 'resume.txt', fileSize: 3 * 1024 * 1024 }).ok).toBe(true);
    expect(validateUploadMetadata({ fileName: 'resume.txt', fileSize: 3 * 1024 * 1024 + 1 }).code).toBe('FILE_TOO_LARGE');
    expect(validateUploadMetadata({ fileName: 'resume.exe', fileSize: 1 }).code).toBe('UNSUPPORTED_TYPE');
  });
  it('decodes UTF-8 with BOM and rejects binary content', () => {
    expect(decodeUtf8Text(new TextEncoder().encode('﻿中文 resume').buffer).text).toBe('中文 resume');
    expect(decodeUtf8Text(new Uint8Array([0xff, 0xfe]).buffer).code).toBe('INVALID_ENCODING');
    expect(decodeUtf8Text(new Uint8Array([0, 1, 2]).buffer).code).toBe('BINARY_TEXT');
  });
  it('rejects empty text and preserves confirmed text', () => {
    expect(validateText('  ').code).toBe('EMPTY_TEXT');
    expect(validateText('  fake resume  ').text).toBe('  fake resume  ');
  });
  it('requires authenticated session and ignores client userId', async () => {
    getServerSession.mockResolvedValueOnce(null);
    const unauth = response();
    await handler(request({ text: 'x', userId: 'attacker' }), unauth);
    expect(unauth.statusCode).toBe(401);
    getServerSession.mockResolvedValueOnce({ user: { id: 'server-user' } });
    const forged = response();
    await handler(request({ text: 'confirmed', userId: 'attacker' }), forged);
    expect(forged.statusCode).toBe(400);
    getServerSession.mockResolvedValueOnce({ user: { id: 'server-user' } });
    const auth = response();
    await handler(request({ text: '  confirmed  ', fileName: 'x.txt', fileType: 'txt' }), auth);
    expect(auth.statusCode).toBe(200);
    expect(auth.body.extraction.text).toBe('  confirmed  ');
    expect(auth.body).not.toHaveProperty('userId');
  });
  it('accepts 200000 Chinese characters and rejects an untrusted origin', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'server-user' } });
    const chinese = response();
    await handler(request({ text: '中'.repeat(200000) }), chinese);
    expect(chinese.statusCode).toBe(200);
    const foreign = request({ text: 'fake resume' });
    foreign.headers.origin = 'https://example.invalid';
    const rejected = response();
    await handler(foreign, rejected);
    expect(rejected.statusCode).toBe(403);
  });
  it('rejects non-POST and oversized text', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'server-user' } });
    const method = response(); await handler(request({}, 'GET'), method); expect(method.statusCode).toBe(405);
    const large = response(); await handler(request({ text: 'x'.repeat(200001) }), large); expect(large.statusCode).toBe(413); expect(large.body.error.code).toBe('TEXT_TOO_LARGE');
  });
});
