// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Buffer } from 'node:buffer';
import { CustomAiError, isPublicAddress, normalizeCustomAiBaseUrl, postCustomAiChat, validateCustomAiEndpoint } from '../lib/customAiTransport';

// These module mocks are unconditional: no test can reach real DNS or HTTPS.
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns', () => ({ lookup: mocks.lookup }));
vi.mock('node:https', () => ({ request: mocks.request }));

const MAX_BYTES = 128 * 1024;
const input = { baseUrl: 'https://api.provider.com/v1', apiKey: 'fixture-key-do-not-disclose', body: { model: 'fixture-model', messages: [{ role: 'user', content: 'fixture-private-resume' }], stream: false } };
let exchanges;

function makeRequest(options, callback) {
  const req = new EventEmitter();
  req.destroy = vi.fn(() => { req.destroyed = true; return req; });
  req.end = vi.fn(() => req);
  exchanges.push({ options, callback, req });
  return req;
}

function start(overrides = {}) {
  return postCustomAiChat({ ...input, ...overrides });
}

function respond({ status = 200, headers = { 'content-type': 'application/json' }, complete = true } = {}, exchange = exchanges.at(-1)) {
  const res = new EventEmitter();
  res.headers = headers;
  res.statusCode = status;
  res.complete = complete;
  res.destroy = vi.fn(() => { res.destroyed = true; return res; });
  exchange.callback(res);
  return res;
}

function endJson(value, options) {
  const res = respond(options);
  res.emit('data', Buffer.from(JSON.stringify(value)));
  res.emit('end');
  res.emit('close');
  return res;
}

async function expectCode(promise, code) {
  await expect(promise).rejects.toMatchObject({ name: 'CustomAiError', code, message: code });
}

