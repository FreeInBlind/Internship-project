// @vitest-environment node
import { createCipheriv, createDecipheriv } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decryptAiKey, encryptAiKey } from '../lib/aiConfigCrypto';

// Fictional fixtures only. Every crypto call injects env; no credentials are read.
const masterKey = Buffer.alloc(32, 7);
const env = { CUSTOM_AI_ENCRYPTION_KEY: masterKey.toString('base64') };
const input = { apiKey: 'fictional-api-key-仅用于测试', userId: 'fixture-user-a', endpoint: 'https://api.example.com/v1' };
const ENCRYPT_ERROR = 'AI_CONFIG_ENCRYPTION_FAILED';
const DECRYPT_ERROR = 'AI_CONFIG_DECRYPTION_FAILED';

function decrypt(encrypted, overrides = {}, testEnv = env) {
  return decryptAiKey({ encrypted, userId: input.userId, endpoint: input.endpoint, ...overrides }, testEnv);
}

function expectSafeFailure(operation, code) {
  let failure;
  try { operation(); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(Error);
  expect(failure.message).toBe(code);
  expect(failure.code).toBe(code);
  expect(failure.cause).toBeUndefined();
  expect(Object.keys(failure)).toEqual(['code']);
  expect(JSON.stringify(failure)).toBe(JSON.stringify({ code }));
  expect(failure.stack).not.toContain(input.apiKey);
  expect(failure.stack).not.toContain(env.CUSTOM_AI_ENCRYPTION_KEY);
}

function changeByte(base64) {
  const bytes = Buffer.from(base64, 'base64');
  bytes[0] ^= 1;
  return bytes.toString('base64');
}

function nativeEnvelope(plaintext) {
  const nonce = Buffer.alloc(12, 9);
  const cipher = createCipheriv('aes-256-gcm', masterKey, nonce, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(JSON.stringify(['ai-config-api-key', 1, input.userId, input.endpoint])));
  return {
    ciphertext: Buffer.concat([cipher.update(plaintext), cipher.final()]).toString('base64'),
    nonce: nonce.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    keyVersion: 1,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('AI config crypto', () => {
  it('round trips the exact key using a version-1 AES-256-GCM envelope', () => {
    const encrypted = encryptAiKey(input, env);
    expect(Object.keys(encrypted).sort()).toEqual(['ciphertext', 'keyVersion', 'nonce', 'tag']);
    expect(encrypted.keyVersion).toBe(1);
    for (const field of ['ciphertext', 'nonce', 'tag']) {
      expect(typeof encrypted[field]).toBe('string');
      expect(Buffer.from(encrypted[field], 'base64').toString('base64')).toBe(encrypted[field]);
    }
    expect(Buffer.from(encrypted.nonce, 'base64')).toHaveLength(12);
    expect(Buffer.from(encrypted.tag, 'base64')).toHaveLength(16);
    expect(Buffer.from(encrypted.ciphertext, 'base64')).toHaveLength(Buffer.byteLength(input.apiKey));
    expect(JSON.stringify(encrypted)).not.toContain(input.apiKey);
    expect(JSON.stringify(encrypted)).not.toContain(env.CUSTOM_AI_ENCRYPTION_KEY);
    expect(decrypt(encrypted)).toBe(input.apiKey);

    // Independently authenticate with Node's built-in primitive and the AAD tuple.
    const decipher = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(encrypted.nonce, 'base64'), { authTagLength: 16 });
    decipher.setAAD(Buffer.from(JSON.stringify(['ai-config-api-key', 1, input.userId, input.endpoint])));
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
    expect(Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, 'base64')), decipher.final()]).toString('utf8')).toBe(input.apiKey);
  });

  it('generates independent 12-byte nonces and different ciphertext on every encryption', () => {
    const envelopes = Array.from({ length: 16 }, () => encryptAiKey(input, env));
    for (const field of ['nonce', 'ciphertext', 'tag']) expect(new Set(envelopes.map(encrypted => encrypted[field])).size).toBe(envelopes.length);
    for (const encrypted of envelopes) expect(decrypt(encrypted)).toBe(input.apiKey);
  });

  it('normalizes URL host case, default HTTPS port, dot segments and trailing base-URL slashes', () => {
    const encrypted = encryptAiKey({ ...input, endpoint: 'HTTPS://API.EXAMPLE.COM:443/base/../v1///' }, env);
    expect(decrypt(encrypted)).toBe(input.apiKey);
    expect(decrypt(encrypted, { endpoint: 'https://API.EXAMPLE.COM:443/v1/' })).toBe(input.apiKey);
    const root = encryptAiKey({ ...input, endpoint: 'https://api.example.com/' }, env);
    expect(decrypt(root, { endpoint: 'https://api.example.com' })).toBe(input.apiKey);
  });

  it.each([
    { userId: 'fixture-user-b' },
    { userId: 'FIXTURE-USER-A' },
    { endpoint: 'https://other.example.com/v1' },
    { endpoint: 'https://api.example.com/v2' },
    { endpoint: 'https://api.example.com/V1' },
    { endpoint: 'https://api.example.com/v1/chat/completions' },
    { endpoint: 'https://api.example.com/v1//other' },
  ])('authenticates exact account and normalized target identity: %j', overrides => {
    expectSafeFailure(() => decrypt(encryptAiKey(input, env), overrides), DECRYPT_ERROR);
  });

  it('keeps account/endpoint boundaries unambiguous in AAD', () => {
    const encrypted = encryptAiKey({ ...input, userId: 'a', endpoint: 'https://api.example.com/b' }, env);
    expectSafeFailure(() => decrypt(encrypted, { userId: 'ahttps://api.example.com/', endpoint: 'https://api.example.com/b' }), DECRYPT_ERROR);
  });

  it.each(['ciphertext', 'nonce', 'tag'])('rejects a valid-base64 bit flip in %s', field => {
    const encrypted = encryptAiKey(input, env);
    expectSafeFailure(() => decrypt({ ...encrypted, [field]: changeByte(encrypted[field]) }), DECRYPT_ERROR);
  });

  it('rejects a different valid 32-byte master key and swapped envelope components', () => {
    const first = encryptAiKey(input, env);
    const second = encryptAiKey({ ...input, apiKey: 'another-fictional-key' }, env);
    expectSafeFailure(() => decrypt(first, {}, { CUSTOM_AI_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64') }), DECRYPT_ERROR);
    for (const field of ['ciphertext', 'nonce', 'tag']) expectSafeFailure(() => decrypt({ ...first, [field]: second[field] }), DECRYPT_ERROR);
  });

  it.each([
    undefined, null, '', ' ', 1, Buffer.alloc(32),
    Buffer.alloc(31).toString('base64'), Buffer.alloc(33).toString('base64'),
    Buffer.alloc(32).toString('hex'), Buffer.alloc(32).toString('base64').slice(0, -1),
    `${Buffer.alloc(32).toString('base64')}=`, `${Buffer.alloc(32).toString('base64')}\n`,
    ` ${Buffer.alloc(32).toString('base64')}`, Buffer.alloc(32, 255).toString('base64url'),
    `${'A'.repeat(42)}B=`,
  ])('fails closed for a missing or noncanonical/non-32-byte main key (case %#)', value => {
    const encrypted = encryptAiKey(input, env);
    const badEnv = { CUSTOM_AI_ENCRYPTION_KEY: value };
    expectSafeFailure(() => encryptAiKey(input, badEnv), ENCRYPT_ERROR);
    expectSafeFailure(() => decrypt(encrypted, {}, badEnv), DECRYPT_ERROR);
  });

  it.each([{}, null, undefined, { NEXT_PUBLIC_CUSTOM_AI_ENCRYPTION_KEY: env.CUSTOM_AI_ENCRYPTION_KEY }, { NEXTAUTH_SECRET: env.CUSTOM_AI_ENCRYPTION_KEY }])('never falls back to another secret or plaintext without its dedicated environment key (case %#)', badEnv => {
    // undefined env explicitly uses a null value to avoid reading process.env.
    const testEnv = badEnv === undefined ? null : badEnv;
    expectSafeFailure(() => encryptAiKey(input, testEnv), ENCRYPT_ERROR);
    expectSafeFailure(() => decrypt(encryptAiKey(input, env), {}, testEnv), DECRYPT_ERROR);
  });

  it.each([undefined, null, '1', 0, 2, -1, NaN, {}, true])('rejects absent, coerced and unsupported keyVersion (case %#)', keyVersion => {
    expectSafeFailure(() => decrypt({ ...encryptAiKey(input, env), keyVersion }), DECRYPT_ERROR);
  });

  it.each(['ciphertext', 'nonce', 'tag'])('strictly validates the encoding and presence of %s', field => {
    const encrypted = encryptAiKey(input, env);
    const invalid = [undefined, null, 1, {}, [], Buffer.from('fixture'), '', '!!!!', ` ${encrypted[field]}`, `${encrypted[field]}\n`, `${encrypted[field]}=`, 'AA', 'A===', 'AA-_'];
    for (const value of invalid) expectSafeFailure(() => decrypt({ ...encrypted, [field]: value }), DECRYPT_ERROR);
    const missing = { ...encrypted };
    delete missing[field];
    expectSafeFailure(() => decrypt(missing), DECRYPT_ERROR);
  });

  it('rejects truncated/oversized nonce and tag, including permissively decodable padding bits', () => {
    const encrypted = encryptAiKey(input, env);
    for (const size of [0, 1, 11, 13, 16]) expectSafeFailure(() => decrypt({ ...encrypted, nonce: Buffer.alloc(size).toString('base64') }), DECRYPT_ERROR);
    for (const size of [0, 1, 12, 15, 17]) expectSafeFailure(() => decrypt({ ...encrypted, tag: Buffer.alloc(size).toString('base64') }), DECRYPT_ERROR);
    expectSafeFailure(() => decrypt({ ...encrypted, tag: `${'A'.repeat(21)}B==` }), DECRYPT_ERROR);
  });

  it('rejects malformed envelope shapes, unknown metadata and inherited/accessor fields', () => {
    const encrypted = encryptAiKey(input, env);
    const accessor = { ...encrypted };
    Object.defineProperty(accessor, 'tag', { get() { throw new Error(input.apiKey); }, enumerable: true });
    const malformed = [undefined, null, '', [], Object.create(encrypted), { ...encrypted, apiKey: input.apiKey }, { ...encrypted, algorithm: 'aes-256-cbc' }, { ...encrypted, [Symbol('extra')]: true }, accessor];
    for (const value of malformed) expectSafeFailure(() => decrypt(value), DECRYPT_ERROR);
    const missingVersion = { ...encrypted };
    delete missingVersion.keyVersion;
    expectSafeFailure(() => decrypt(missingVersion), DECRYPT_ERROR);
    expect(decrypt(Object.assign(Object.create(null), encrypted))).toBe(input.apiKey);
  });

  it.each([
    undefined, null, '', 'http://api.example.com/v1', 'ftp://api.example.com', 'not-a-url',
    'https://user:password@api.example.com/v1', 'https://@api.example.com/v1',
    'https://api.example.com:8443/v1', 'https://api.example.com/v1?token=fixture',
    'https://api.example.com/v1?', 'https://api.example.com/v1#fragment', 'https://api.example.com/v1#',
    ' https://api.example.com/v1', 'https://api.example.com/v1\n', 'https://api.example.com/a b',
    'https://api.example.com\\v1', 'https:///api.example.com/v1',
  ])('rejects malformed or ambiguous endpoint inputs (case %#)', endpoint => {
    expectSafeFailure(() => encryptAiKey({ ...input, endpoint }, env), ENCRYPT_ERROR);
    expectSafeFailure(() => decrypt(encryptAiKey(input, env), { endpoint }), DECRYPT_ERROR);
  });

  it.each([undefined, null, 1, '', ' ', ' fixture-user-a', 'fixture-user-a ', 'fixture\nuser', 'fixture\u0000user'])('rejects missing/invalid account identity (case %#)', userId => {
    expectSafeFailure(() => encryptAiKey({ ...input, userId }, env), ENCRYPT_ERROR);
    expectSafeFailure(() => decrypt(encryptAiKey(input, env), { userId }), DECRYPT_ERROR);
  });

  it.each([undefined, null, 1, {}, '', '\ud800'])('rejects absent, empty or non-UTF8-roundtrippable API keys (case %#)', apiKey => {
    expectSafeFailure(() => encryptAiKey({ ...input, apiKey }, env), ENCRYPT_ERROR);
  });

  it('preserves API key content without silent trimming or Unicode normalization', () => {
    const apiKey = ' fixture-key-组合é ';
    expect(decrypt(encryptAiKey({ ...input, apiKey }, env))).toBe(apiKey);
  });

  it('does not return unauthenticated, empty or invalid UTF-8 plaintext', () => {
    expectSafeFailure(() => decrypt({ ...encryptAiKey(input, env), ciphertext: Buffer.from(input.apiKey).toString('base64') }), DECRYPT_ERROR);
    expectSafeFailure(() => decrypt(nativeEnvelope(Buffer.alloc(0))), DECRYPT_ERROR);
    expectSafeFailure(() => decrypt(nativeEnvelope(Buffer.from([0xff]))), DECRYPT_ERROR);
  });

  it('sanitizes malformed top-level inputs and thrown getter errors', () => {
    for (const value of [undefined, null, {}, [], 'fixture']) {
      expectSafeFailure(() => encryptAiKey(value, env), ENCRYPT_ERROR);
      expectSafeFailure(() => decryptAiKey(value, env), DECRYPT_ERROR);
    }
    const maliciousEnv = { get CUSTOM_AI_ENCRYPTION_KEY() { throw new Error(input.apiKey); } };
    expectSafeFailure(() => encryptAiKey(input, maliciousEnv), ENCRYPT_ERROR);
    expectSafeFailure(() => decrypt(encryptAiKey(input, env), {}, maliciousEnv), DECRYPT_ERROR);
  });

  it('does not log secrets, metadata or failures', () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug', 'trace'].map(method => vi.spyOn(console, method).mockImplementation(() => {}));
    const encrypted = encryptAiKey(input, env);
    expect(decrypt(encrypted)).toBe(input.apiKey);
    expectSafeFailure(() => decrypt({ ...encrypted, tag: changeByte(encrypted.tag) }), DECRYPT_ERROR);
    expectSafeFailure(() => encryptAiKey(input, {}), ENCRYPT_ERROR);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
