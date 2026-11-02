export { requireSession as getServerSideProps } from '../lib/requireSession';
import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import Button from '../components/Button';
import PageHead from '../components/PageHead';
import { useLanguage } from '../components/LanguageProvider';

const COPY = {
  zh: { refresh: '刷新列表', listHint: '按首次保存时间倒序排列；点击标题打开并继续编辑。', updated: '最近修改', paginationHint: '本页没有仍在有效期内的报告，可继续加载更早的记录。', deleted: '报告已删除或已不存在。', title: '历史记录', body: '只有主动保存的报告才会出现在这里。每份报告自首次保存起保留 14 天，修改不会延长到期时间。', loading: '正在载入历史记录…', empty: '还没有保存的报告', emptyBody: '分析不会自动保存。请在报告页点击保存；临时报告离开或刷新后无法恢复。', error: '历史记录加载失败，请重试。', retry: '重新加载', more: '加载更多', expiry: '到期', created: '保存', workspace: '进入工作台', session: '登录状态已失效，请重新登录后查看报告。', login: '重新登录', remove: '删除', confirm: '确定永久删除这份报告吗？此操作无法撤销。', deleting: '正在删除…', deleteError: '删除结果未确认，请重新加载历史记录核对。不会自动重试删除。' },
  en: { refresh: 'Refresh list', listHint: 'Newest first by initial save. Open a title to review and continue editing.', updated: 'Last edited', paginationHint: 'No active reports remain on this page. Load more to check earlier records.', deleted: 'The report was deleted or is already unavailable.', title: 'History', body: 'Only reports you explicitly save appear here. Reports expire 14 days after the first save; editing does not extend expiry.', loading: 'Loading history…', empty: 'No saved reports yet', emptyBody: 'Analysis is not saved automatically. Click Save on the report page. Temporary reports cannot be recovered after leaving or refreshing.', error: 'History could not be loaded. Please try again.', retry: 'Reload history', more: 'Load more', expiry: 'Expires', created: 'Saved', workspace: 'Open workspace', session: 'Your session has expired. Sign in again to view reports.', login: 'Sign in again', remove: 'Delete', confirm: 'Permanently delete this report? This cannot be undone.', deleting: 'Deleting…', deleteError: 'The delete result is unconfirmed. Reload history to check. Deletion will not be retried automatically.' },
};
const options = { cache: 'no-store', credentials: 'same-origin', redirect: 'error' };
function validItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)
    || typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(item.id)
    || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 200
    || typeof item.jobTitle !== 'string' || item.jobTitle.length > 200
    || !['en', 'zh'].includes(item.reportLanguage)) return false;
  return ['createdAt', 'updatedAt', 'expiresAt'].every((key) => typeof item[key] === 'string' && Number.isFinite(Date.parse(item[key])));
}
function activeItem(item) { return validItem(item) && Date.parse(item.expiresAt) > Date.now(); }

