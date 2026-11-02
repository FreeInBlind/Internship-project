import { getServerSession } from 'next-auth/next';
import { officialAiServerAvailable } from '../../lib/aiAvailability';
import { authOptions } from '../../lib/auth';
import { hasTrustedOrigin } from '../../lib/origin';
import { createHmac } from 'crypto';
import { GroqError, analyzeWithGroq, GROQ_MAX_INPUT_CHARS, readGroqConfig } from '../../lib/groq';
import { QuotaError, reserveOfficialAttempt, settleOfficialAttempt, releaseOfficialAttempt, quotaStorageEnabled } from '../../lib/quota';
import { reportToMarkdown } from '../../lib/reportSchema';

const LIMITS = { text: GROQ_MAX_INPUT_CHARS, jobTitle: 200, education: 200, optionalJd: 12000, salary: 200 };
function fail(res, status, code, message) { return res.status(status).json({ ok: false, error: { code, message } }); }
function validString(value, max, required = false) { return typeof value === 'string' && value.length <= max && (required ? Boolean(value.trim()) : true); }
function publicError(error) {
  const map = {
    SERVICE_DISABLED: [503, 'SERVICE_DISABLED', 'Analysis service is currently unavailable.'],
    CONFIG_UNAVAILABLE: [503, 'SERVICE_UNAVAILABLE', 'Analysis service is currently unavailable.'],
    INPUT_TOO_LARGE: [413, 'INPUT_TOO_LARGE', 'Please shorten the resume or job description.'],
    UPSTREAM_AUTH: [502, 'UPSTREAM_AUTH', 'The analysis provider rejected the server configuration.'],
    UPSTREAM_RATE_LIMIT: [503, 'UPSTREAM_RATE_LIMIT', 'The analysis provider is temporarily rate limited.'],
    UPSTREAM_TIMEOUT: [504, 'UPSTREAM_TIMEOUT', 'Analysis timed out. Its result may be unknown; do not retry this request.'],
    UPSTREAM_NETWORK: [502, 'UPSTREAM_UNAVAILABLE', 'The analysis provider is unavailable.'],
    UPSTREAM_UNAVAILABLE: [502, 'UPSTREAM_UNAVAILABLE', 'The analysis provider is unavailable.'],
    UPSTREAM_TRUNCATED: [502, 'INVALID_UPSTREAM_RESPONSE', 'The provider returned an incomplete result.'],
    INVALID_UPSTREAM_RESPONSE: [502, 'INVALID_UPSTREAM_RESPONSE', 'The provider returned an invalid result.'],
    INVALID_REPORT: [502, 'INVALID_REPORT', 'The provider result did not pass report validation.'],
    QUOTA_EXHAUSTED: [429, 'QUOTA_EXHAUSTED', 'The shared official daily analysis quota is exhausted.'],
    IDEMPOTENCY_CONFLICT: [409, 'REQUEST_ID_CONFLICT', 'This request identifier was already used for different input.'],
    REQUEST_IN_PROGRESS: [409, 'REQUEST_IN_PROGRESS', 'This analysis request is already being processed.'],
    REQUEST_ALREADY_HANDLED: [409, 'REQUEST_ALREADY_HANDLED', 'This request identifier was already handled. Start a new analysis to retry.'],
    QUOTA_STORAGE_UNAVAILABLE: [503, 'SERVICE_UNAVAILABLE', 'Analysis service is currently unavailable.'],
  };
  return map[error?.code] || [503, 'SERVICE_UNAVAILABLE', 'Analysis service is currently unavailable.'];
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return fail(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.'); }
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) return fail(res, 401, 'UNAUTHORIZED', 'Authentication required.');
  if (!hasTrustedOrigin({ headers: req?.headers || {} })) return fail(res, 403, 'FORBIDDEN', 'Request rejected.');
  if (!officialAiServerAvailable()) return fail(res, 503, 'SERVICE_DISABLED', 'Official AI is currently unavailable.');
  const body = req.body;
  const allowed = new Set(['text', 'jobTitle', 'education', 'optionalJd', 'salary', 'reportLanguage', 'requestId']);
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !allowed.has(key))) return fail(res, 400, 'INVALID_INPUT', 'Invalid analysis request.');
  if (!validString(body.text, LIMITS.text, true) || !validString(body.jobTitle, LIMITS.jobTitle, true) || !validString(body.education, LIMITS.education, true) || (body.optionalJd !== undefined && !validString(body.optionalJd, LIMITS.optionalJd)) || (body.salary !== undefined && !validString(body.salary, LIMITS.salary)) || !['zh', 'en'].includes(body.reportLanguage) || typeof body.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)) return fail(res, 422, 'INVALID_INPUT', 'Invalid analysis fields.');
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 128 * 1024) return fail(res, 413, 'INPUT_TOO_LARGE', 'Please shorten the resume or job description.');
  if (!quotaStorageEnabled()) return fail(res, 503, 'SERVICE_DISABLED', 'Analysis service is currently unavailable.');
  try { readGroqConfig(); } catch (error) { const [status, code, message] = publicError(error); return fail(res, status, code, message); }
  const requestHashKey = process.env.NEXTAUTH_SECRET;
  if (typeof requestHashKey !== 'string' || requestHashKey.length < 16) return fail(res, 503, 'SERVICE_UNAVAILABLE', 'Analysis service is currently unavailable.');
  const requestHash = createHmac('sha256', requestHashKey).update(JSON.stringify({ text: body.text, jobTitle: body.jobTitle, education: body.education, optionalJd: body.optionalJd || '', salary: body.salary || '', reportLanguage: body.reportLanguage })).digest('hex');
  let reservation;
  try {
    reservation = await reserveOfficialAttempt({ userId: session.user.id, requestId: body.requestId, requestHash });
  } catch (error) {
    const [status, code, message] = publicError(error);
    return fail(res, status, code, message);
  }
  if (reservation.kind === 'exhausted') return fail(res, 429, 'QUOTA_EXHAUSTED', 'The shared official daily analysis quota is exhausted.');
  if (reservation.kind === 'in_progress') return fail(res, 409, 'REQUEST_IN_PROGRESS', 'This analysis request is already being processed.');
  if (reservation.kind === 'completed' || reservation.kind === 'previously_failed') return fail(res, 409, 'REQUEST_ALREADY_HANDLED', 'This request identifier was already handled. Start a new analysis to retry.');
  if (reservation.kind !== 'reserved') return fail(res, 503, 'SERVICE_UNAVAILABLE', 'Analysis service is currently unavailable.');
  try {
    const report = await analyzeWithGroq(body);
    const settled = await settleOfficialAttempt({ attemptId: reservation.attemptId, leaseToken: reservation.leaseToken });
    if (!settled) return fail(res, 503, 'SERVICE_UNAVAILABLE', 'Analysis completed but could not be finalized. Do not retry this request.');
    return res.status(200).json({ ok: true, report, markdown: reportToMarkdown(report) });
  } catch (error) {
    if (error?.code !== 'UPSTREAM_TIMEOUT' && error?.code !== 'UPSTREAM_NETWORK' && !(error instanceof QuotaError && error.code === 'QUOTA_STORAGE_UNAVAILABLE')) {
      try { await releaseOfficialAttempt({ attemptId: reservation.attemptId, leaseToken: reservation.leaseToken }); } catch { return fail(res, 503, 'SERVICE_UNAVAILABLE', 'Analysis service is currently unavailable.'); }
    }
    const [status, code, message] = publicError(error);
    return fail(res, status, code, message);
  }
}
