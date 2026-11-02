import { validateCitations, validateReportInput } from './reportSchema.js';
import { sanitizeMarkdown } from './markdownSafety.js';

// Browser-safe validation: no database, credentials, network or Node imports.
export const REPORT_PERSISTENCE_LIMITS = Object.freeze({
  requestBytes: 512 * 1024, snapshotBytes: 128 * 1024,
  title: 200, confirmedResumeText: 20000, jobTitle: 200, education: 200,
  optionalJd: 12000, salary: 200, editedMarkdown: 30000,
});
const SAVE_FIELDS = ['saveId', 'title', 'confirmedResumeText', 'jobTitle', 'education', 'optionalJd', 'salary', 'reportLanguage', 'reportJson', 'editedMarkdown'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (code = 'INVALID_INPUT') => ({ ok: false, code });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function jsonByteLength(value) {
  try { return new TextEncoder().encode(JSON.stringify(value)).length; }
  catch { return Infinity; }
}

export function validateReportPatch(body) {
  if (!object(body) || !Object.keys(body).length || Object.keys(body).some(key => !['title', 'editedMarkdown'].includes(key))) return fail();
  if (jsonByteLength(body) > REPORT_PERSISTENCE_LIMITS.requestBytes) return fail('INPUT_TOO_LARGE');
  const value = {};
  for (const key of Object.keys(body)) {
    if (typeof body[key] !== 'string' || (key === 'title' && !body[key].trim())) return fail();
    if (body[key].length > REPORT_PERSISTENCE_LIMITS[key]) return fail('INPUT_TOO_LARGE');
    value[key] = key === 'title' ? body[key].trim() : sanitizeMarkdown(body[key]);
  }
  return { ok: true, value };
}

export function validateSaveReportInput(body) {
  if (!object(body) || Object.keys(body).some(key => !SAVE_FIELDS.includes(key))) return fail();
  if (jsonByteLength(body) > REPORT_PERSISTENCE_LIMITS.requestBytes) return fail('INPUT_TOO_LARGE');
  if (typeof body.saveId !== 'string' || !UUID.test(body.saveId) || !['zh', 'en'].includes(body.reportLanguage)) return fail();
  const value = { saveId: body.saveId.toLowerCase(), reportLanguage: body.reportLanguage };
  for (const key of ['title', 'confirmedResumeText', 'jobTitle', 'education', 'optionalJd', 'salary', 'editedMarkdown']) {
    const optional = key === 'optionalJd' || key === 'salary';
    if (optional && (body[key] === undefined || body[key] === null)) { value[key] = null; continue; }
    if (typeof body[key] !== 'string' || (!optional && key !== 'editedMarkdown' && !body[key].trim())) return fail();
    if (body[key].length > REPORT_PERSISTENCE_LIMITS[key]) return fail('INPUT_TOO_LARGE');
    value[key] = key === 'title' ? body[key].trim() : key === 'editedMarkdown' ? sanitizeMarkdown(body[key]) : body[key];
  }
  value.reportJson = body.reportJson ?? null;
  if (value.reportJson !== null) {
    if (jsonByteLength(value.reportJson) > REPORT_PERSISTENCE_LIMITS.snapshotBytes) return fail('INPUT_TOO_LARGE');
    if (!validateReportInput(value.reportJson).ok || value.reportJson.reportLanguage !== value.reportLanguage
        || !validateCitations(value.reportJson, value.confirmedResumeText)) return fail('INVALID_REPORT');
  }
  return { ok: true, value };
}
