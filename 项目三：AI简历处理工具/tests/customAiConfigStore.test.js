// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAiConfigRepository } from '../lib/aiConfigRepository';
import { customAiConfigVersion, customAiPersistenceAvailable, deleteCustomAiConfig, getSavedCustomAiConfig, loadSavedCustomAiConfig, parseCustomAiPrecondition, saveCustomAiConfig, validateCustomAiConfig } from '../lib/customAiConfigStore';

// Never instantiate Prisma, resolve DNS or open a provider connection.
vi.mock('../lib/db', () => ({ prisma: {} }));
vi.mock('node:dns', () => ({ lookup: vi.fn(() => { throw new Error('UNEXPECTED_DNS'); }) }));
vi.mock('node:https', () => ({ request: vi.fn(() => { throw new Error('UNEXPECTED_PROVIDER'); }) }));

const env = { CUSTOM_AI_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') };
const input = { baseUrl: 'https://api.provider.com/v1', model: 'model-a', apiKey: 'fixture-credential-secret' };
const time = new Date('2026-11-02T00:00:00.000Z');
let rows;
let db;
let repository;
let validateEndpoint;
let options;

function same(row, where) {
  return row && Object.entries(where).every(([key, value]) => key === 'updatedAt'
    ? new Date(row[key]).getTime() === new Date(value).getTime() : row[key] === value);
}

beforeEach(() => {
  rows = new Map();
  db = { aiConfig: {
    findUnique: vi.fn(async ({ where }) => rows.get(where.userId) || null),
    create: vi.fn(async ({ data }) => {
      if (rows.has(data.userId)) throw Object.assign(new Error('private SQL'), { code: 'P2002' });
      rows.set(data.userId, { ...data });
      return { ...data };
    }),
    updateMany: vi.fn(async ({ where, data }) => {
      if (!same(rows.get(where.userId), where)) return { count: 0 };
      rows.set(where.userId, { ...rows.get(where.userId), ...data });
      return { count: 1 };
    }),
    deleteMany: vi.fn(async ({ where }) => {
      if (!same(rows.get(where.userId), where)) return { count: 0 };
      rows.delete(where.userId);
      return { count: 1 };
    }),
  } };
  repository = createAiConfigRepository(db);
  validateEndpoint = vi.fn(async value => value);
  options = { repository, env, validateEndpoint, now: () => time };
});

async function create(userId = 'owner-a') { return saveCustomAiConfig(userId, input, { create: true }, options); }

describe('account encrypted custom AI config', () => {
  it('stores only envelope data and returns fixed masked metadata with no credential tail', async () => {
    const saved = await create();
    expect(saved).toEqual({ baseUrl: input.baseUrl, model: input.model, hasKey: true, maskedKey: '••••••••',
      storage: 'account-encrypted', configVersion: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), updatedAt: time.toISOString() });
    const stored = rows.get('owner-a');
    expect(stored).toMatchObject({ userId: 'owner-a', keyVersion: 1 });
    expect(Object.keys(stored).sort()).toEqual(['baseUrl', 'ciphertext', 'keyVersion', 'model', 'nonce', 'tag', 'updatedAt', 'userId'].sort());
    expect(JSON.stringify(stored)).not.toContain(input.apiKey);
    expect(JSON.stringify(saved)).not.toContain(input.apiKey.slice(-4));
    expect(validateEndpoint).toHaveBeenCalledWith(input.baseUrl);
    expect(await getSavedCustomAiConfig('owner-a', options)).toEqual({ config: saved, persistenceAvailable: true });
  });

  it('isolates user scope for reads version checks and credential AAD', async () => {
    const saved = await create();
    expect(await getSavedCustomAiConfig('owner-b', options)).toEqual({ config: null, persistenceAvailable: true });
    await expect(loadSavedCustomAiConfig('owner-b', saved.configVersion, undefined, options)).rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT' });
    rows.set('owner-b', { ...rows.get('owner-a'), userId: 'owner-b' });
    const otherVersion = customAiConfigVersion(rows.get('owner-b'));
    await expect(loadSavedCustomAiConfig('owner-b', otherVersion, undefined, options)).rejects.toMatchObject({ code: 'AI_CONFIG_DECRYPTION_FAILED' });
    expect(db.aiConfig.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'owner-b' } }));
  });

  it.each([{}, { CUSTOM_AI_ENCRYPTION_KEY: 'x'.repeat(32) }, { CUSTOM_AI_ENCRYPTION_KEY: Buffer.alloc(31).toString('base64') },
    { CUSTOM_AI_ENCRYPTION_KEY: Buffer.alloc(32, 255).toString('base64url') }, { CUSTOM_AI_ENCRYPTION_KEY: `${env.CUSTOM_AI_ENCRYPTION_KEY}\n` }])('fails closed for missing or noncanonical master key %j', async badEnv => {
    expect(customAiPersistenceAvailable(badEnv)).toBe(false);
    await expect(saveCustomAiConfig('owner-a', input, { create: true }, { ...options, env: badEnv })).rejects.toMatchObject({ code: 'AI_CONFIG_ENCRYPTION_UNAVAILABLE' });
    expect(db.aiConfig.create).not.toHaveBeenCalled();
    expect(validateEndpoint).not.toHaveBeenCalled();
  });

  it('keeps GET metadata and DELETE available when the master key is absent', async () => {
    const saved = await create();
    const unavailable = { ...options, env: {} };
    expect(await getSavedCustomAiConfig('owner-a', unavailable)).toEqual({ config: saved, persistenceAvailable: false });
    await expect(loadSavedCustomAiConfig('owner-a', saved.configVersion, undefined, unavailable)).rejects.toMatchObject({ code: 'AI_CONFIG_ENCRYPTION_UNAVAILABLE' });
    await deleteCustomAiConfig('owner-a', saved.configVersion, unavailable);
    expect(rows.size).toBe(0);
  });

  it('requires a fresh key for first save and changed URL but can reuse key for same URL model edits', async () => {
    const withoutKey = { baseUrl: input.baseUrl, model: 'model-b' };
    await expect(saveCustomAiConfig('owner-a', withoutKey, { create: true }, options)).rejects.toMatchObject({ code: 'API_KEY_REQUIRED' });
    const saved = await create();
    await expect(saveCustomAiConfig('owner-a', { ...withoutKey, baseUrl: 'https://other.provider.com/v1' }, { version: saved.configVersion }, options)).rejects.toMatchObject({ code: 'API_KEY_REQUIRED' });
    const updated = await saveCustomAiConfig('owner-a', withoutKey, { version: saved.configVersion }, options);
    expect(updated.configVersion).not.toBe(saved.configVersion);
    expect((await loadSavedCustomAiConfig('owner-a', updated.configVersion, undefined, options)).config).toEqual({ ...input, model: 'model-b' });
    expect(db.aiConfig.updateMany.mock.calls[0][0].where).toMatchObject({ userId: 'owner-a', ciphertext: expect.any(String), nonce: expect.any(String), tag: expect.any(String), updatedAt: time });
  });

  it('allows changed endpoints only with a newly supplied key and binds ciphertext to that endpoint', async () => {
    const first = await create();
    const next = { baseUrl: 'https://new.provider.com/v1', model: 'model-b', apiKey: 'fixture-new-secret-key' };
    const saved = await saveCustomAiConfig('owner-a', next, { version: first.configVersion }, options);
    expect((await loadSavedCustomAiConfig('owner-a', saved.configVersion, undefined, options)).config).toEqual(next);
    expect(validateEndpoint).toHaveBeenLastCalledWith(next.baseUrl);
    expect(JSON.stringify(rows.get('owner-a'))).not.toContain(next.apiKey);
  });

  it('fails closed on tampered envelopes and incorrect but well-formed master keys', async () => {
    const saved = await create();
    const changedKey = { CUSTOM_AI_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64') };
    await expect(loadSavedCustomAiConfig('owner-a', saved.configVersion, undefined, { ...options, env: changedKey })).rejects.toMatchObject({ code: 'AI_CONFIG_DECRYPTION_FAILED' });
    rows.set('owner-a', { ...rows.get('owner-a'), tag: Buffer.alloc(16).toString('base64') });
    const tamperedVersion = customAiConfigVersion(rows.get('owner-a'));
    await expect(loadSavedCustomAiConfig('owner-a', tamperedVersion, undefined, options)).rejects.toMatchObject({ code: 'AI_CONFIG_DECRYPTION_FAILED' });
    expect(db.aiConfig.updateMany).not.toHaveBeenCalled();
  });

  it('changes version even if metadata and timestamp are unchanged', async () => {
    const first = await create();
    const second = await saveCustomAiConfig('owner-a', input, { version: first.configVersion }, options);
    expect(second.configVersion).not.toBe(first.configVersion);
  });

  it('rejects stale saved calls and supports same-URL nonpersisted model override', async () => {
    const first = await create();
    const effective = await loadSavedCustomAiConfig('owner-a', first.configVersion, 'one-time-model', options);
    expect(effective.config).toEqual({ ...input, model: 'one-time-model' });
    expect(effective.metadata.model).toBe(input.model);
    expect(rows.get('owner-a').model).toBe(input.model);
    await expect(loadSavedCustomAiConfig('owner-a', first.configVersion, 'bad model', options)).rejects.toMatchObject({ code: 'INVALID_MODEL' });
    const second = await saveCustomAiConfig('owner-a', { ...input, model: 'model-b' }, { version: first.configVersion }, options);
    await expect(loadSavedCustomAiConfig('owner-a', first.configVersion, undefined, options)).rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT' });
    await expect(deleteCustomAiConfig('owner-a', first.configVersion, options)).rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT' });
    expect(customAiConfigVersion(rows.get('owner-a'))).toBe(second.configVersion);
  });

  it('uses conditional DB write/delete, detecting races after the version read', async () => {
    const saved = await create();
    db.aiConfig.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(saveCustomAiConfig('owner-a', input, { version: saved.configVersion }, options)).rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT' });
    db.aiConfig.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(deleteCustomAiConfig('owner-a', saved.configVersion, options)).rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT' });
    expect(db.aiConfig.deleteMany.mock.calls[0][0].where).toEqual(expect.objectContaining({ userId: 'owner-a', baseUrl: input.baseUrl, model: input.model,
      ciphertext: expect.any(String), nonce: expect.any(String), tag: expect.any(String), keyVersion: 1, updatedAt: time }));
  });

  it('requires owner identity and explicit versions before any credential can be returned', async () => {
    await expect(repository.find('')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(repository.find(' owner-a')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const saved = await create();
    await expect(loadSavedCustomAiConfig('owner-a', undefined, undefined, options)).rejects.toMatchObject({ code: 'CONFIG_PRECONDITION_REQUIRED' });
    await expect(deleteCustomAiConfig('owner-a', undefined, options)).rejects.toMatchObject({ code: 'CONFIG_PRECONDITION_REQUIRED' });
    await deleteCustomAiConfig('owner-a', saved.configVersion, options);
    const recreated = await create();
    expect(recreated.configVersion).not.toBe(saved.configVersion);
    await expect(deleteCustomAiConfig('owner-a', saved.configVersion, options)).rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT' });
    expect(rows.has('owner-a')).toBe(true);
  });

  it('maps unique creation races and DB errors to safe fixed codes', async () => {
    const saved = await create();
    await expect(repository.create('owner-a', rows.get('owner-a'))).rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT', message: 'CONFIG_VERSION_CONFLICT' });
    db.aiConfig.findUnique.mockRejectedValueOnce(new Error('SQL password fixture-credential-secret'));
    await expect(getSavedCustomAiConfig('owner-a', options)).rejects.toMatchObject({ code: 'AI_CONFIG_STORAGE_UNAVAILABLE', message: 'AI_CONFIG_STORAGE_UNAVAILABLE' });
    expect(saved.configVersion).toBeTruthy();
  });

  it('rejects failed DNS before storing and never stores plaintext credential fields', async () => {
    validateEndpoint.mockRejectedValueOnce(Object.assign(new Error('UNSAFE_UPSTREAM_ADDRESS'), { code: 'UNSAFE_UPSTREAM_ADDRESS' }));
    await expect(create()).rejects.toMatchObject({ code: 'UNSAFE_UPSTREAM_ADDRESS' });
    expect(db.aiConfig.create).not.toHaveBeenCalled();
    expect(() => validateCustomAiConfig({ ...input, model: input.apiKey })).toThrow('INVALID_API_KEY');
  });
});

describe('HTTP configuration preconditions', () => {
  const token = 'a'.repeat(43);
  it('supports first-save wildcard and one strong quoted or unquoted version', () => {
    expect(parseCustomAiPrecondition({ 'if-none-match': '*' }, { allowCreate: true })).toEqual({ create: true });
    expect(parseCustomAiPrecondition({ 'if-match': token })).toEqual({ version: token });
    expect(parseCustomAiPrecondition({ 'if-match': `"${token}"` })).toEqual({ version: token });
  });
  it('requires preconditions and rejects weak multiple or ambiguous headers', () => {
    expect(() => parseCustomAiPrecondition({})).toThrow('CONFIG_PRECONDITION_REQUIRED');
    for (const headers of [{ 'if-match': '*' }, { 'if-match': `W/"${token}"` }, { 'if-match': [token] },
      { 'if-match': `${token},${token}` }, { 'if-match': token, 'if-none-match': '*' }, { 'if-none-match': '*' }]) {
      expect(() => parseCustomAiPrecondition(headers)).toThrow('INVALID_CONFIG_VERSION');
    }
  });
});
