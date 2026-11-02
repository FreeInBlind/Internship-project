import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth';
import { hasTrustedOrigin } from './origin';
import { REPORT_PERSISTENCE_LIMITS, jsonByteLength } from './reportPersistence';

export function reportHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}
export function reportFail(res, status, code) { return res.status(status).json({ ok: false, error: { code } }); }
const errors = { INVALID_INPUT: 422, INVALID_REPORT: 422, INPUT_TOO_LARGE: 413, NOT_FOUND: 404, SAVE_ID_CONFLICT: 409, VERSION_CONFLICT: 412, VERSION_REQUIRED: 428 };
export function reportPublicError(res, error) {
  const code = Object.hasOwn(errors, error?.code) ? error.code : 'SERVICE_UNAVAILABLE';
  return reportFail(res, errors[code] || 503, code);
}
function trustedReportOrigin(req) {
  const origin = req.headers?.origin;
  if (typeof origin !== 'string') return false;
  try { return new URL(origin).origin === origin && hasTrustedOrigin(req); }
  catch { return false; }
}
export async function guardReports(req, res, methods) {
  reportHeaders(res);
  if (!methods.includes(req.method)) {
    res.setHeader('Allow', methods.join(', '));
    reportFail(res, 405, 'METHOD_NOT_ALLOWED');
    return null;
  }
  try {
    const session = await getServerSession(req, res, authOptions);
    if (typeof session?.user?.id !== 'string' || !session.user.id.trim()) {
      reportFail(res, 401, 'UNAUTHORIZED');
      return null;
    }
    // Same-origin reads often have no Origin; writes must always have one.
    if ((req.method !== 'GET' || req.headers?.origin !== undefined) && !trustedReportOrigin(req)) {
      reportFail(res, 403, 'FORBIDDEN');
      return null;
    }
    return session.user.id;
  } catch {
    reportFail(res, 503, 'SERVICE_UNAVAILABLE');
    return null;
  }
}
function bodyError(code) { const error = new Error(code); error.code = code; return error; }
export async function readReportBody(req) {
  const max = REPORT_PERSISTENCE_LIMITS.requestBytes;
  const length = req.headers?.['content-length'];
  if (length !== undefined && (!/^\d+$/.test(String(length)) || Number(length) > max)) throw bodyError('INPUT_TOO_LARGE');
  // Support already-parsed synthetic requests; production routes disable the
  // Next parser so even parser errors use our no-store JSON error contract.
  if (req.body !== undefined && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    if (jsonByteLength(req.body) > max) throw bodyError('INPUT_TOO_LARGE');
    return req.body;
  }
  let bytes = 0;
  const chunks = [];
  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
    const chunk = Buffer.from(req.body);
    bytes = chunk.length;
    chunks.push(chunk);
  } else {
    for await (const chunk of req) {
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > max) throw bodyError('INPUT_TOO_LARGE');
      chunks.push(buffer);
    }
  }
  if (bytes > max) throw bodyError('INPUT_TOO_LARGE');
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw bodyError('INVALID_INPUT'); }
}
export function reportId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value) ? value : null;
}
export function reportIfMatch(req) {
  const header = req.headers?.['if-match'];
  if (header === undefined) throw bodyError('VERSION_REQUIRED');
  if (typeof header !== 'string' || !/^(?:[a-f0-9]{64}|"[a-f0-9]{64}")$/.test(header)) throw bodyError('VERSION_CONFLICT');
  return header.replace(/^"|"$/g, '');
}
export function sendReport(res, status, row, dto) {
  const report = dto(row);
  // Final clock check after DTO construction, transactions and lock waits.
  if (new Date(row.expiresAt).getTime() <= Date.now()) return reportFail(res, 404, 'NOT_FOUND');
  res.setHeader('ETag', `"${report.version}"`);
  return res.status(status).json({ ok: true, report });
}
