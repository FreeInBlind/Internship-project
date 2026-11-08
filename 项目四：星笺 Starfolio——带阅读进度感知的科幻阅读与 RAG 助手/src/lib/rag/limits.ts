import 'server-only';

import { ApiError } from '@/lib/api';
const windows = new Map<string, { start: number; count: number; active: number }>();

export function acquireRag(userId: string) {
  const now = Date.now();
  for (const [id, window] of windows) if (now - window.start >= 60_000 && window.active === 0) windows.delete(id);
  const window = windows.get(userId) ?? { start: now, count: 0, active: 0 };
  if (now - window.start >= 60_000) { window.start = now; window.count = 0; }
  if (window.count >= 12 || window.active >= 1) throw new ApiError(429, 'QUOTA_EXCEEDED', '提问过于频繁或上一请求仍在处理中，请稍后重试');
  window.count++; window.active++; windows.set(userId, window);
  let released = false;
  return () => { if (!released) { released = true; window.active--; } };
}