beforeEach(() => {
  exchanges = [];
  mocks.lookup.mockReset().mockImplementation((_hostname, _options, callback) => callback(null, [{ address: '93.184.216.34', family: 4 }]));
  mocks.request.mockReset().mockImplementation(makeRequest);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('DNS-only configuration save validation', () => {
  it('validates a public endpoint without making an HTTPS request', async () => {
    await expect(validateCustomAiEndpoint(input.baseUrl)).resolves.toBe(input.baseUrl);
    expect(mocks.lookup).toHaveBeenCalledOnce();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('rejects a private result in a mixed DNS answer before any provider request', async () => {
    mocks.lookup.mockImplementationOnce((_host, _options, callback) => callback(null, [
      { address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 },
    ]));
    await expectCode(validateCustomAiEndpoint(input.baseUrl), 'UNSAFE_UPSTREAM_ADDRESS');
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('performs fresh DNS validation for a provider call after a successful save', async () => {
    await validateCustomAiEndpoint(input.baseUrl);
    mocks.lookup.mockImplementationOnce((_host, _options, callback) => callback(null, [{ address: '10.0.0.1', family: 4 }]));
    await expectCode(start(), 'UNSAFE_UPSTREAM_ADDRESS');
    expect(mocks.lookup).toHaveBeenCalledTimes(2);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('returns a safe DNS error and times out DNS without creating provider traffic', async () => {
    mocks.lookup.mockImplementationOnce((_host, _options, callback) => callback(new Error('private resolver detail')));
    await expectCode(validateCustomAiEndpoint(input.baseUrl), 'UPSTREAM_DNS');
    vi.useFakeTimers();
    mocks.lookup.mockImplementationOnce(() => {});
    const pending = validateCustomAiEndpoint(input.baseUrl);
    const rejected = expectCode(pending, 'UPSTREAM_DNS');
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(mocks.request).not.toHaveBeenCalled();
  });
});

describe('CustomAiError safe public information', () => {
  it('only exposes fixed code/message values, even for an unknown caller-supplied code', () => {
    const error = new CustomAiError(input.apiKey);
    expect(error).toMatchObject({ name: 'CustomAiError', code: 'UPSTREAM_UNAVAILABLE', message: 'UPSTREAM_UNAVAILABLE' });
    expect(String(error)).not.toContain(input.apiKey);
    expect(error.cause).toBeUndefined();
  });
});

describe('normalizeCustomAiBaseUrl', () => {
  it.each([
    ['https://API.Provider.COM', 'https://api.provider.com'],
    ['HTTPS://API.Provider.COM:443/', 'https://api.provider.com'],
    ['https://api.provider.com/v1/', 'https://api.provider.com/v1'],
    ['https://api.provider.com/openai/v1', 'https://api.provider.com/openai/v1'],
    ['https://api.provider.com/custom-root/v2.0/~tenant_1', 'https://api.provider.com/custom-root/v2.0/~tenant_1'],
    ['https://xn--bcher-kva.provider.com/v1', 'https://xn--bcher-kva.provider.com/v1'],
  ])('normalizes %s to an API root', (url, normalized) => {
    expect(normalizeCustomAiBaseUrl(url)).toBe(normalized);
    expect(normalizeCustomAiBaseUrl(normalized)).toBe(normalized);
  });

  it.each([
    undefined, null, 42, {}, '', ' https://api.provider.com', 'https://api.provider.com ',
    'http://api.provider.com', 'ftp://api.provider.com', '//api.provider.com',
    'https:api.provider.com', 'https:///api.provider.com',
    'https://api.provider.com:80', 'https://api.provider.com:444', 'https://api.provider.com:0443',
    'https://user:password@api.provider.com', 'https://@api.provider.com',
    'https://api.provider.com?key=secret', 'https://api.provider.com?',
    'https://api.provider.com#secret', 'https://api.provider.com#',
    'https://api.provider.com\\@127.0.0.1', 'https://api.provider.com/v1\\responses',
    'https://api.provider.com/line\nfeed', 'https://api.provider.com/line\rfeed',
    'https://api.provider.com/ta\tb', 'https://api.provider.com/\u0000', 'https://api.provider.com/\u007f',
    'https://api.provider.com/\u0080', 'https://例子.com',
    'https://localhost', 'https://localhost.provider.com', 'https://api.localhost',
    'https://api.local', 'https://api.internal', 'https://api.localdomain',
    'https://api.home', 'https://api.lan', 'https://api.corp', 'https://api.intranet',
    'https://api.home.arpa', 'https://api.test', 'https://api.invalid', 'https://api.onion',
    'https://api.alt', 'https://singlelabel', 'https://api.provider.com.',
    'https://bad_label.provider.com', 'https://-api.provider.com', 'https://api-.provider.com',
    'https://api..provider.com', `https://${'a'.repeat(64)}.provider.com`,
    'https://127.0.0.1', 'https://8.8.8.8', 'https://2130706433',
    'https://0177.0.0.1', 'https://0x7f000001', 'https://127.1', 'https://1.2.3.0x1',
    'https://[::1]', 'https://[2606:4700:4700::1111]', 'https://[::ffff:127.0.0.1]',
    'https://%31%32%37.0.0.1', 'https://api%2eprovider.com',
    'https://api.provider.com/./v1', 'https://api.provider.com/a/../v1',
    'https://api.provider.com//v1', 'https://api.provider.com/v1//',
    'https://api.provider.com/%2e%2e/v1', 'https://api.provider.com/%2fprivate',
    'https://api.provider.com/%5cprivate', 'https://api.provider.com/%252fprivate',
    'https://api.provider.com/%00', 'https://api.provider.com/%zz',
    'https://api.provider.com/v1;secret',
    'https://api.provider.com/chat/completions', 'https://api.provider.com/chat/completions/',
    'https://api.provider.com/v1/chat/completions', 'https://api.provider.com/v1/CHAT/COMPLETIONS/',
    'https://api.provider.com/completions', 'https://api.provider.com/v1/completions/',
    'https://api.provider.com/responses', 'https://api.provider.com/openai/v1/responses',
    `https://api.provider.com/${'a'.repeat(2048)}`,
  ])('rejects URL bypass or invalid input %j', value => {
    expect(() => normalizeCustomAiBaseUrl(value)).toThrowError(CustomAiError);
    try { normalizeCustomAiBaseUrl(value); } catch (error) {
      expect(error).toMatchObject({ code: 'INVALID_BASE_URL', message: 'INVALID_BASE_URL' });
    }
  });

  it('accepts exactly the URL length limit and rejects an overlong DNS name', () => {
    const prefix = 'https://api.provider.com/';
    const exact = prefix + 'a'.repeat(2048 - prefix.length);
    expect(normalizeCustomAiBaseUrl(exact)).toBe(exact);
    expect(() => normalizeCustomAiBaseUrl(`${exact}a`)).toThrowError(CustomAiError);
    expect(() => normalizeCustomAiBaseUrl(`https://${Array(4).fill('a'.repeat(63)).join('.')}`)).toThrowError(CustomAiError);
  });
});

describe('isPublicAddress conservative ranges', () => {
  it.each([
    '0.0.0.0', '0.255.255.255', '10.0.0.0', '10.255.255.255',
    '100.64.0.0', '100.127.255.255', '127.0.0.0', '127.255.255.255',
    '169.254.0.0', '169.254.255.255', '172.16.0.0', '172.31.255.255',
    '192.0.0.0', '192.0.0.255', '192.0.2.0', '192.0.2.255',
    '192.88.99.0', '192.88.99.255', '192.168.0.0', '192.168.255.255',
    '198.18.0.0', '198.19.255.255', '198.51.100.0', '198.51.100.255',
    '203.0.113.0', '203.0.113.255', '224.0.0.0', '239.255.255.255',
    '240.0.0.0', '255.255.255.255', '169.254.169.254', '100.100.100.200', '168.63.129.16',
    '1fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', '4000::',
    '2001::', '2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff',
    '2001:db8::', '2001:db8:ffff:ffff:ffff:ffff:ffff:ffff',
    '2002::', '2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    '3fff::', '3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff',
    '::', '::1', '::ffff:8.8.8.8', '::ffff:0808:0808',
    '::8.8.8.8', '64:ff9b::808:808', '64:ff9b:1::808:808',
    'fc00::', 'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    'fe80::1', 'fe80::1%eth0', 'ff02::1',
    '', 'not-an-ip', '93.184.216.34:443', '127.1', '2130706433',
    '010.000.000.001', '256.1.1.1', '[2606:4700::1111]',
    '2001:4860::1%1', '2001:::1', '2001:4860:4860:4860:4860:4860:4860:4860:4860',
    undefined, null, 123, {}, [],
  ])('denies reserved, metadata, mapped or malformed address %j', address => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    '1.0.0.0', '9.255.255.255', '11.0.0.0', '100.63.255.255', '100.128.0.0',
    '126.255.255.255', '128.0.0.0', '169.253.255.255', '169.255.0.0',
    '172.15.255.255', '172.32.0.0', '192.0.1.0', '192.0.3.0',
    '192.88.98.255', '192.88.100.0', '192.167.255.255', '192.169.0.0',
    '198.17.255.255', '198.20.0.0', '198.51.99.255', '198.51.101.0',
    '203.0.112.255', '203.0.114.0', '223.255.255.255', '8.8.8.8',
    '2000::', '2000:ffff:ffff:ffff:ffff:ffff:ffff:ffff', '2001:200::',
    '2001:db7:ffff:ffff:ffff:ffff:ffff:ffff', '2001:db9::',
    '2001:ffff:ffff:ffff:ffff:ffff:ffff:ffff', '2003::',
    '3ffe:ffff:ffff:ffff:ffff:ffff:ffff:ffff', '3fff:1000::',
    '3fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', '2606:4700:4700::1111',
    '2001:4860:4860:0000:0000:0000:0000:8888',
  ])('accepts public boundaries outside every denied CIDR %s', address => {
    expect(isPublicAddress(address)).toBe(true);
  });
});

describe('request inputs and fixed HTTPS target', () => {
  it.each(['', ' ', 'has space', 'line\nkey', 'line\rkey', 'tab\tkey', '\u0000', '\u007f', '非ASCII', 'x'.repeat(4097), undefined, null, 123])('rejects a non-visible-ASCII or oversized key before DNS', async apiKey => {
    await expectCode(start({ apiKey }), 'INVALID_API_KEY');
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each(['!', '~', 'x'.repeat(4096)])('accepts visible ASCII key boundary %#', async apiKey => {
    const promise = start({ apiKey });
    endJson({ ok: true });
    await expect(promise).resolves.toEqual({ ok: true });
    expect(exchanges[0].options.headers.Authorization).toBe(`Bearer ${apiKey}`);
  });

  it.each([null, undefined, [], 'body', 123, true, { n: 1n }, { text: 'x'.repeat(MAX_BYTES) }, { text: '界'.repeat(MAX_BYTES / 3) }].map(body => [body]))('rejects non-object, unserializable or over-limit body %# before DNS', async body => {
    await expectCode(start({ body }), 'INVALID_REQUEST_BODY');
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('rejects circular bodies with fixed errors', async () => {
    const body = {};
    body.circular = body;
    await expectCode(start({ body }), 'INVALID_REQUEST_BODY');
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it('accepts exactly 128 KiB JSON bytes and rejects one additional byte', async () => {
    const body = { x: 'x'.repeat(MAX_BYTES - Buffer.byteLength(JSON.stringify({ x: '' }))) };
    const promise = start({ body });
    expect(exchanges[0].req.end.mock.calls[0][0]).toHaveLength(MAX_BYTES);
    expect(exchanges[0].options.headers['Content-Length']).toBe(MAX_BYTES);
    endJson({ ok: true });
    await expect(promise).resolves.toEqual({ ok: true });
    await expectCode(start({ body: { x: `${body.x}x` } }), 'INVALID_REQUEST_BODY');
    expect(mocks.request).toHaveBeenCalledOnce();
  });

  it.each([
    ['https://api.provider.com', '/chat/completions'],
    ['https://api.provider.com/', '/chat/completions'],
    ['https://api.provider.com/v1/', '/v1/chat/completions'],
    ['https://api.provider.com/openai/v1', '/openai/v1/chat/completions'],
    ['https://api.provider.com/custom', '/custom/chat/completions'],
  ])('appends the method once without inventing v1 for %s', async (baseUrl, path) => {
    const promise = start({ baseUrl });
    const { options, req } = exchanges[0];
    expect(options).toMatchObject({
      protocol: 'https:', hostname: 'api.provider.com', port: 443, method: 'POST', path,
      servername: 'api.provider.com', rejectUnauthorized: true, autoSelectFamily: false,
      family: 4, agent: false,
      headers: { Host: 'api.provider.com', Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Encoding': 'identity' },
    });
    expect(options.checkServerIdentity).toBeUndefined();
    expect(options.createConnection).toBeUndefined();
    expect(options.socketPath).toBeUndefined();
    expect(options.path).not.toContain(input.apiKey);
    expect(options.hostname).not.toContain(input.apiKey);
    expect(req.end.mock.calls[0][0].toString()).toBe(JSON.stringify(input.body));
    endJson({ choices: [] });
    await expect(promise).resolves.toEqual({ choices: [] });
    expect(mocks.lookup).toHaveBeenCalledOnce();
    expect(mocks.lookup).toHaveBeenCalledWith('api.provider.com', { all: true, family: 0, order: 'verbatim' }, expect.any(Function));
    expect(mocks.request).toHaveBeenCalledOnce();
  });
});

describe('DNS validation and rebinding resistance', () => {
  it.each([
    [], null, undefined, {},
    [{ address: '127.0.0.1', family: 4 }],
    [{ address: '168.63.129.16', family: 4 }],
    [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }],
    [{ address: '93.184.216.34', family: 4 }, { address: '::ffff:8.8.8.8', family: 6 }],
    [{ address: '93.184.216.34', family: 4 }, { address: '2001:db8::1', family: 6 }],
    [{ address: '93.184.216.34', family: 6 }],
    [{ address: '2606:4700::1111', family: 4 }],
    [{ address: '93.184.216.34', family: 'IPv4' }],
    [{ address: '93.184.216.34', family: 0 }],
    [{ address: 'not-an-ip', family: 4 }],
    [{ address: null, family: 4 }],
    [{ address: {}, family: 4 }],
    [null],
  ].map(records => [records]))('rejects the entire DNS answer when any record is unsafe or malformed %#', async records => {
    mocks.lookup.mockImplementation((_host, _options, callback) => callback(null, records));
    await expectCode(start(), 'UNSAFE_UPSTREAM_ADDRESS');
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each([
    [{ address: '93.184.216.34', family: 4 }, { address: '2606:4700::1111', family: 6 }],
    [{ address: '2606:4700::1111', family: 6 }, { address: '93.184.216.34', family: 4 }],
  ])('pins the first validated address, keeping hostname, Host and TLS name intact %#', async (...records) => {
    mocks.lookup.mockImplementation((_host, _options, callback) => callback(null, records));
    const promise = start();
    const { options } = exchanges[0];
    const pinned = { ...records[0] };
    // Simulate the attacker changing subsequent DNS answers and the old array.
    mocks.lookup.mockImplementation((_host, _options, callback) => callback(null, [{ address: '127.0.0.1', family: 4 }]));
    records[0].address = '169.254.169.254';
    const single = await new Promise((resolve, reject) => options.lookup('api.provider.com', { family: options.family }, (error, address, family) => error ? reject(error) : resolve({ address, family })));
    expect(single).toEqual(pinned);
    const all = await new Promise((resolve, reject) => options.lookup('api.provider.com', { all: true }, (error, addresses) => error ? reject(error) : resolve(addresses)));
    expect(all).toEqual([pinned]);
    const noOptions = await new Promise((resolve, reject) => options.lookup('api.provider.com', (error, address, family) => error ? reject(error) : resolve({ address, family })));
    expect(noOptions).toEqual(pinned);
    await expect(new Promise((resolve, reject) => options.lookup('other.provider.com', {}, (error, address) => error ? reject(error) : resolve(address)))).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
    expect(options).toMatchObject({ hostname: 'api.provider.com', servername: 'api.provider.com', family: pinned.family, autoSelectFamily: false, agent: false, rejectUnauthorized: true, headers: { Host: 'api.provider.com' } });
    expect(mocks.lookup).toHaveBeenCalledOnce();
    endJson({ ok: true });
    await expect(promise).resolves.toEqual({ ok: true });
  });

  it.each(['callback', 'throw'])('sanitizes DNS errors and performs no request (%s)', async mode => {
    mocks.lookup.mockImplementation((_host, _options, callback) => {
      if (mode === 'throw') throw new Error(input.apiKey);
      callback(new Error(`${input.apiKey} ${input.body.messages[0].content}`));
    });
    await expectCode(start(), 'UPSTREAM_DNS');
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.lookup).toHaveBeenCalledOnce();
  });
});

describe('response validation and status redaction', () => {
  it.each([
    [401, 'UPSTREAM_AUTH'], [403, 'UPSTREAM_AUTH'], [429, 'UPSTREAM_RATE_LIMIT'],
    [300, 'UPSTREAM_REDIRECT'], [301, 'UPSTREAM_REDIRECT'], [302, 'UPSTREAM_REDIRECT'],
    [307, 'UPSTREAM_REDIRECT'], [308, 'UPSTREAM_REDIRECT'], [399, 'UPSTREAM_REDIRECT'],
    [201, 'UPSTREAM_UNAVAILABLE'], [204, 'UPSTREAM_UNAVAILABLE'],
    [400, 'UPSTREAM_UNAVAILABLE'], [404, 'UPSTREAM_UNAVAILABLE'],
    [500, 'UPSTREAM_UNAVAILABLE'], [503, 'UPSTREAM_UNAVAILABLE'],
  ])('maps %i to fixed %s without reading error body or retrying', async (status, code) => {
    const promise = start();
    const res = respond({ status, headers: { location: 'https://127.0.0.1/secret', 'content-type': 'text/plain' } });
    expect(res.listenerCount('data')).toBe(0);
    expect(res.listenerCount('end')).toBe(0);
    res.emit('data', Buffer.from(`${input.apiKey} ${input.body.messages[0].content}`));
    res.emit('error', new Error(input.apiKey));
    res.emit('close');
    await expectCode(promise, code);
    expect(res.destroy).toHaveBeenCalledOnce();
    expect(exchanges[0].req.destroy).toHaveBeenCalledOnce();
    expect(mocks.request).toHaveBeenCalledOnce();
    expect(mocks.lookup).toHaveBeenCalledOnce();
  });

  it.each([
    {}, { 'content-type': 'text/html' }, { 'content-type': 'text/json' },
    { 'content-type': ['application/json'] },
    { 'content-type': 'application/json; charset=iso-8859-1' },
    { 'content-type': 'application/json', 'content-encoding': 'gzip' },
    { 'content-type': 'application/json', 'content-encoding': 'br' },
    { 'content-type': 'application/json', 'content-encoding': 'identity, gzip' },
    { 'content-type': 'application/json', 'content-encoding': ['identity'] },
    { 'content-type': 'application/json', 'content-length': String(MAX_BYTES + 1) },
    { 'content-type': 'application/json', 'content-length': '999999999999999999999999' },
    { 'content-type': 'application/json', 'content-length': '-1' },
    { 'content-type': 'application/json', 'content-length': '1.5' },
    { 'content-type': 'application/json', 'content-length': '2junk' },
    { 'content-type': 'application/json', 'content-length': ['2'] },
  ])('rejects unsupported response headers before reading body %#', async headers => {
    const promise = start();
    const res = respond({ headers });
    await expectCode(promise, 'INVALID_UPSTREAM_RESPONSE');
    expect(res.listenerCount('data')).toBe(0);
    expect(res.destroy).toHaveBeenCalledOnce();
  });

  it.each(['application/json', 'application/json; charset=utf-8', 'application/json; charset="UTF-8"', 'application/problem+json'])('parses bounded JSON content type %s and identity encoding', async contentType => {
    const value = { choices: [{ message: { content: '正确 UTF-8' } }] };
    const payload = Buffer.from(JSON.stringify(value));
    const promise = start();
    const res = respond({ headers: { 'content-type': contentType, 'content-encoding': 'identity', 'content-length': String(payload.length) } });
    for (const byte of payload) res.emit('data', Buffer.from([byte]));
    res.emit('end');
    res.emit('close');
    await expect(promise).resolves.toEqual(value);
  });

  it('allows exactly 128 KiB of response and refuses a larger streamed body', async () => {
    const value = { x: 'x'.repeat(MAX_BYTES - Buffer.byteLength(JSON.stringify({ x: '' }))) };
    const payload = Buffer.from(JSON.stringify(value));
    expect(payload).toHaveLength(MAX_BYTES);
    const exact = start();
    const valid = respond({ headers: { 'content-type': 'application/json', 'content-length': String(MAX_BYTES) } });
    valid.emit('data', payload.subarray(0, 500));
    valid.emit('data', payload.subarray(500));
    valid.emit('end');
    await expect(exact).resolves.toEqual(value);
    const oversized = start();
    const res = respond();
    res.emit('data', Buffer.alloc(MAX_BYTES));
    res.emit('data', Buffer.from('x'));
    res.emit('end');
    await expectCode(oversized, 'INVALID_UPSTREAM_RESPONSE');
    expect(res.destroy).toHaveBeenCalledOnce();
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });

  it.each([Buffer.from('not-json'), Buffer.from(''), Buffer.from([0x22, 0xc3, 0x28, 0x22]), Buffer.from([0x22, 0xff, 0x22]), Buffer.from('null trailing'), Buffer.from('{"unfinished":')])('rejects invalid JSON or invalid UTF-8 bytes %#', async bytes => {
    const promise = start();
    const res = respond();
    res.emit('data', bytes);
    res.emit('end');
    await expectCode(promise, 'INVALID_UPSTREAM_RESPONSE');
    expect(res.destroy).toHaveBeenCalledOnce();
  });

  it('rejects a response switched to decoded strings', async () => {
    const promise = start();
    const res = respond();
    res.emit('data', '{"ok":true}');
    await expectCode(promise, 'INVALID_UPSTREAM_RESPONSE');
  });

  it.each([['1', true], ['20', true], [undefined, false]])('rejects mismatched lengths or incomplete HTTP message (%s, %s)', async (length, complete) => {
    const headers = { 'content-type': 'application/json' };
    if (length !== undefined) headers['content-length'] = length;
    const promise = start();
    const res = respond({ headers, complete });
    res.emit('data', Buffer.from('{}'));
    res.emit('end');
    await expectCode(promise, 'INVALID_UPSTREAM_RESPONSE');
  });

  it.each(['aborted', 'error', 'close'])('rejects response %s before end, including asynchronously', async event => {
    const promise = start();
    const res = respond({ complete: false });
    res.emit('data', Buffer.from('{"partial":'));
    queueMicrotask(() => res.emit(event, new Error(input.apiKey)));
    await expectCode(promise, 'INVALID_UPSTREAM_RESPONSE');
    expect(exchanges[0].req.destroy).toHaveBeenCalledOnce();
    // Later error/close events must not leak or become unhandled.
    res.emit('error', new Error(input.apiKey));
    res.emit('close');
  });

  it('does not reject normal asynchronous close after response end', async () => {
    const promise = start();
    const res = endJson({ ok: true });
    await expect(promise).resolves.toEqual({ ok: true });
    await new Promise(resolve => queueMicrotask(() => { res.emit('close'); exchanges[0].req.emit('close'); resolve(); }));
    expect(res.destroy).not.toHaveBeenCalled();
    expect(exchanges[0].req.destroy).not.toHaveBeenCalled();
  });

  it.each(['throw', 'error', 'close'])('sanitizes request failure %s without retrying', async mode => {
    if (mode === 'throw') mocks.request.mockImplementation(() => { throw new Error(input.apiKey); });
    const promise = start();
    if (mode !== 'throw') exchanges[0].req.emit(mode, new Error(`${input.apiKey} ${input.body.messages[0].content}`));
    await expectCode(promise, 'UPSTREAM_UNAVAILABLE');
    expect(mocks.request).toHaveBeenCalledOnce();
    expect(mocks.lookup).toHaveBeenCalledOnce();
  });

  it('never logs key, resume or upstream errors', async () => {
    const spies = ['log', 'warn', 'error', 'info', 'debug'].map(method => vi.spyOn(console, method).mockImplementation(() => {}));
    const promise = start();
    exchanges[0].req.emit('error', new Error(`${input.apiKey} ${input.body.messages[0].content}`));
    const error = await promise.catch(value => value);
    expect(error).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE', message: 'UPSTREAM_UNAVAILABLE' });
    expect(error.cause).toBeUndefined();
    expect(error.stack).not.toContain(input.apiKey);
    expect(error.stack).not.toContain(input.body.messages[0].content);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe('one total 45-second deadline and cancellation', () => {
  it('starts the deadline before DNS and never starts a request after DNS timeout', async () => {
    vi.useFakeTimers();
    let dnsCallback;
    mocks.lookup.mockImplementation((_host, _options, callback) => { dnsCallback = callback; });
    const promise = start();
    const assertion = expectCode(promise, 'UPSTREAM_TIMEOUT');
    await vi.advanceTimersByTimeAsync(45_000);
    await assertion;
    dnsCallback(null, [{ address: '93.184.216.34', family: 4 }]);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('checks elapsed deadline even if a blocked event loop delays the timer callback', async () => {
    vi.useFakeTimers();
    let dnsCallback;
    mocks.lookup.mockImplementation((_host, _options, callback) => { dnsCallback = callback; });
    const promise = start();
    vi.setSystemTime(Date.now() + 45_001);
    dnsCallback(null, [{ address: '93.184.216.34', family: 4 }]);
    await expectCode(promise, 'UPSTREAM_TIMEOUT');
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('does not reset the deadline after slow DNS or response headers', async () => {
    vi.useFakeTimers();
    let dnsCallback;
    mocks.lookup.mockImplementation((_host, _options, callback) => { dnsCallback = callback; });
    const promise = start();
    const assertion = expectCode(promise, 'UPSTREAM_TIMEOUT');
    await vi.advanceTimersByTimeAsync(40_000);
    dnsCallback(null, [{ address: '93.184.216.34', family: 4 }]);
    const res = respond({ complete: false });
    res.emit('data', Buffer.from('{'));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(res.destroy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(res.destroy).toHaveBeenCalledOnce();
    expect(exchanges[0].req.destroy).toHaveBeenCalledOnce();
    expect(mocks.request).toHaveBeenCalledOnce();
  });

  it('covers connection and headers wait with the same deadline', async () => {
    vi.useFakeTimers();
    const promise = start();
    const assertion = expectCode(promise, 'UPSTREAM_TIMEOUT');
    await vi.advanceTimersByTimeAsync(45_000);
    await assertion;
    expect(exchanges[0].req.destroy).toHaveBeenCalledOnce();
    const lateResponse = respond();
    expect(lateResponse.destroy).toHaveBeenCalledOnce();
    lateResponse.emit('error', new Error(input.apiKey));
    expect(mocks.request).toHaveBeenCalledOnce();
  });

  it('removes timers and abort listeners after a completed response', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const promise = start({ signal: controller.signal });
    endJson({ ok: true });
    await expect(promise).resolves.toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    controller.abort();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(exchanges[0].req.destroy).not.toHaveBeenCalled();
  });

  it('rejects an already aborted signal before DNS', async () => {
    const controller = new AbortController();
    controller.abort(new Error(input.apiKey));
    await expectCode(start({ signal: controller.signal }), 'UPSTREAM_ABORTED');
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('aborts DNS wait and ignores a late lookup result', async () => {
    let dnsCallback;
    mocks.lookup.mockImplementation((_host, _options, callback) => { dnsCallback = callback; });
    const controller = new AbortController();
    const promise = start({ signal: controller.signal });
    controller.abort(new Error(input.apiKey));
    await expectCode(promise, 'UPSTREAM_ABORTED');
    dnsCallback(null, [{ address: '93.184.216.34', family: 4 }]);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each([false, true])('abort destroys local request and any response (response=%s)', async withResponse => {
    const controller = new AbortController();
    const promise = start({ signal: controller.signal });
    const res = withResponse ? respond({ complete: false }) : null;
    if (res) res.emit('data', Buffer.from('{'));
    controller.abort(new Error(`${input.apiKey} ${input.body.messages[0].content}`));
    await expectCode(promise, 'UPSTREAM_ABORTED');
    expect(exchanges[0].req.destroy).toHaveBeenCalledOnce();
    if (res) {
      expect(res.destroy).toHaveBeenCalledOnce();
      res.emit('error', new Error(input.apiKey));
      res.emit('close');
    }
    exchanges[0].req.emit('error', new Error(input.apiKey));
    expect(mocks.request).toHaveBeenCalledOnce();
  });

  it('ignores a duplicate DNS callback rather than opening a second connection', async () => {
    mocks.lookup.mockImplementation((_host, _options, callback) => {
      callback(null, [{ address: '93.184.216.34', family: 4 }]);
      callback(null, [{ address: '8.8.8.8', family: 4 }]);
    });
    const promise = start();
    endJson({ ok: true });
    await expect(promise).resolves.toEqual({ ok: true });
    expect(mocks.request).toHaveBeenCalledOnce();
  });
});
