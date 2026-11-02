const { createHash } = require('node:crypto');
const REPORT_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const CONTENT_FIELDS = ['title', 'confirmedResumeText', 'jobTitle', 'optionalJd', 'education', 'salary', 'reportLanguage', 'editedMarkdown', 'reportJson'];
const META_FIELDS = ['id', 'title', 'jobTitle', 'reportLanguage', 'createdAt', 'updatedAt', 'expiresAt'];
const metadataSelect = Object.fromEntries(META_FIELDS.map(key => [key, true]));
const STATUSES = { INVALID_INPUT: 422, INVALID_REPORT: 422, INPUT_TOO_LARGE: 413, NOT_FOUND: 404, SAVE_ID_CONFLICT: 409, VERSION_CONFLICT: 412, VERSION_REQUIRED: 428 };

class ReportError extends Error {
  constructor(code) { super(code); this.code = code; this.status = STATUSES[code] || 503; }
}
function assertIdentifier(name, value) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object' && !(value instanceof Date)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function digest(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function content(row) { return Object.fromEntries(CONTENT_FIELDS.map(key => [key, row[key] ?? null])); }
function reportVersion(row) { return digest({ id: row.id, ...content(row), createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString(), expiresAt: new Date(row.expiresAt).toISOString() }); }
function reportMetadata(row) { return Object.fromEntries(META_FIELDS.map(key => [key, key.endsWith('At') ? new Date(row[key]).toISOString() : row[key]])); }
function reportDTO(row) { return { ...reportMetadata(row), ...content(row), version: reportVersion(row) }; }
function live(row, now) { return row && new Date(row.expiresAt).getTime() > now.getTime(); }

