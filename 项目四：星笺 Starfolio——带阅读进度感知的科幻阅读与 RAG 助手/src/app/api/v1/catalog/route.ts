import { api, json } from '@/lib/api';
import { searchLibrary } from '@/db/reading';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = api(async (request) => {
  const params = new URL(request.url).searchParams;
  const allowed = new Set(['q', 'month', 'author']);
  if ([...params.keys()].some(key => !allowed.has(key))
    || ['q', 'month', 'author'].some(key => params.getAll(key).length > 1)) {
    return Response.json({ error: { code: 'VALIDATION_ERROR', message: '查询参数无效' } }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const q = params.get('q')?.trim() || undefined;
  const month = params.get('month')?.trim() || undefined;
  const author = params.get('author')?.trim() || undefined;
  if ((q && q.length > 120) || (month && !/^\d{4}-\d{2}$/.test(month)) || (author && author.length > 120)) {
    return Response.json({ error: { code: 'VALIDATION_ERROR', message: '查询条件无效' } }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const items = await searchLibrary({ query: q, issueMonth: month, author, limit: 100 });
  return json({ items, count: items.length, truncated: items.length === 100, message: '按数据库中的刊期、标题与原始署名筛选；作者别名未做推断。' });
});
