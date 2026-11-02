import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { validateReportPatch, validateSaveReportInput } from '../lib/reportPersistence';
const require = createRequire(import.meta.url);
const SAVE_ID = 'd2719f81-2f77-4a55-9a23-efc2d2cb99a1';
const input = (extra = {}) => ({ saveId: SAVE_ID, title: 'initial', confirmedResumeText: 'resume evidence', jobTitle: 'role', education: 'degree', reportLanguage: 'en', editedMarkdown: '# one', ...extra });
const copy = value => structuredClone(value);

function prismaMock() {
  const rows = [];
  function matches(row, where) {
    return Object.entries(where || {}).every(([key, value]) => {
      if (key === 'OR') return value.some(part => matches(row, part));
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        if ('gt' in value) return row[key] > value.gt;
        if ('lte' in value) return row[key] <= value.lte;
        if ('lt' in value) return row[key] < value.lt;
      }
      return row[key] instanceof Date ? row[key].getTime() === new Date(value).getTime() : row[key] === value;
    });
  }
  const db = {
    rows,
    $queryRaw: vi.fn(async () => []),
    savedReport: {
      create: vi.fn(async ({ data }) => {
        if (rows.some(row => row.id === data.id)) throw Object.assign(new Error('private duplicate detail'), { code: 'P2002' });
        rows.push(copy(data)); return copy(data);
      }),
      findFirst: vi.fn(async ({ where }) => copy(rows.find(row => matches(row, where)) || null)),
      findMany: vi.fn(async ({ where, select, take }) => rows.filter(row => matches(row, where))
        .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
        .slice(0, take).map(row => Object.fromEntries(Object.keys(select).map(key => [key, copy(row[key])])))),
      updateMany: vi.fn(async ({ where, data }) => {
        const row = rows.find(item => matches(item, where));
        if (!row) return { count: 0 };
        Object.assign(row, copy(data)); return { count: 1 };
      }),
      deleteMany: vi.fn(async ({ where }) => {
        const selected = rows.filter(row => matches(row, where));
        selected.forEach(row => rows.splice(rows.indexOf(row), 1));
        return { count: selected.length };
      }),
    },
  };
  // Serial execution models locking for deterministic unit tests. This is not
  // PostgreSQL isolation/row-lock validation and never connects to a database.
  let queue = Promise.resolve();
  db.$transaction = vi.fn(fn => {
    const result = queue.then(() => fn(db));
    queue = result.catch(() => {});
    return result;
  });
  return db;
}
function loadCjs(mock) {
  const dbPath = require.resolve('../lib/db.cjs');
  const path = require.resolve('../lib/reports.cjs');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma: mock } };
  delete require.cache[path];
  return require(path);
}

