import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { customAiRequest, hasSecureCustomAiTransport } from '../lib/customAiClient';

function response(body = { ok: true, config: null }, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}
beforeEach(() => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response())); });
afterEach(() => vi.unstubAllGlobals());

describe('custom AI configuration client transport', () => {
  it('only allows secure transport with explicit local development exceptions', () => {
    expect(hasSecureCustomAiTransport({ protocol: 'https:', hostname: 'app.example' })).toBe(true);
    expect(hasSecureCustomAiTransport({ protocol: 'http:', hostname: 'localhost' })).toBe(true);
    expect(hasSecureCustomAiTransport({ protocol: 'http:', hostname: 'app.example' })).toBe(false);
  });

  it.each(['GET', 'DELETE'])('sends %s configuration with no body and no caching, redirects, or retry', async (method) => {
    await customAiRequest('/api/custom-ai/config', undefined, { method, ...(method === 'DELETE' ? { headers: { 'If-Match': 'opaque_version' } } : {}) });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/api/custom-ai/config', expect.objectContaining({ method, body: undefined, credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' }));
    expect(fetch.mock.calls[0][1].headers).toEqual(method === 'DELETE' ? { 'If-Match': 'opaque_version' } : {});
  });

  it.each([{ 'If-None-Match': '*' }, { 'If-Match': 'opaque_version' }, { 'if-match': '"opaque_version"' }])('permits a single supported conditional PUT header %j', async (headers) => {
    const config = { baseUrl: 'https://api.provider.com/v1', apiKey: 'new-key', model: 'model' };
    await customAiRequest('/api/custom-ai/config', { config }, { method: 'PUT', headers });
    expect(fetch.mock.calls[0][1].method).toBe('PUT');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ config });
  });

  it.each([
    ['/api/custom-ai/config', undefined, { method: 'PATCH' }],
    ['https://other.example/api/custom-ai/config', undefined, { method: 'GET' }],
    ['/api/custom-ai/analyze', undefined, { method: 'GET' }],
    ['/api/custom-ai/test', {}, { method: 'PUT' }],
    ['/api/custom-ai/config', {}, { method: 'GET' }],
    ['/api/custom-ai/config', {}, { method: 'DELETE' }],
    ['/api/custom-ai/config', {}, { method: 'PUT', headers: { Authorization: 'secret' } }],
    ['/api/custom-ai/config', {}, { method: 'PUT', headers: { 'If-Match': '*' } }],
    ['/api/custom-ai/config', {}, { method: 'PUT', headers: { 'If-Match': 'W/"weak"' } }],
    ['/api/custom-ai/config', {}, { method: 'PUT', headers: { 'If-Match': 'one,two' } }],
    ['/api/custom-ai/config', {}, { method: 'PUT', headers: { 'If-Match': 'one', 'If-None-Match': '*' } }],
    ['/api/custom-ai/config', undefined, { method: 'DELETE', headers: { 'If-None-Match': '*' } }],
  ])('rejects unsupported request combinations before fetch', async (path, body, options) => {
    await expect(customAiRequest(path, body, options)).rejects.toMatchObject({ code: 'REQUEST_FAILED' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([[412, 'CONFIG_VERSION_CONFLICT'], [428, 'CONFIG_PRECONDITION_REQUIRED']])('preserves safe HTTP %s precondition semantics', async (status, code) => {
    fetch.mockResolvedValueOnce(response({ ok: false, error: { code: 'PRIVATE_SERVER_DETAIL' } }, status));
    await expect(customAiRequest('/api/custom-ai/config', {}, { method: 'PUT' })).rejects.toMatchObject({ code });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry failures or expose server response details', async () => {
    fetch.mockRejectedValueOnce(new Error('private credentials or address'));
    await expect(customAiRequest('/api/custom-ai/test', {})).rejects.toMatchObject({ code: 'REQUEST_FAILED', message: 'REQUEST_FAILED' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not fetch an already aborted operation', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(customAiRequest('/api/custom-ai/config', undefined, { method: 'GET', signal: controller.signal })).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
