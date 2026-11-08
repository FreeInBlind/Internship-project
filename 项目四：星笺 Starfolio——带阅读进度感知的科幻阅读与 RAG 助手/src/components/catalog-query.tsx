'use client';

import { useState } from 'react';
import Link from 'next/link';
import { readerUrl } from '@/lib/reader-state';

type CatalogItem = {
  issueWorkKey: string; workKey: string; title: string; author: string | null;
  translator: string | null; issueTitle: string; publishedMonth: string | null;
  coverage: string; contentVersion: string;
};

export function CatalogQuery() {
  const [query, setQuery] = useState('');
  const [month, setMonth] = useState('');
  const [author, setAuthor] = useState('');
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setMessage('正在查询目录…');
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (month) params.set('month', month);
      if (author.trim()) params.set('author', author.trim());
      const response = await fetch(`/api/v1/catalog?${params}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.items)) throw new Error(data?.error?.message || '目录查询失败，请重试。');
      setItems(data.items);
      setMessage(data.items.length ? `找到 ${data.count} 个刊载部分${data.truncated ? '，结果已达到显示上限' : ''}。` : '没有符合条件的已收录刊载部分。');
    } catch (error) {
      setItems(null); setMessage(error instanceof Error ? error.message : '目录查询失败，请重试。');
    } finally { setBusy(false); }
  }

  return <section className="rag-panel" aria-labelledby="catalog-query-title">
    <h2 id="catalog-query-title">目录查询</h2>
    <form onSubmit={submit}>
      <label className="field-label">标题或署名<input value={query} maxLength={120} onChange={event => setQuery(event.target.value)} placeholder="标题或原始署名" /></label>
      <label className="field-label">作者原署名<input value={author} maxLength={120} onChange={event => setAuthor(event.target.value)} placeholder="按刊载单元署名筛选" /></label>
      <label className="field-label">刊期<input type="month" value={month} onChange={event => setMonth(event.target.value)} /></label>
      <button type="submit" className="primary-button" disabled={busy}>{busy ? '查询中…' : '查询目录'}</button>
    </form>
    {message && <p className="muted" role={items === null && !busy ? 'alert' : 'status'}>{message}</p>}
    {items && items.length > 0 && <div className="rag-sources">{items.map(item => <article key={`${item.issueWorkKey}:${item.contentVersion}`}>
      <h3>{item.title}</h3><p className="muted">{item.issueTitle}{item.publishedMonth ? ` · ${item.publishedMonth}` : ''}</p>
      <p className="muted">{item.author || '署名未记录'}{item.translator ? ` / ${item.translator} 译` : ''} · {item.coverage === 'opening_excerpt' ? '仅开篇摘录' : '本期刊载部分'}</p>
      <Link className="quiet-button" href={readerUrl(item.issueWorkKey, item.contentVersion)}>打开正文</Link>
    </article>)}</div>}
  </section>;
}