// One implementation shared by ESM and CJS. Validation is injected by ESM, or
// loaded lazily in Node 24 so requiring this file remains compatible with mocks.
function createReportRepository(db, { clock = () => new Date(), validateSave, validatePatch } = {}) {
  async function validators() {
    if (validateSave && validatePatch) return { validateSaveReportInput: validateSave, validateReportPatch: validatePatch };
    return import('./reportPersistence.js');
  }
  async function locked(tx, userId, id) {
    // Values are bound parameters. Never interpolate identifiers or owner input.
    await tx.$queryRaw`SELECT "id" FROM "public"."SavedReport" WHERE "id" = ${id} AND "userId" = ${userId} FOR UPDATE`;
    return tx.savedReport.findFirst({ where: { userId, id } });
  }
  function ids(userId, id) { assertIdentifier('userId', userId); assertIdentifier('id', id); }
  async function createSavedReport(input) {
    const { userId, ...body } = input;
    assertIdentifier('userId', userId);
    const checked = (await validators()).validateSaveReportInput(body);
    if (!checked.ok) throw new ReportError(checked.code);
    const { saveId: id, ...data } = checked.value;
    const createOrRead = allowCreate => db.$transaction(async tx => {
      const existing = await locked(tx, userId, id);
      const now = clock(); // Fresh after waiting for the row lock.
      if (existing) {
        if (!live(existing, now)) throw new ReportError('NOT_FOUND');
        if (digest(content(existing)) !== digest(content(data))) throw new ReportError('SAVE_ID_CONFLICT');
        return { report: existing, created: false };
      }
      // Collisions with another owner reveal no record or content.
      if (await tx.savedReport.findFirst({ where: { id } })) throw new ReportError('NOT_FOUND');
      if (!allowCreate) throw new ReportError('NOT_FOUND');
      const stored = { ...data };
      // Prisma distinguishes JSON null and database NULL. Omission on this new
      // nullable column stores DB NULL without importing Prisma sentinel values.
      if (stored.reportJson === null) delete stored.reportJson;
      const row = await tx.savedReport.create({ data: { id, userId, ...stored, createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + REPORT_TTL_MS) } });
      return { report: row, created: true };
    });
    let result;
    try { result = await createOrRead(true); }
    catch (error) {
      // Concurrent inserts have no row to lock. The PK serializes them; retry
      // only the read in a NEW transaction after the unique conflict rollback.
      if (error?.code !== 'P2002') throw error;
      result = await createOrRead(false);
    }
    if (!live(result.report, clock())) throw new ReportError('NOT_FOUND');
    return result;
  }
  async function getActiveSavedReport({ userId, id }) {
    ids(userId, id);
    const row = await db.savedReport.findFirst({ where: { userId, id, expiresAt: { gt: clock() } } });
    return live(row, clock()) ? row : null;
  }
  async function updateSavedReport({ userId, id, version, ...body }) {
    ids(userId, id);
    if (!version) throw new ReportError('VERSION_REQUIRED');
    const checked = (await validators()).validateReportPatch(body);
    if (!checked.ok) throw new ReportError(checked.code);
    const row = await db.$transaction(async tx => {
      const current = await locked(tx, userId, id);
      const now = clock();
      if (!live(current, now)) return null;
      if (version !== reportVersion(current)) throw new ReportError('VERSION_CONFLICT');
      // Include owner, expiry and the observed edit time even with the row lock.
      const result = await tx.savedReport.updateMany({
        where: { userId, id, expiresAt: { gt: now }, updatedAt: current.updatedAt },
        data: { ...checked.value, updatedAt: new Date(Math.max(now.getTime(), new Date(current.updatedAt).getTime() + 1)) },
      });
      if (result.count !== 1) throw new ReportError('VERSION_CONFLICT');
      const updated = await tx.savedReport.findFirst({ where: { userId, id, expiresAt: { gt: clock() } } });
      return live(updated, clock()) ? updated : null;
    });
    return live(row, clock()) ? row : null;
  }
  async function deleteSavedReport({ userId, id }) {
    ids(userId, id);
    return (await db.savedReport.deleteMany({ where: { userId, id } })).count === 1;
  }
  async function listSavedReports({ userId, limit = 20, cursor } = {}) {
    assertIdentifier('userId', userId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new ReportError('INVALID_INPUT');
    let after;
    if (cursor !== undefined) {
      if (typeof cursor !== 'string' || cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new ReportError('INVALID_INPUT');
      try {
        const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string' || !parsed[1] || parsed[1].length > 200 || new Date(parsed[0]).toISOString() !== parsed[0]) throw new Error();
        after = { OR: [{ createdAt: { lt: new Date(parsed[0]) } }, { createdAt: new Date(parsed[0]), id: { lt: parsed[1] } }] };
      } catch { throw new ReportError('INVALID_INPUT'); }
    }
    const rows = await db.savedReport.findMany({ where: { userId, expiresAt: { gt: clock() }, ...after }, select: metadataSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1 });
    // Advance by scanned rows, even if some expire while the query is running.
    // Otherwise a short filtered page could incorrectly terminate pagination.
    const scanned = rows.slice(0, limit);
    const page = scanned.filter(row => live(row, clock()));
    const last = scanned[scanned.length - 1];
    return { items: page.map(reportMetadata), nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify([new Date(last.createdAt).toISOString(), last.id])).toString('base64url') : null };
  }
  async function cleanupExpiredReports() { return (await db.savedReport.deleteMany({ where: { expiresAt: { lte: clock() } } })).count; }
  return { createSavedReport, getActiveSavedReport, updateSavedReport, deleteSavedReport, listSavedReports, cleanupExpiredReports };
}
// Loading the shared implementation from ESM must not instantiate a second DB
// client. CJS convenience exports resolve their database only when called.
const exported = { REPORT_TTL_MS, ReportError, reportVersion, reportDTO, reportMetadata, createReportRepository };
Object.defineProperty(exported, 'prisma', { enumerable: true, get: () => require('./db.cjs').prisma });
for (const name of ['createSavedReport', 'getActiveSavedReport', 'updateSavedReport', 'deleteSavedReport', 'listSavedReports', 'cleanupExpiredReports']) {
  exported[name] = (...args) => createReportRepository(require('./db.cjs').prisma)[name](...args);
}
module.exports = exported;
