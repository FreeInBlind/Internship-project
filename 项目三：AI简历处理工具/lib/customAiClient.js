const errorCodes = new Set([
  'INVALID_INPUT', 'INVALID_BASE_URL', 'INVALID_API_KEY', 'INVALID_MODEL',
  'MISSING_CONFIG', 'CONFIG_REQUIRED', 'UNAUTHORIZED', 'FORBIDDEN', 'RATE_LIMITED',
  'REQUEST_IN_PROGRESS', 'REQUEST_ALREADY_HANDLED', 'REQUEST_CAPACITY',
  'INVALID_REQUEST_BODY', 'UNSAFE_UPSTREAM_ADDRESS', 'UPSTREAM_DNS',
  'UPSTREAM_ABORTED', 'UPSTREAM_AUTH', 'UPSTREAM_RATE_LIMIT', 'UPSTREAM_REDIRECT',
  'UPSTREAM_UNAUTHORIZED', 'UPSTREAM_REJECTED', 'UPSTREAM_UNAVAILABLE',
  'UPSTREAM_TIMEOUT', 'INVALID_UPSTREAM_RESPONSE', 'INVALID_REPORT',
  'UPSTREAM_TRUNCATED', 'INPUT_TOO_LARGE', 'INSECURE_TRANSPORT',
  'REQUEST_FAILED', 'REQUEST_ABORTED', 'CONFIG_PRECONDITION_REQUIRED', 'CONFIG_VERSION_CONFLICT',
  'PERSISTENCE_UNAVAILABLE', 'CONFIG_STORAGE_UNAVAILABLE', 'CONFIG_NOT_FOUND', 'CONFIG_DECRYPTION_FAILED',
  'AI_CONFIG_STORAGE_UNAVAILABLE', 'AI_CONFIG_ENCRYPTION_UNAVAILABLE', 'AI_CONFIG_ENCRYPTION_FAILED', 'AI_CONFIG_DECRYPTION_FAILED', 'API_KEY_REQUIRED', 'INVALID_CONFIG_VERSION',
]);
const allowedPaths = new Set([
  '/api/custom-ai/config', '/api/custom-ai/test', '/api/custom-ai/analyze',
]);

function requestError(code) {
  const safeCode = errorCodes.has(code) ? code : 'REQUEST_FAILED';
  const error = new Error(safeCode);
  error.code = safeCode;
  return error;
}

export function hasSecureCustomAiTransport(location = typeof window === 'undefined' ? null : window.location) {
  if (!location) return false;
  if (location.protocol === 'https:') return true;
  return location.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);
}

export function validateCustomAiBaseUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048 || /[^\x21-\x7e]|[\\?#]/.test(value)) return 'INVALID_BASE_URL';
  let parsed;
  try { parsed = new URL(value); } catch { return 'INVALID_BASE_URL'; }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname.endsWith('/chat/completions')) return 'INVALID_BASE_URL';
  if (parsed.protocol !== 'https:') return 'INVALID_BASE_URL';
  if (parsed.hostname.includes('@') || parsed.port && parsed.port !== '443') return 'INVALID_BASE_URL';
  return null;
}

export async function customAiRequest(path, body, { signal, method = 'POST', headers: conditionalHeaders = {} } = {}) {
  if (!allowedPaths.has(path) || !['GET', 'POST', 'PUT', 'DELETE'].includes(method)
    || (path !== '/api/custom-ai/config' && method !== 'POST')
    || ((method === 'GET' || method === 'DELETE') && body !== undefined)) throw requestError('REQUEST_FAILED');
  if (!conditionalHeaders || typeof conditionalHeaders !== 'object' || Array.isArray(conditionalHeaders)) throw requestError('REQUEST_FAILED');
  const headers = method === 'GET' || method === 'DELETE' ? {} : { 'Content-Type': 'application/json' };
  const seenHeaders = new Set();
  for (const [name, value] of Object.entries(conditionalHeaders)) {
    const lower = name.toLowerCase();
    if (seenHeaders.has(lower) || path !== '/api/custom-ai/config' || !['PUT', 'DELETE'].includes(method)
      || !['if-match', 'if-none-match'].includes(lower) || typeof value !== 'string'
      || (lower === 'if-none-match' ? method !== 'PUT' || value !== '*' : !/^(?:[A-Za-z0-9_-]{1,256}|"[A-Za-z0-9_-]{1,256}")$/.test(value))) throw requestError('REQUEST_FAILED');
    seenHeaders.add(lower);
    headers[lower === 'if-match' ? 'If-Match' : 'If-None-Match'] = value;
  }
  if (headers['If-Match'] && headers['If-None-Match']) throw requestError('REQUEST_FAILED');
  if (!hasSecureCustomAiTransport()) throw requestError('INSECURE_TRANSPORT');
  if (signal?.aborted) throw requestError('REQUEST_ABORTED');

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    throw requestError(signal?.aborted || error?.name === 'AbortError' ? 'REQUEST_ABORTED' : 'REQUEST_FAILED');
  }

  let result;
  try { result = await response.json(); }
  catch { throw requestError('REQUEST_FAILED'); }
  if (signal?.aborted) throw requestError('REQUEST_ABORTED');
  if (!response.ok || result?.ok === false) {
    throw requestError(response.status === 412 ? 'CONFIG_VERSION_CONFLICT' : response.status === 428 ? 'CONFIG_PRECONDITION_REQUIRED' : result?.code || result?.error?.code);
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw requestError('REQUEST_FAILED');
  return result;
}