export default function HistoryPage() {
  const { language } = useLanguage();
  const copy = COPY[language] || COPY.en;
  const { data: session, status } = useSession();
  const owner = status === 'authenticated' && typeof session?.user?.id === 'string' ? session.user.id : null;
  const scope = `${status}:${owner || ''}`;
  const live = useRef({ scope, epoch: 0 });
  if (live.current.scope !== scope) live.current = { scope, epoch: live.current.epoch + 1 };
  const [state, setState] = useState({ scope: null, items: [], cursor: null, loading: true, error: false, expired: false, deleting: null, uncertain: [] });
  const request = useRef(false);
  const visible = state.scope === scope && owner && !state.expired;
  const items = visible ? state.items.filter(activeItem) : [];
  const loading = status === 'loading' || (owner && (!visible || state.loading) && !state.expired);
  const sessionExpired = status !== 'loading' && (!owner || (state.scope === scope && state.expired));

  const load = async (cursor = null) => {
    if (!owner || request.current || (state.scope === scope && state.expired)) return;
    const epoch = live.current.epoch;
    request.current = true;
    setState((old) => ({ ...(cursor && old.scope === scope ? old : { items: [], cursor: null, uncertain: [] }), scope, loading: true, error: false, expired: false, deleting: null, deleteError: false }));
    const current = () => live.current.scope === scope && live.current.epoch === epoch;
    try {
      const response = await fetch(`/api/reports?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, options);
      if (!current()) return;
      if (response.status === 401) { live.current.epoch += 1; setState({ scope, items: [], cursor: null, expired: true, loading: false }); return; }
      const payload = await response.json();
      if (!current()) return;
      if (!response.ok || !payload || typeof payload !== 'object' || payload.ok !== true || !Array.isArray(payload.items)
        || !(payload.nextCursor === null || (typeof payload.nextCursor === 'string' && payload.nextCursor.length > 0))
        || !payload.items.every(validItem)) throw new Error('LIST_FAILED');
      setState((old) => ({ ...old, items: [...new Map([...(cursor ? old.items : []), ...payload.items.filter(activeItem)].map((item) => [item.id, item])).values()], cursor: payload.nextCursor, loading: false, error: false, deleteError: false, uncertain: cursor ? old.uncertain : [] }));
    } catch { if (current()) setState((old) => ({ ...old, loading: false, error: true })); }
    finally { if (current()) request.current = false; }
  };

  useEffect(() => {
    request.current = false;
    setState({ scope, items: [], cursor: null, loading: Boolean(owner), error: false, expired: false, deleting: null, uncertain: [] });
    if (owner) load();
    return () => { live.current.epoch += 1; request.current = false; };
    // An owner change discards every page and every pending result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  useEffect(() => {
    if (!visible) return undefined;
    const clearExpired = () => setState((old) => old.scope === scope ? { ...old, items: old.items.filter(activeItem) } : old);
    const next = state.items.reduce((time, item) => Math.min(time, Date.parse(item.expiresAt)), Infinity);
    const timer = Number.isFinite(next) ? window.setTimeout(clearExpired, Math.min(Math.max(0, next - Date.now() + 1), 2147483647)) : null;
    window.addEventListener('focus', clearExpired);
    document.addEventListener('visibilitychange', clearExpired);
    return () => { if (timer !== null) window.clearTimeout(timer); window.removeEventListener('focus', clearExpired); document.removeEventListener('visibilitychange', clearExpired); };
  }, [scope, state.items, visible]);

  const remove = async (id) => {
    if (!visible || !state.items.some((item) => item.id === id && activeItem(item)) || state.loading || request.current || state.deleting || state.uncertain?.includes(id) || !window.confirm(copy.confirm)) return;
    const epoch = live.current.epoch;
    request.current = true;
    const current = () => live.current.scope === scope && live.current.epoch === epoch;
    setState((old) => ({ ...old, deleting: id, deleteError: false }));
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(id)}`, { ...options, method: 'DELETE' });
      if (!current()) return;
      if (response.status === 401) { live.current.epoch += 1; setState({ scope, items: [], cursor: null, expired: true, loading: false }); return; }
      if (response.status !== 204 && response.status !== 404) throw new Error('DELETE_FAILED');
      setState((old) => ({ ...old, items: old.items.filter((item) => item.id !== id), deleting: null, notice: 'deleted' }));
    } catch { if (current()) setState((old) => ({ ...old, deleting: null, deleteError: true, uncertain: [...(old.uncertain || []), id] })); }
    finally { if (current()) request.current = false; }
  };
  const date = (value) => new Date(value).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US');
  return <><PageHead page="history" /><div className="mx-auto max-w-3xl space-y-8 [overflow-wrap:anywhere]">
    <header><p className="text-xs font-bold tracking-[0.18em] text-orange">{copy.title}</p><h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">{copy.title}</h1><p className="mt-4 leading-8 text-ink/65">{copy.body}</p><p className="mt-3 text-sm leading-6 text-ink/65">{copy.listHint}</p>{visible && <button type="button" className="mt-5 min-h-11 rounded-lg border border-ink/20 px-4 py-2 font-semibold disabled:opacity-50" disabled={state.loading || Boolean(state.deleting)} onClick={() => load()}>{copy.refresh}</button>}</header>
    {sessionExpired ? <p role="alert">{copy.session} <Link href="/login" className="underline">{copy.login}</Link></p> : <>
      {loading && <p role="status">{copy.loading}</p>}
      {visible && state.notice && <p role="status" className="rounded-lg bg-mint p-4">{copy[state.notice]}</p>}
      {visible && !state.loading && !state.error && items.length === 0 && state.cursor && <p className="rounded-lg border border-ink/10 p-5 leading-7">{copy.paginationHint}</p>}
      {visible && state.error && <div role="alert"><p>{copy.error}</p><button type="button" className="min-h-11 rounded border border-ink/20 px-4 py-2 underline disabled:opacity-50" disabled={state.loading} onClick={() => load(state.cursor)}>{copy.retry}</button></div>}
      {visible && !state.loading && !state.error && items.length === 0 && !state.cursor && <section className="rounded-lg border border-ink/10 bg-mint p-6"><h2 className="text-2xl font-bold">{copy.empty}</h2><p className="mt-4 leading-7">{copy.emptyBody}</p></section>}
      {items.length > 0 && <ul aria-label={copy.title} className="space-y-4">{items.map((item) => <li key={item.id} className="rounded-lg border border-ink/15 p-5"><h2 className="text-xl font-bold"><Link href={`/feedback/${encodeURIComponent(item.id)}`} className="underline">{item.title}</Link></h2><p className="mt-2">{item.jobTitle} · {item.reportLanguage === 'zh' ? '中文' : 'English'}</p><p className="mt-2 text-sm text-ink/65">{copy.created}: <time dateTime={item.createdAt}>{date(item.createdAt)}</time></p><p className="mt-1 text-sm text-ink/65">{copy.updated}: <time dateTime={item.updatedAt}>{date(item.updatedAt)}</time></p><p className="mt-1 text-sm text-ink/65">{copy.expiry}: <time dateTime={item.expiresAt}>{date(item.expiresAt)}</time></p><button type="button" className="mt-3 min-h-11 rounded border border-ink/20 px-4 py-2 underline disabled:opacity-50" disabled={state.loading || Boolean(state.deleting) || state.uncertain?.includes(item.id)} onClick={() => remove(item.id)}>{state.deleting === item.id ? copy.deleting : copy.remove}</button></li>)}</ul>}
      {visible && state.deleteError && <div role="alert"><p>{copy.deleteError}</p><button type="button" className="min-h-11 rounded-lg border border-ink/20 px-4 py-2 underline disabled:opacity-50" disabled={state.loading || Boolean(state.deleting)} onClick={() => load()}>{copy.retry}</button></div>}
      {visible && state.cursor && !state.error && <button type="button" className="min-h-11 rounded-lg border border-ink/20 px-5 py-3 font-semibold disabled:opacity-50" disabled={state.loading || Boolean(state.deleting)} onClick={() => load(state.cursor)}>{copy.more}</button>}
    </>}
    <Button href="/upload">{copy.workspace}</Button>
  </div></>;
}
