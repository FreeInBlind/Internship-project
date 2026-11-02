import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { URL } from 'node:url';

const KEY_VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const ENCRYPTED_FIELDS = ['ciphertext', 'nonce', 'tag', 'keyVersion'];
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function safeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function decodeBase64(value, expectedBytes) {
  if (typeof value !== 'string' || value.length === 0 || !BASE64.test(value)) throw new Error();
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value || (expectedBytes !== undefined && bytes.length !== expectedBytes)) {
    bytes.fill(0);
    throw new Error();
  }
  return bytes;
}

function readMasterKey(env) {
  // A dedicated, canonical standard-base64 key; never reuse an auth/provider secret.
  return decodeBase64(env?.CUSTOM_AI_ENCRYPTION_KEY, 32);
}

function normalizeEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || !/^https:\/\/[^/]/i.test(endpoint) || /[\u0000- \u007f\\?#]/.test(endpoint)) throw new Error();
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.port || /^https:\/\/[^/]*@/i.test(endpoint)) throw new Error();
  // Match base-URL identity without adding /v1 or performing outbound/DNS checks.
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

function createAad(userId, endpoint) {
  if (typeof userId !== 'string' || userId.length === 0 || userId !== userId.trim() || /[\u0000-\u001f\u007f]/.test(userId)) throw new Error();
  // A versioned, unambiguous tuple prevents user/endpoint concatenation collisions.
  return Buffer.from(JSON.stringify(['ai-config-api-key', KEY_VERSION, userId, normalizeEndpoint(endpoint)]), 'utf8');
}

function readEncrypted(encrypted) {
  if (!encrypted || typeof encrypted !== 'object' || Array.isArray(encrypted)) throw new Error();
  const prototype = Object.getPrototypeOf(encrypted);
  if (prototype !== Object.prototype && prototype !== null) throw new Error();
  const descriptors = Object.getOwnPropertyDescriptors(encrypted);
  if (Reflect.ownKeys(descriptors).length !== ENCRYPTED_FIELDS.length || ENCRYPTED_FIELDS.some(field => !Object.hasOwn(descriptors, field) || !Object.hasOwn(descriptors[field], 'value'))) throw new Error();
  const values = Object.fromEntries(ENCRYPTED_FIELDS.map(field => [field, descriptors[field].value]));
  if (values.keyVersion !== KEY_VERSION) throw new Error();
  return {
    ciphertext: decodeBase64(values.ciphertext),
    nonce: decodeBase64(values.nonce, NONCE_BYTES),
    tag: decodeBase64(values.tag, TAG_BYTES),
  };
}

export function encryptAiKey(input, env = process.env) {
  let masterKey;
  let plaintext;
  try {
    const { apiKey, userId, endpoint } = input;
    masterKey = readMasterKey(env);
    const aad = createAad(userId, endpoint);
    if (typeof apiKey !== 'string' || apiKey.length === 0) throw new Error();
    plaintext = Buffer.from(apiKey, 'utf8');
    if (plaintext.toString('utf8') !== apiKey) throw new Error();
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', masterKey, nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      ciphertext: ciphertext.toString('base64'),
      nonce: nonce.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      keyVersion: KEY_VERSION,
    };
  } catch {
    throw safeError('AI_CONFIG_ENCRYPTION_FAILED');
  } finally {
    masterKey?.fill(0);
    plaintext?.fill(0);
  }
}

export function decryptAiKey(input, env = process.env) {
  let masterKey;
  let unverified;
  let finalChunk;
  let plaintext;
  try {
    const { encrypted, userId, endpoint } = input;
    masterKey = readMasterKey(env);
    const aad = createAad(userId, endpoint);
    const { ciphertext, nonce, tag } = readEncrypted(encrypted);
    const decipher = createDecipheriv('aes-256-gcm', masterKey, nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    unverified = decipher.update(ciphertext);
    finalChunk = decipher.final();
    // Do not decode or return any plaintext until final() authenticates the tag.
    plaintext = Buffer.concat([unverified, finalChunk]);
    const apiKey = plaintext.toString('utf8');
    if (apiKey.length === 0 || !Buffer.from(apiKey, 'utf8').equals(plaintext)) throw new Error();
    return apiKey;
  } catch {
    throw safeError('AI_CONFIG_DECRYPTION_FAILED');
  } finally {
    masterKey?.fill(0);
    unverified?.fill(0);
    finalChunk?.fill(0);
    plaintext?.fill(0);
  }
}
