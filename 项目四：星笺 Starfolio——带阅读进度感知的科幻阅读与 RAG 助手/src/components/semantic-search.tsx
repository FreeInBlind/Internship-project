'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { readerRequest, readerUrl } from '@/lib/reader-state';
import { isRagSource, type RagCoverage, type RagSource } from '@/lib/rag-protocol';

export type SemanticSearchItem = {
  workKey: string;
  issueWorkKey: string;
  title: string;
  coverage: RagCoverage;
  contentVersion: string;
  source: RagSource;
  score?: number;
  matchReason?: string;
};

type SearchState = {
  context: string;
  query: string;
  status: 'idle' | 'loading' | 'completed' | 'error';
  items: SemanticSearchItem[];
  message: string;
};

function emptySearch(context: string): SearchState {
  return { context, query: '', status: 'idle', items: [], message: '' };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSearchItem(value: unknown): value is SemanticSearchItem {
  if (!object(value) || !isRagSource(value.source)) return false;
  return typeof value.workKey === 'string' && value.workKey.length > 0
    && typeof value.issueWorkKey === 'string' && value.issueWorkKey.length > 0
    && typeof value.title === 'string' && typeof value.contentVersion === 'string' && value.contentVersion.length > 0
    && (value.coverage === 'complete_issue_work' || value.coverage === 'opening_excerpt')
    && value.source.workId === value.workKey && value.source.issueWorkId === value.issueWorkKey
    && value.source.location.contentVersion === value.contentVersion
    && (value.score === undefined || typeof value.score === 'number' && Number.isFinite(value.score))
    && (value.matchReason === undefined || typeof value.matchReason === 'string');
}

export function SemanticSearch() {
  const { data: session, isPending, error: sessionError } = authClient.useSession();
  const authKey = !isPending && !sessionError && session ? `${session.user.id}:${session.session.id}` : null;
  const context = JSON.stringify([authKey, isPending, Boolean(sessionError)]);
  const latestContext = useRef(context);
  latestContext.current = context;
  const sequence = useRef(0);
  const active = useRef<AbortController | null>(null);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchState>(() => emptySearch(context));
  const visible = result.context === context ? result : emptySearch(context);
  const busy = visible.status === 'loading';
  const headingId = useId();
  const inputId = useId();

  useEffect(() => {
    sequence.current++;
    active.current?.abort();
    active.current = null;
    setResult(emptySearch(context));
    setQuery('');
    return () => { sequence.current++; active.current?.abort(); active.current = null; };
  }, [context]);

  function editQuery(next: string) {
    sequence.current++;
    active.current?.abort();
    active.current = null;
    setQuery(next);
    setResult(emptySearch(context));
  }

  async function search() {
    const submitted = query.trim();
    if (!authKey || busy || !submitted || submitted.length > 300) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const requestSequence = ++sequence.current;
    const requestContext = context;
    const current = () => sequence.current === requestSequence && latestContext.current === requestContext && !controller.signal.aborted;
    setResult({ ...emptySearch(requestContext), query: submitted, status: 'loading', message: '正在搜索已收录语料…' });
    try {
      const payload: unknown = await readerRequest('/api/v1/find', {
        method: 'POST', credentials: 'same-origin', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: submitted, rerank: false }),
      });
      if (!current()) return;
      if (!object(payload) || !Array.isArray(payload.items) || !payload.items.every(isSearchItem)
        || (payload.message !== undefined && typeof payload.message !== 'string')) throw new Error('搜索响应或来源信息无效，请重试。');
      const next: SearchState = {
        context: requestContext, query: submitted, items: payload.items, status: 'completed',
        message: typeof payload.message === 'string' ? payload.message
          : payload.items.length ? `找到 ${payload.items.length} 条匹配来源。` : '当前已收录语料中没有找到匹配内容，可以换一种描述。',
      };
      setResult(previous => current() ? next : previous);
    } catch (error) {
      if (current()) setResult(previous => current() ? { ...emptySearch(requestContext), query: submitted, status: 'error', message: error instanceof Error ? error.message : '搜索失败，请重试。' } : previous);
    } finally {
      if (sequence.current === requestSequence) active.current = null;
    }
  }

  return <section className="rag-panel" aria-labelledby={headingId}>
    <h2 id={headingId}>语义找书</h2>
    <p className="muted">搜索范围：全部已收录且可检索的语料，不受当前阅读进度限制，结果摘录可能剧透。仅开篇摘录的刊载部分不代表完整作品。此入口关闭重排。</p>
    {isPending ? <p className="muted">正在确认账户…</p>
      : sessionError ? <p role="alert">账户状态获取失败，请刷新后重试。</p>
      : !session ? <p className="muted">请先<a href="/account" onClick={event => {
        event.preventDefault();
        window.location.assign(`/account?returnTo=${encodeURIComponent(window.location.pathname + window.location.search + window.location.hash)}`);
      }}>登录 / 注册</a>，再用自然语言找书。</p> : null}
    <label className="field-label" htmlFor={inputId}>描述你想找的情节、主题或设定</label>
    <textarea id={inputId} rows={2} maxLength={300} value={query} disabled={!authKey} onChange={event => editQuery(event.target.value)} placeholder="例如：人与陌生生命建立共生关系" />
    <div className="rag-actions">
      <button type="button" className="primary-button" disabled={!authKey || busy || !query.trim()} onClick={() => { void search(); }}>{busy ? '正在搜索…' : '查找作品'}</button>
      {(busy || visible.status !== 'idle') && <button type="button" className="quiet-button" onClick={() => editQuery(query)}>{busy ? '停止搜索' : '清除结果'}</button>}
    </div>
    {visible.status !== 'idle' && <div className="rag-answer" aria-busy={busy}>
      <p><strong>本次搜索</strong> {visible.query}</p>
      <p role={visible.status === 'error' ? 'alert' : 'status'}>{visible.message}</p>
    </div>}
    {visible.items.length > 0 && <div className="rag-sources">
      {visible.items.map((item, index) => <article key={`${item.issueWorkKey}:${item.contentVersion}:${item.source.citationId}:${index}`}>
        <h3>{item.title}</h3>
        <p className="muted">{item.coverage === 'opening_excerpt' ? '仅开篇摘录（非完整刊载部分）' : '本期刊载部分已收录（不代表跨期作品完整）'} · {item.matchReason || '语义片段匹配'} · 来源 [{item.source.citationId}]</p>
        <p className="muted">PDF 第 {item.source.pdfPageStart + 1}{item.source.pdfPageEnd !== item.source.pdfPageStart ? `—${item.source.pdfPageEnd + 1}` : ''} 页
          {item.source.printedPageStart !== null && <> · 印刷页 {item.source.printedPageStart}{item.source.printedPageEnd !== null && item.source.printedPageEnd !== item.source.printedPageStart ? `—${item.source.printedPageEnd}` : ''}</>}
        </p>
        <details><summary>显示匹配摘录（可能包含剧情）</summary>
          <blockquote style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.source.excerpt}</blockquote>
        </details>
        <a className="quiet-button" href={readerUrl(item.issueWorkKey, item.contentVersion, item.source.location.paragraphKey)}>打开该版本原文</a>
      </article>)}
    </div>}
  </section>;
}
