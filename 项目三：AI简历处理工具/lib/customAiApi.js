import { createHash } from 'node:crypto';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth';
import { hasTrustedOrigin } from './origin';

const handled = new Set();
const activeUsers = new Set();
const MAX_HANDLED = 4096;
const ERRORS = {
  INVALID_INPUT: 422, INVALID_REQUEST_BODY: 422, INVALID_BASE_URL: 422,
  INVALID_API_KEY: 422, INVALID_MODEL: 422, CONFIG_REQUIRED: 422,
  INPUT_TOO_LARGE: 413, UNSAFE_UPSTREAM_ADDRESS: 422,
  UPSTREAM_DNS: 502, UPSTREAM_TIMEOUT: 504, UPSTREAM_ABORTED: 409,
  UPSTREAM_AUTH: 502, UPSTREAM_RATE_LIMIT: 429, UPSTREAM_REDIRECT: 502,
  UPSTREAM_UNAVAILABLE: 502, INVALID_UPSTREAM_RESPONSE: 502,
  INVALID_REPORT: 502, UPSTREAM_TRUNCATED: 502,
  UNAUTHORIZED: 401, API_KEY_REQUIRED: 422, INVALID_CONFIG_VERSION: 422,
  CONFIG_PRECONDITION_REQUIRED: 428, CONFIG_VERSION_CONFLICT: 412,
  AI_CONFIG_STORAGE_UNAVAILABLE: 503, AI_CONFIG_ENCRYPTION_UNAVAILABLE: 503,
  AI_CONFIG_ENCRYPTION_FAILED: 503, AI_CONFIG_DECRYPTION_FAILED: 503,
};

export function customAiFail(res, status, code) {
  return res.status(status).json({ ok: false, error: { code, message: 'Personal AI request was not completed. No automatic retry or official fallback was made.' } });
}

export function customAiPublicError(res, error) {
  const code = Object.hasOwn(ERRORS, error?.code) ? error.code : 'UPSTREAM_UNAVAILABLE';
  return customAiFail(res, ERRORS[code], code);
}

export async function guardCustomAi(req, res, methods) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!methods.includes(req.method)) {
    res.setHeader('Allow', methods.join(', '));
    customAiFail(res, 405, 'METHOD_NOT_ALLOWED');
    return null;
  }
  try {
    const session = await getServerSession(req, res, authOptions);
    if (typeof session?.user?.id !== 'string' || !session.user.id) {
      customAiFail(res, 401, 'UNAUTHORIZED');
      return null;
    }
    const noOriginRead = req.method === 'GET' && req.headers?.origin === undefined
      && (req.headers?.['sec-fetch-site'] === undefined
        || ['same-origin', 'none'].includes(req.headers['sec-fetch-site']));
    if (!noOriginRead && !hasTrustedOrigin(req)) {
      customAiFail(res, 403, 'FORBIDDEN');
      return null;
    }
    return session.user.id;
  } catch {
    customAiFail(res, 503, 'SERVICE_UNAVAILABLE');
    return null;
  }
}

export function validCustomAiBody(body, fields) {
  return body && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body).every(key => fields.includes(key));
}

export function beginCustomAiRequest(userId, requestId) {
  if (typeof requestId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    return { error: 'INVALID_INPUT', status: 422 };
  }
  const user = createHash('sha256').update(userId).digest('hex');
  const token = createHash('sha256').update(JSON.stringify([userId, requestId.toLowerCase()])).digest('hex');
  if (handled.has(token)) return { error: 'REQUEST_ALREADY_HANDLED', status: 409 };
  if (activeUsers.has(user)) return { error: 'REQUEST_IN_PROGRESS', status: 409 };
  // Never evict a handled ID to silently allow a retry. Single-process guard only:
  // restarts and multiple replicas are not durable exactly-once delivery.
  if (handled.size >= MAX_HANDLED) return { error: 'REQUEST_CAPACITY', status: 503 };
  handled.add(token);
  activeUsers.add(user);
  return { release: () => activeUsers.delete(user) };
}

export function customAiAbortSignal(req, res) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const close = () => { if (!res.writableEnded) abort(); };
  req.once?.('aborted', abort);
  res.once?.('close', close);
  if (req.aborted || res.destroyed) abort();
  return {
    signal: controller.signal,
    cleanup: () => {
      req.removeListener?.('aborted', abort);
      res.removeListener?.('close', close);
    },
  };
}
