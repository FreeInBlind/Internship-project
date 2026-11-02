import { request } from 'node:https';
import { lookup } from 'node:dns';
import { isIP } from 'node:net';
import { URL } from 'node:url';

// Server-only transport: Node's direct HTTPS API does not consult proxy variables.
const MAX_BYTES = 128 * 1024;
const TIMEOUT_MS = 45_000;
const ERROR_CODES = new Set([
  'INVALID_BASE_URL', 'INVALID_API_KEY', 'INVALID_REQUEST_BODY',
  'UNSAFE_UPSTREAM_ADDRESS', 'UPSTREAM_DNS', 'UPSTREAM_TIMEOUT',
  'UPSTREAM_ABORTED', 'UPSTREAM_AUTH', 'UPSTREAM_RATE_LIMIT',
  'UPSTREAM_REDIRECT', 'UPSTREAM_UNAVAILABLE', 'INVALID_UPSTREAM_RESPONSE',
]);

export class CustomAiError extends Error {
  constructor(code) {
    const safeCode = ERROR_CODES.has(code) ? code : 'UPSTREAM_UNAVAILABLE';
    super(safeCode);
    this.name = 'CustomAiError';
    this.code = safeCode;
  }
}

export function normalizeCustomAiBaseUrl(value) {
  const invalid = () => { throw new CustomAiError('INVALID_BASE_URL'); };
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048
      || /[^\x21-\x7e]|[\\?#]/.test(value)) invalid();
  // Inspect raw input before WHATWG parsing can erase dot segments or rewrite IPs.
  const match = /^https:\/\/([^/]+)(\/.*)?$/i.exec(value);
  if (!match || match[1].includes('@')) invalid();
  const authority = match[1];
  const hostMatch = /^([^:]+)(?::443)?$/.exec(authority);
  if (!hostMatch) invalid();
  const hostname = hostMatch[1].toLowerCase();
  const labels = hostname.split('.');
  if (hostname.length > 253 || labels.length < 2 || isIP(hostname)
      || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
      || !/[a-z]/.test(labels.at(-1))) invalid();
  const reserved = new Set(['localhost', 'local', 'internal', 'localdomain', 'home',
    'lan', 'corp', 'intranet', 'test', 'invalid', 'example', 'onion', 'arpa', 'alt']);
  if (reserved.has(labels.at(-1)) || labels.includes('localhost')) invalid();
  const path = match[2] || '';
  // API roots need only ordinary path segments. Reject all escapes, rather than
  // letting a proxy/provider decode encoded separators, dots or double escapes.
  if (path.includes('%') || path.includes('//')
      || path.split('/').some(segment => segment === '.' || segment === '..'
        || (segment !== '' && !/^[a-zA-Z0-9._~-]+$/.test(segment)))) invalid();
  const rootPath = path.replace(/\/$/, '');
  if (/\/(?:chat\/completions|completions|responses)$/i.test(rootPath)) invalid();
  let parsed;
  try { parsed = new URL(value); } catch { invalid(); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password
      || parsed.port || parsed.hostname !== hostname || isIP(parsed.hostname)
      || parsed.search || parsed.hash) invalid();
  return `https://${hostname}${rootPath}`;
}

const IPV4_DENY = [
  [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8],
  [0xa9fe0000, 16], [0xac100000, 12], [0xc0000000, 24], [0xc0000200, 24],
  [0xc0586300, 24], [0xc0a80000, 16], [0xc6120000, 15], [0xc6336400, 24],
  [0xcb007100, 24], [0xa83f8110, 32], // Azure platform virtual IP (168.63.129.16)
  [0xe0000000, 4], [0xf0000000, 4],
];

export function isPublicAddress(address) {
  if (typeof address !== 'string' || address.includes('%')) return false;
  const family = isIP(address);
  if (family === 4) {
    const number = address.split('.').reduce((result, byte) => result * 256 + Number(byte), 0);
    return !IPV4_DENY.some(([base, prefix]) => {
      const block = 2 ** (32 - prefix);
      return Math.floor(number / block) === Math.floor(base / block);
    });
  }
  if (family !== 6 || address.includes('.')) return false;
  try {
    const halves = address.split('::');
    if (halves.length > 2) return false;
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    if (left.some(group => !/^[0-9a-f]{1,4}$/i.test(group))
        || right.some(group => !/^[0-9a-f]{1,4}$/i.test(group))) return false;
    if (halves.length === 1 && left.length !== 8) return false;
    if (halves.length === 2 && left.length + right.length >= 8) return false;
    const groups = halves.length === 2
      ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
    const number = groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group}`), 0n);
    const inRange = (base, prefix) => number >> BigInt(128 - prefix) === base >> BigInt(128 - prefix);
    // Conservative IANA special-purpose policy (registry 2025-10-09): only
    // 2000::/3, excluding 2001::/23, documentation, 6to4 and 3fff::/20.
    // Thus mapped/translated IPv4, NAT64, ULA, link-local, multicast and future
    // allocations are denied even if a narrower exception could be reachable.
    return inRange(0x20000000000000000000000000000000n, 3)
      && !inRange(0x20010000000000000000000000000000n, 23)
      && !inRange(0x20010db8000000000000000000000000n, 32)
      && !inRange(0x20020000000000000000000000000000n, 16)
      && !inRange(0x3fff0000000000000000000000000000n, 20);
  } catch { return false; }
}

function assertPublicDnsRecords(records) {
  if (!Array.isArray(records) || records.length === 0
      || records.some(record => !record || ![4, 6].includes(record.family)
        || typeof record.address !== 'string' || isIP(record.address) !== record.family
        || !isPublicAddress(record.address))) {
    throw new CustomAiError('UNSAFE_UPSTREAM_ADDRESS');
  }
}

// Configuration saves validate DNS only. No HTTP request or reusable address pin
// is created: every actual provider call below performs fresh resolution/pinning.
export async function validateCustomAiEndpoint(baseUrl) {
  const normalized = normalizeCustomAiBaseUrl(baseUrl);
  const root = new URL(normalized);
  await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish('UPSTREAM_DNS'), 10_000);
    function finish(code) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code) reject(new CustomAiError(code));
      else resolve();
    }
    try {
      lookup(root.hostname, { all: true, family: 0, order: 'verbatim' }, (error, records) => {
        if (settled) return;
        if (error) { finish('UPSTREAM_DNS'); return; }
        try { assertPublicDnsRecords(records); }
        catch { finish('UNSAFE_UPSTREAM_ADDRESS'); return; }
        finish();
      });
    } catch { finish('UPSTREAM_DNS'); }
  });
  return normalized;
}

function responseLength(headers) {
  const contentType = headers['content-type'];
  const encoding = headers['content-encoding'];
  if (typeof contentType !== 'string'
      || !/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(contentType)
      || (encoding !== undefined && (typeof encoding !== 'string' || encoding.trim().toLowerCase() !== 'identity'))) {
    throw new CustomAiError('INVALID_UPSTREAM_RESPONSE');
  }
  const length = headers['content-length'];
  if (length === undefined) return null;
  if (typeof length !== 'string' || !/^\d+$/.test(length)) throw new CustomAiError('INVALID_UPSTREAM_RESPONSE');
  const number = Number(length);
  if (!Number.isSafeInteger(number) || number > MAX_BYTES) throw new CustomAiError('INVALID_UPSTREAM_RESPONSE');
  return number;
}

export async function postCustomAiChat({ baseUrl, apiKey, body, signal } = {}) {
  const root = new URL(normalizeCustomAiBaseUrl(baseUrl));
  if (typeof apiKey !== 'string' || apiKey.length < 1 || apiKey.length > 4096
      || /[^\x21-\x7e]/.test(apiKey)) throw new CustomAiError('INVALID_API_KEY');
  let payload;
  try {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    const json = JSON.stringify(body);
    // Avoid allocating an unbounded UTF-8 buffer for an already oversized string.
    if (typeof json !== 'string' || json.length > MAX_BYTES) throw new Error();
    payload = Buffer.from(json, 'utf8');
    if (payload.length > MAX_BYTES) throw new Error();
  } catch { throw new CustomAiError('INVALID_REQUEST_BODY'); }
  if (signal !== undefined && (typeof signal?.aborted !== 'boolean'
      || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) {
    throw new CustomAiError('INVALID_REQUEST_BODY');
  }
  if (signal?.aborted) throw new CustomAiError('UPSTREAM_ABORTED');

  return new Promise((resolve, reject) => {
    let settled = false;
    let req;
    let res;
    let responseEnded = false;
    let dnsFinished = false;
    const deadline = Date.now() + TIMEOUT_MS;
    const abort = () => finish('UPSTREAM_ABORTED');
    const timer = setTimeout(() => finish('UPSTREAM_TIMEOUT'), TIMEOUT_MS);
    function finish(code, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (code) {
        // No upstream body, exception, URL or key becomes an error/cause.
        reject(new CustomAiError(code));
        // Destroying local I/O does not promise that a provider stopped work.
        res?.destroy();
        req?.destroy();
      } else resolve(value);
    }
    function expired() {
      if (!settled && Date.now() >= deadline) finish('UPSTREAM_TIMEOUT');
      return settled;
    }
    function receive(incoming) {
      res = incoming;
      res.on('error', () => finish('INVALID_UPSTREAM_RESPONSE'));
      res.once('aborted', () => finish('INVALID_UPSTREAM_RESPONSE'));
      res.once('close', () => { if (!responseEnded) finish('INVALID_UPSTREAM_RESPONSE'); });
      if (expired()) { res.destroy(); return; }
      const status = res.statusCode;
      if (status !== 200) {
        const code = status === 401 || status === 403 ? 'UPSTREAM_AUTH'
          : status === 429 ? 'UPSTREAM_RATE_LIMIT'
            : status >= 300 && status < 400 ? 'UPSTREAM_REDIRECT' : 'UPSTREAM_UNAVAILABLE';
        finish(code);
        return;
      }
      let expectedLength;
      try { expectedLength = responseLength(res.headers); }
      catch { finish('INVALID_UPSTREAM_RESPONSE'); return; }
      const chunks = [];
      let bytes = 0;
      res.on('data', chunk => {
        if (expired()) return;
        if (!Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) {
          finish('INVALID_UPSTREAM_RESPONSE'); return;
        }
        bytes += chunk.length;
        if (bytes > MAX_BYTES) { finish('INVALID_UPSTREAM_RESPONSE'); return; }
        chunks.push(Buffer.from(chunk));
      });
      res.once('end', () => {
        responseEnded = true;
        if (expired()) return;
        if (res.complete !== true || (expectedLength !== null && bytes !== expectedLength)) {
          finish('INVALID_UPSTREAM_RESPONSE'); return;
        }
        try {
          const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes));
          finish(null, JSON.parse(text));
        } catch { finish('INVALID_UPSTREAM_RESPONSE'); }
      });
    }
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try {
      lookup(root.hostname, { all: true, family: 0, order: 'verbatim' }, (error, records) => {
        if (dnsFinished || expired()) return;
        dnsFinished = true;
        if (error) { finish('UPSTREAM_DNS'); return; }
        try { assertPublicDnsRecords(records); }
        catch { finish('UNSAFE_UPSTREAM_ADDRESS'); return; }
        const { address, family } = records[0];
        // The connector never resolves the name again or switches to another IP.
        const pinnedLookup = (hostname, options, callback) => {
          if (typeof options === 'function') { callback = options; options = {}; }
          queueMicrotask(() => {
            if (hostname !== root.hostname) { callback(new CustomAiError('UPSTREAM_UNAVAILABLE')); return; }
            if (options?.all) callback(null, [{ address, family }]);
            else callback(null, address, family);
          });
        };
        if (expired()) return;
        try {
          req = request({
            protocol: 'https:', hostname: root.hostname, port: 443,
            method: 'POST', path: `${root.pathname === '/' ? '' : root.pathname}/chat/completions`,
            headers: {
              Host: root.hostname, Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json', Accept: 'application/json',
              'Accept-Encoding': 'identity', 'Content-Length': payload.length,
            },
            servername: root.hostname, rejectUnauthorized: true,
            family, autoSelectFamily: false, agent: false, lookup: pinnedLookup,
          }, receive);
          req.on('error', () => finish('UPSTREAM_UNAVAILABLE'));
          req.once('close', () => {
            if (!responseEnded && (!res || res.complete !== true)) finish('UPSTREAM_UNAVAILABLE');
          });
          if (expired()) { req.destroy(); return; }
          req.end(payload);
        } catch { finish('UPSTREAM_UNAVAILABLE'); }
      });
    } catch { finish('UPSTREAM_DNS'); }
  });
}