describe.each(['CommonJS', 'ES module'])('%s saved report repository', format => {
  let api;
  let core;
  let now;
  let mock;
  beforeEach(async () => {
    now = new Date('2030-01-01T00:00:00Z');
    mock = prismaMock();
    if (format === 'CommonJS') core = loadCjs(mock);
    else {
      vi.resetModules();
      vi.doMock('../lib/db', () => ({ prisma: mock }));
      core = await import('../lib/reports.js');
    }
    api = core.createReportRepository(mock, { clock: () => new Date(now), validateSave: validateSaveReportInput, validatePatch: validateReportPatch });
  });
  const save = () => ({ ...input(), userId: 'u1' });

  it('rejects invalid identifiers without touching Prisma', async () => {
    for (const value of [undefined, null, '', '   ', 0, {}, []]) {
      await expect(api.createSavedReport({ userId: value })).rejects.toThrow(TypeError);
      for (const method of ['getActiveSavedReport', 'updateSavedReport', 'deleteSavedReport']) {
        await expect(api[method]({ userId: value, id: SAVE_ID })).rejects.toThrow(TypeError);
        await expect(api[method]({ userId: 'u1', id: value })).rejects.toThrow(TypeError);
      }
    }
    expect(mock.$transaction).not.toHaveBeenCalled();
    Object.values(mock.savedReport).forEach(fn => expect(fn).not.toHaveBeenCalled());
  });

  it('keeps convenience read/delete exports wired to the matching mocked database', async () => {
    const { report } = await api.createSavedReport(save());
    // Default export clocks use real now, so move the fixture expiry safely out.
    mock.rows[0].expiresAt = new Date('2099-01-01T00:00:00Z');
    expect((await core.getActiveSavedReport({ userId: 'u1', id: report.id })).id).toBe(report.id);
    expect(await core.deleteSavedReport({ userId: 'u1', id: report.id })).toBe(true);
  });

  it('uses a server clock and refuses forged times/owner fields and unknown keys', async () => {
    await expect(api.createSavedReport({ ...save(), now })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(api.createSavedReport({ ...save(), expiresAt: now })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(api.createSavedReport({ ...save(), apiKey: 'never persist' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const { report, created } = await api.createSavedReport(save());
    expect(created).toBe(true);
    expect(report.createdAt).toEqual(now);
    expect(report.updatedAt).toEqual(now);
    expect(report.expiresAt.getTime() - now.getTime()).toBe(14 * 24 * 60 * 60 * 1000);
    const dto = core.reportDTO(report);
    expect(dto).not.toHaveProperty('userId');
    expect(dto.version).toMatch(/^[0-9a-f]{64}$/);
    expect(dto.createdAt).toBe('2030-01-01T00:00:00.000Z');
  });

  it('same owner/body retries do not extend expiry; changed body conflicts; expired IDs never revive', async () => {
    const first = await api.createSavedReport(save());
    now = new Date(now.getTime() + 1000);
    const second = await api.createSavedReport(save());
    expect(second.created).toBe(false);
    expect(second.report).toEqual(first.report);
    await expect(api.createSavedReport({ ...save(), title: 'different' })).rejects.toMatchObject({ code: 'SAVE_ID_CONFLICT' });
    await expect(api.createSavedReport({ ...save(), userId: 'u2' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    now = new Date(first.report.expiresAt);
    await expect(api.createSavedReport(save())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mock.rows).toHaveLength(1);
  });

  it('concurrent duplicate save yields one created row without renewal', async () => {
    const results = await Promise.all([api.createSavedReport(save()), api.createSavedReport(save())]);
    expect(results.map(result => result.created)).toEqual([true, false]);
    expect(mock.rows).toHaveLength(1);
    expect(results[0].report).toEqual(results[1].report);
  });

  it('recovers unique insert collisions by reading in a separate transaction', async () => {
    const realCreate = mock.savedReport.create.getMockImplementation();
    mock.savedReport.create.mockImplementationOnce(async args => {
      await realCreate(args); // Another transaction won the insert in this mock.
      throw Object.assign(new Error('conflict'), { code: 'P2002' });
    });
    const result = await api.createSavedReport(save());
    expect(result.created).toBe(false);
    expect(mock.$transaction).toHaveBeenCalledTimes(2);
    expect(mock.rows).toHaveLength(1);
    expect(mock.$queryRaw.mock.calls[0].slice(1)).toEqual([SAVE_ID, 'u1']);
  });

  it('requires version and isolates owner reads, updates, and deletes', async () => {
    const { report } = await api.createSavedReport(save());
    const version = core.reportVersion(report);
    await expect(api.updateSavedReport({ userId: 'u1', id: report.id, title: 'new' })).rejects.toMatchObject({ code: 'VERSION_REQUIRED' });
    expect(await api.getActiveSavedReport({ userId: 'u2', id: report.id })).toBeNull();
    expect(await api.updateSavedReport({ userId: 'u2', id: report.id, version, title: 'wrong' })).toBeNull();
    expect(await api.deleteSavedReport({ userId: 'u2', id: report.id })).toBe(false);
    const updated = await api.updateSavedReport({ userId: 'u1', id: report.id, version, title: 'new' });
    expect(updated.title).toBe('new');
    expect(updated.editedMarkdown).toBe(report.editedMarkdown);
    expect(updated.createdAt).toEqual(report.createdAt);
    expect(updated.expiresAt).toEqual(report.expiresAt);
    expect(core.reportVersion(updated)).not.toBe(version);
    await expect(api.updateSavedReport({ userId: 'u1', id: report.id, version, editedMarkdown: 'stale' })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(mock.savedReport.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1', id: report.id, expiresAt: { gt: expect.any(Date) }, updatedAt: report.updatedAt } }));
  });

  it('serializes competing patches and never resurrects a deleted report', async () => {
    const { report } = await api.createSavedReport(save());
    const args = { userId: 'u1', id: report.id, version: core.reportVersion(report) };
    const results = await Promise.allSettled([api.updateSavedReport({ ...args, title: 'first' }), api.updateSavedReport({ ...args, title: 'second' })]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].reason.code).toBe('VERSION_CONFLICT');
    expect(await api.deleteSavedReport(args)).toBe(true);
    expect(await api.updateSavedReport({ ...args, title: 'late' })).toBeNull();
    expect(mock.rows).toHaveLength(0);
  });

  it('uses a fresh expiry check after the lock and before returning', async () => {
    const { report } = await api.createSavedReport(save());
    mock.$queryRaw.mockImplementationOnce(async () => { now = new Date(report.expiresAt); return []; });
    expect(await api.updateSavedReport({ userId: 'u1', id: report.id, version: core.reportVersion(report), title: 'expired' })).toBeNull();
    expect(mock.savedReport.updateMany).not.toHaveBeenCalled();
    expect(await api.getActiveSavedReport({ userId: 'u1', id: report.id })).toBeNull();
    expect(await api.deleteSavedReport({ userId: 'u1', id: report.id })).toBe(true);
  });

  it('does not return a record that expires during the final update read', async () => {
    const { report } = await api.createSavedReport(save());
    const original = mock.savedReport.findFirst.getMockImplementation();
    mock.savedReport.findFirst.mockImplementation(async args => {
      const value = await original(args);
      if (args.where.expiresAt) now = new Date(report.expiresAt);
      return value;
    });
    expect(await api.updateSavedReport({ userId: 'u1', id: report.id, version: core.reportVersion(report), title: 'boundary' })).toBeNull();
    expect(mock.savedReport.updateMany).toHaveBeenCalledTimes(1);
  });

  it('uses stable descending createdAt/id pagination and metadata-only selects', async () => {
    for (const n of [1, 2, 3]) await api.createSavedReport({ ...save(), saveId: `d2719f81-2f77-4a55-9a23-efc2d2cb99a${n}` });
    await api.createSavedReport({ ...save(), userId: 'u2', saveId: 'd2719f81-2f77-4a55-9a23-efc2d2cb9999' });
    const first = await api.listSavedReports({ userId: 'u1', limit: 2 });
    expect(first.items.map(row => row.id.slice(-1))).toEqual(['3', '2']);
    expect(Object.keys(first.items[0]).sort()).toEqual(['id', 'title', 'jobTitle', 'reportLanguage', 'createdAt', 'updatedAt', 'expiresAt'].sort());
    const second = await api.listSavedReports({ userId: 'u1', limit: 2, cursor: first.nextCursor });
    expect(second.items.map(row => row.id.slice(-1))).toEqual(['1']);
    expect(second.nextCursor).toBeNull();
    expect(mock.savedReport.findMany.mock.calls[0][0].select).not.toHaveProperty('confirmedResumeText');
    for (const limit of [0, 51, -1, 1.2]) await expect(api.listSavedReports({ userId: 'u1', limit })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    for (const cursor of ['', 'bad!', Buffer.from('["invalid","id"]').toString('base64url')]) await expect(api.listSavedReports({ userId: 'u1', cursor })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('cleanup only deletes expired reports including exact expiry equality', async () => {
    const { report } = await api.createSavedReport(save());
    mock.rows.push({ ...copy(report), id: 'expired', expiresAt: new Date(now.getTime() - 1) });
    mock.rows.push({ ...copy(report), id: 'boundary', expiresAt: new Date(now) });
    expect(await api.cleanupExpiredReports()).toBe(2);
    expect(mock.rows.map(row => row.id)).toEqual([SAVE_ID]);
    expect(mock.savedReport.deleteMany).toHaveBeenCalledWith({ where: { expiresAt: { lte: now } } });
  });
});
