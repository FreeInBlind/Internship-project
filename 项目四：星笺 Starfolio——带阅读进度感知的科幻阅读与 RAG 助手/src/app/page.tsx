import Link from 'next/link';
import { connection } from 'next/server';
import { getLibrary } from '@/db/reading';
import { AccountMenu } from '@/components/account-menu';
import { ContinueReading } from '@/components/continue-reading';
import { SemanticSearch } from '@/components/semantic-search';
import { CatalogQuery } from '@/components/catalog-query';

export default async function Home() {
  await connection();
  let library: Awaited<ReturnType<typeof getLibrary>> = [];
  let unavailable = false;
  try { library = await getLibrary(); } catch { unavailable = true; }
  return <div className="library-app">
    <aside className="library-rail" aria-label="主导航"><a className="rail-star" href="/" aria-label="星笺首页">✦</a><a className="rail-active" href="#library-title" aria-label="书库">▤</a><a href="/account" aria-label="账户">◉</a><span className="rail-bottom">星<br />笺</span></aside>
    <main className="library-main">
      <header className="library-header"><Link className="brand" href="/">星笺 <span>STARFOLIO</span></Link><AccountMenu /></header>
      <section className="library-hero"><div><p className="eyebrow">A LITTLE SPACE FOR OTHER WORLDS</p><h1>在别处的世界，<br />留下阅读的坐标。</h1><p className="muted">从一个故事出发，随时回到原文。<br />阅读进度与书签，留住每一次停顿。</p></div><div className="orbit-art" aria-hidden="true"><div className="orbit-ring" /><span>✦</span><small>STARFOLIO / 01</small></div></section>
      <section aria-labelledby="library-title" className="library-section"><div className="section-heading"><h2 id="library-title">我的书库 <span className="count-badge">{library.length}</span></h2><span className="muted small">真实正文 · 可溯来源</span></div>
        <p className="library-tip">游客记录保存在本机；登录后使用账户云端记录，暂不自动合并。</p>
        <CatalogQuery />
        <SemanticSearch />
        {unavailable ? <div role="alert" className="library-empty">书库暂时无法加载，请稍后<a href="/">刷新重试</a>。</div> : !library.length ? <p className="library-empty">尚无已导入作品。</p> : <div className="book-grid">{library.map((entry, index) => <article className="book-card" key={entry.issueWorkKey}>
          <div className={`book-spine spine-${index % 3}`} aria-hidden="true"><span>科幻世界<br />译文版</span><b>{String(index + 1).padStart(2, '0')}</b><span>✦</span></div>
          <div className="book-info"><p className="eyebrow">{entry.issueTitle}</p><h3>{entry.title}</h3><p className="book-byline">{entry.author && `${entry.author} 著`}{entry.translator && ` / ${entry.translator} 译`}</p><div className="book-tags"><span>{entry.coverage === 'complete_issue_work' ? '本期刊载部分完整' : '仅开篇摘录'}</span><span>{entry.blockCount} 块正文 / 译注</span></div>{entry.coverage === 'opening_excerpt' && <p className="excerpt-warning">opening_excerpt · 不代表完整下篇</p>}<ContinueReading workKey={entry.workKey} issueWorkKey={entry.issueWorkKey} contentVersion={entry.contentVersion} /></div>
        </article>)}</div>}
      </section>
      <footer className="library-footer">个人项目演示 · 已收录文本按个人项目抽样标准接受，不代表全文逐字校勘。连载的本期完整不等于整部作品完整。</footer>
    </main>
  </div>;
}
