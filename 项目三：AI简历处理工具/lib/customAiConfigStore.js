import { createHash } from 'node:crypto';
import { decryptAiKey, encryptAiKey } from './aiConfigCrypto';
import { aiConfigError, aiConfigRepository } from './aiConfigRepository';
import { CustomAiError, normalizeCustomAiBaseUrl, validateCustomAiEndpoint } from './customAiTransport';

export function validateCustomAiModel(model) {
  if (typeof model !== 'string' || !model || model.length > 200 || /[^\x21-\x7e]/.test(model)) {
    throw aiConfigError('INVALID_MODEL');
  }
  return model;
}

function configShape(config, optionalKey = false) {
  if (!config || typeof config !== 'object' || Array.isArray(config)
      || Object.keys(config).some(key => !['baseUrl', 'apiKey', 'model'].includes(key))) {
    throw new CustomAiError('INVALID_REQUEST_BODY');
  }
  const baseUrl = normalizeCustomAiBaseUrl(config.baseUrl);
  const model = validateCustomAiModel(config.model);
  if (!optionalKey || Object.hasOwn(config, 'apiKey')) {
    if (typeof config.apiKey !== 'string' || !config.apiKey || config.apiKey.length > 4096
        || /[^\x21-\x7e]/.test(config.apiKey)) throw new CustomAiError('INVALID_API_KEY');
    if (baseUrl.includes(config.apiKey) || model.includes(config.apiKey)) throw new CustomAiError('INVALID_API_KEY');
  }
  return { baseUrl, model, ...(Object.hasOwn(config, 'apiKey') ? { apiKey: config.apiKey } : {}) };
}

export function validateCustomAiConfig(config) { return configShape(config); }

// Temporary POST validation retains its existing page-memory metadata contract.
export function customAiConfigMetadata(config) {
  return config ? {
    configured: true, baseUrl: config.baseUrl, model: config.model,
    hasKey: true, maskedKey: '••••••••', storage: 'page-memory',
  } : { configured: false, baseUrl: '', model: '', hasKey: false, maskedKey: '', storage: 'page-memory' };
}

export function customAiPersistenceAvailable(env = process.env) {
  const value = env?.CUSTOM_AI_ENCRYPTION_KEY;
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return false;
  const bytes = Buffer.from(value, 'base64');
  try { return bytes.length === 32 && bytes.toString('base64') === value; }
  finally { bytes.fill(0); }
}

function requireMasterKey(env) {
  if (!customAiPersistenceAvailable(env)) throw aiConfigError('AI_CONFIG_ENCRYPTION_UNAVAILABLE');
}

function envelope(row) {
  return { ciphertext: row.ciphertext, nonce: row.nonce, tag: row.tag, keyVersion: row.keyVersion };
}

function timestamp(row) {
  try { return new Date(row.updatedAt).toISOString(); }
  catch { throw aiConfigError('AI_CONFIG_STORAGE_UNAVAILABLE'); }
}

export function customAiConfigVersion(row) {
  // Never expose the envelope. A fresh GCM nonce changes this opaque identity on
  // every save, including same-millisecond/no-op-looking edits.
  return createHash('sha256').update(JSON.stringify([
    'ai-config-v1', row.userId, row.baseUrl, row.model, row.ciphertext,
    row.nonce, row.tag, row.keyVersion, timestamp(row),
  ])).digest('base64url');
}

export function savedCustomAiConfigMetadata(row) {
  return row ? { baseUrl: row.baseUrl, model: row.model, hasKey: true, maskedKey: '••••••••',
    storage: 'account-encrypted', configVersion: customAiConfigVersion(row), updatedAt: timestamp(row) } : null;
}

export function parseCustomAiPrecondition(headers = {}, { allowCreate = false } = {}) {
  const match = headers['if-match'];
  const none = headers['if-none-match'];
  if (allowCreate && none === '*' && match === undefined) return { create: true };
  if (match === undefined && none === undefined) throw aiConfigError('CONFIG_PRECONDITION_REQUIRED');
  // One strong token only: no weak validators, wildcards, comma lists or arrays.
  if (none !== undefined || typeof match !== 'string') throw aiConfigError('INVALID_CONFIG_VERSION');
  const parsed = /^(?:"([A-Za-z0-9_-]{43})"|([A-Za-z0-9_-]{43}))$/.exec(match);
  if (!parsed) throw aiConfigError('INVALID_CONFIG_VERSION');
  return { version: parsed[1] || parsed[2] };
}

function assertVersion(row, version) {
  if (version === undefined || version === null || version === '') throw aiConfigError('CONFIG_PRECONDITION_REQUIRED');
  if (typeof version !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(version)) throw aiConfigError('INVALID_CONFIG_VERSION');
  if (!row || customAiConfigVersion(row) !== version) throw aiConfigError('CONFIG_VERSION_CONFLICT');
}

export async function getSavedCustomAiConfig(userId, { repository = aiConfigRepository, env = process.env } = {}) {
  const row = await repository.find(userId);
  return { config: savedCustomAiConfigMetadata(row), persistenceAvailable: customAiPersistenceAvailable(env) };
}

export async function saveCustomAiConfig(userId, config, precondition, {
  repository = aiConfigRepository, env = process.env, validateEndpoint = validateCustomAiEndpoint, now = () => new Date(),
} = {}) {
  const checked = configShape(config, true);
  if (!precondition || (!precondition.create && !precondition.version)) throw aiConfigError('CONFIG_PRECONDITION_REQUIRED');
  const current = await repository.find(userId);
  if (precondition.create) {
    if (current) throw aiConfigError('CONFIG_VERSION_CONFLICT');
  } else assertVersion(current, precondition.version);
  requireMasterKey(env);
  let apiKey = checked.apiKey;
  if (apiKey === undefined) {
    if (!current || current.baseUrl !== checked.baseUrl) throw aiConfigError('API_KEY_REQUIRED');
    apiKey = decryptAiKey({ encrypted: envelope(current), userId, endpoint: current.baseUrl }, env);
  }
  const complete = validateCustomAiConfig({ ...checked, apiKey });
  // DNS safety validation only. This operation never tests/bills a provider.
  await validateEndpoint(complete.baseUrl);
  const encrypted = encryptAiKey({ apiKey, userId, endpoint: complete.baseUrl }, env);
  const data = { baseUrl: complete.baseUrl, model: complete.model, ...encrypted, updatedAt: now() };
  const saved = precondition.create ? await repository.create(userId, data) : await repository.replace(userId, current, data);
  return savedCustomAiConfigMetadata(saved);
}

export async function deleteCustomAiConfig(userId, version, { repository = aiConfigRepository } = {}) {
  const current = await repository.find(userId);
  assertVersion(current, version);
  await repository.remove(userId, current);
}

export async function loadSavedCustomAiConfig(userId, version, model, { repository = aiConfigRepository, env = process.env } = {}) {
  const current = await repository.find(userId);
  assertVersion(current, version);
  requireMasterKey(env);
  const apiKey = decryptAiKey({ encrypted: envelope(current), userId, endpoint: current.baseUrl }, env);
  const config = validateCustomAiConfig({ baseUrl: current.baseUrl, model: model === undefined ? current.model : model, apiKey });
  return { config, metadata: savedCustomAiConfigMetadata(current) };
}
