import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';

import { getReadingContent, getRelatedIssueWorks, readingHref } from '@/db/reading';
import { buildPdfPageNavigation } from '@/lib/reader-pages';
import { ReaderShell } from '@/components/reader-shell';

export const metadata: Metadata = {
  title: '阅读 · 星笺 Starfolio',
  robots: { index: false, follow: false },
};

export default async function ReadingPage({ params, searchParams }: {
  params: Promise<{ issueWorkKey: string }>;
  searchParams: Promise<{ v?: string | string[] }>;
}) {
  await connection();
  const { issueWorkKey } = await params;
  const { v } = await searchParams;
  let content: Awaited<ReturnType<typeof getReadingContent>>;
  try {
    content = await getReadingContent(issueWorkKey);
  } catch {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold">正文暂时无法加载</h1>
        <p role="alert" className="mt-4 text-[var(--muted)]">请稍后刷新页面重试。</p>
        <Link href="/" className="mt-6 inline-block text-[var(--accent)] underline">返回书库</Link>
      </main>
    );
  }
  if (!content) notFound();
  const { issueWork, issueTitle, review, blocks } = content;
  const titleRoot = issueWork.titleAsPrinted.replace(/（[上下]）$/, '');
  const relatedParts = /（[上下]）$/.test(issueWork.titleAsPrinted)
    ? await getRelatedIssueWorks({ issueWorkKey, workKey: issueWork.workKey, titleRoot })
    : [];
  if (v !== undefined && v !== issueWork.contentVersion) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold">内容版本已变化</h1>
        <p className="mt-4 leading-7 text-[var(--muted)]">此链接与当前内容版本不一致，原段落需要重新定位。</p>
        <Link href={readingHref(issueWorkKey, issueWork.contentVersion)} className="mt-6 inline-block text-[var(--accent)] underline">打开当前版本，从头阅读</Link>
      </main>
    );
  }
  const sampled = review.mode === 'personal_spot_check' && review.result === 'passed';
  const bodyCount = blocks.filter((block) => block.kind !== 'note').length;
  const noteCount = blocks.length - bodyCount;
  const pages = buildPdfPageNavigation(blocks);
  return (
    <ReaderShell key={`${issueWorkKey}:${issueWork.contentVersion}`} workKey={issueWork.workKey} issueWorkKey={issueWorkKey} contentVersion={issueWork.contentVersion}
      anchors={blocks.map(block => ({ blockKey: block.blockKey, order: block.order, label: block.text.slice(0, 54), heading: block.kind === 'heading' }))}
      pages={pages}>
        <article id="top" className="min-w-0" aria-labelledby="work-title" data-content-version={issueWork.contentVersion}>
          <p className="text-sm text-[var(--muted)]">{issueTitle}</p>
          <h1 id="work-title" className="mt-4 text-3xl font-semibold sm:text-4xl">{issueWork.titleAsPrinted}</h1>
          {issueWork.originalTitleAsPrinted && <p className="mt-2 text-[var(--muted)]">{issueWork.originalTitleAsPrinted}</p>}
          <p className="mt-5 text-sm leading-7 text-[var(--muted)]">
            {issueWork.authorAsPrinted && <span>{issueWork.authorAsPrinted} 著</span>}
            {issueWork.translatorAsPrinted && <span className="ml-3">{issueWork.translatorAsPrinted} 译</span>}
          </p>
          <p className="mt-2 text-xs leading-6 text-[var(--muted)]">
            {bodyCount} 段正文 · {noteCount} 条译注 · {issueWork.coverage === 'complete_issue_work' ? '本期刊载部分完整' : '仅收录开篇摘录 · opening_excerpt'}
          </p>
          {relatedParts.length > 1 && <nav aria-label="同名上下篇" className="my-5 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {relatedParts.map((part) => <Link key={part.issueWorkKey} href={readingHref(part.issueWorkKey, issueWorkKey === part.issueWorkKey ? issueWork.contentVersion : part.contentVersion)}
              aria-current={part.issueWorkKey === issueWorkKey ? 'page' : undefined}
              className={part.issueWorkKey === issueWorkKey ? 'font-semibold text-[var(--accent)]' : 'text-[var(--muted)] underline'}>
              {part.title} · {part.publishedMonth ?? '刊期未标'} · {part.coverage === 'opening_excerpt' ? '开篇摘录' : '本期完整'}
            </Link>)}
          </nav>}
          <div className="my-8 border-l-2 border-[var(--warm)] bg-white/50 px-4 py-3 text-sm leading-7 text-[var(--muted)]">
            {sampled ? '已按个人项目片段抽样标准接受所收录文本；不代表全文逐字校勘。' : review.project_acceptance === 'user_waived_sampling' ? '本内容经用户授权免抽样接入，尚未人工核对，可能存在识别错误。' : '本内容仍待人工抽样核对。'}
          </div>
          {blocks.length === 0 ? <p>正文尚未导入。</p> : (
            <div className="reader-content">
              {blocks.map((block) => {
                const isNote = block.kind === 'note';
                return (
                  <section id={block.blockKey} key={block.blockKey} className={`reader-block${isNote ? ' reader-note' : ''}`} data-kind={block.kind} data-reader-block data-order={block.order}>
                    {isNote && <p className="mb-2 font-sans text-xs font-medium text-[var(--accent)]">译注</p>}
                    {block.kind === 'heading' ? <h2 className="reader-text text-2xl font-semibold">{block.text}</h2> : <p className="reader-text">{block.text}</p>}
                  </section>
                );
              })}
            </div>
          )}
          <footer className="mt-12 border-t border-[var(--line)] pt-6 text-sm text-[var(--muted)]">
            <p>{issueWork.coverage === 'complete_issue_work' ? '本期刊载部分结束' : '当前摘录结束；此版本仅收录开篇片段'}</p>
            <Link href="/" className="mt-4 inline-block text-[var(--accent)] underline">返回书库</Link>
          </footer>
        </article>
    </ReaderShell>
  );
}
