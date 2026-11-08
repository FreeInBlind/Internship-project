import 'server-only';

import { randomUUID } from 'node:crypto';
import { getAuth, getAuthOrigin } from './auth';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details: unknown = null) {
    super(message);
  }
}

export function api(handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    try {
      return await handler(request);
    } catch (error) {
      const known = error instanceof ApiError;
      return Response.json({ error: {
        code: known ? error.code : 'INTERNAL_ERROR',
        message: known ? error.message : '服务暂时不可用，请稍后重试',
        requestId: randomUUID(),
        retryable: !known,
        details: known ? error.details : null,
      } }, { status: known ? error.status : 500, headers: { 'Cache-Control': 'no-store' } });
    }
  };
}

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function requireUser(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) throw new ApiError(401, 'UNAUTHENTICATED', '请先登录');
  return session.user.id;
}

const writeWindows = new Map<string, { start: number; count: number }>();

export function limitWrites(userId: string) {
  const now = Date.now();
  for (const [id, window] of writeWindows) {
    if (now - window.start >= 60_000) writeWindows.delete(id);
  }
  const window = writeWindows.get(userId) ?? { start: now, count: 0 };
  if (window.count >= 120) throw new ApiError(429, 'QUOTA_EXCEEDED', '保存过于频繁，请稍后重试', { retryAfterSeconds: Math.ceil((60_000 - now + window.start) / 1000) });
  window.count++;
  writeWindows.set(userId, window);
}

export function checkWriteOrigin(request: Request) {
  if (request.headers.get('origin') !== getAuthOrigin() || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new ApiError(403, 'FORBIDDEN', '写入请求必须来自本站');
  }
  if (request.method !== 'DELETE' && request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    throw new ApiError(415, 'VALIDATION_ERROR', '请使用 application/json');
  }
}

export async function body(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('content-length') ?? 0) > 8192) {
    throw new ApiError(413, 'VALIDATION_ERROR', '请求过大');
  }
  // Bound streamed bodies too, including requests without Content-Length.
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'VALIDATION_ERROR', '缺少 JSON 请求体');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > 8192) {
      await reader.cancel();
      throw new ApiError(413, 'VALIDATION_ERROR', '请求过大');
    }
    chunks.push(part.value);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', 'JSON 请求体无效');
  }
}

export function text(value: unknown, name: string, max = 256) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${name} 无效`);
  }
  return value;
}

export function fields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new ApiError(400, 'VALIDATION_ERROR', '请求含未知字段');
  }
}
