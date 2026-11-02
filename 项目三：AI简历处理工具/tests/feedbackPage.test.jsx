import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FeedbackPage from '../pages/feedback/[id]';
import { REPORT_LIMITS, reportToMarkdown } from '../lib/reportSchema';
import { sanitizeMarkdown } from '../lib/markdownSafety';

const context = vi.hoisted(() => ({ router: { isReady: true, query: { id: 'draft' }, replace: vi.fn() }, language: 'zh', session: { status: 'authenticated', data: { user: { id: 'owner-a' } } } }));
vi.mock('next-auth/react', () => ({ useSession: () => context.session }));
vi.mock('next/router', () => ({ useRouter: () => context.router }));
vi.mock('../lib/requireSession', () => ({ requireSession: vi.fn() }));
vi.mock('../components/PageHead', () => ({ default: () => null }));
vi.mock('../components/LanguageProvider', () => ({ useLanguage: () => ({ language: context.language, t: { feedbackTitle: context.language === 'zh' ? '报告详情' : 'Report details' } }) }));
// Exercise the real Next Link click behavior without initiating jsdom navigation.
vi.mock('../components/Button', () => ({ default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a> }));

const report = {
  schemaVersion: 1, reportLanguage: 'zh', overview: '项目经验较清晰', strengths: ['团队协作'],
  issues: [{ evidence: '负责团队管理', problem: '缺少成果依据', suggestion: '补充可核实的成果' }],
  roleFit: { matches: ['团队管理经验'], gaps: ['缺少工程实践'], limitations: ['未提供完整项目细节'] },
  rewriteExamples: [{ original: '负责团队管理', suggested: '负责团队协作与任务分配', notes: '仅在事实属实时采用' }],
};
function handoff(value = report, markdown = reportToMarkdown(value)) {
  const draft = { report: value, markdown };
  window.__resumeReportDraft = draft;
  return draft;
}
function unloadCancelled() {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

beforeEach(() => {
  context.router = { isReady: true, query: { id: 'draft' }, replace: vi.fn() };
  context.session = { status: 'authenticated', data: { user: { id: 'owner-a' } } };
  context.language = 'zh';
  delete window.__resumeReportDraft;
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request'); }));
});
afterEach(() => { cleanup(); delete window.__resumeReportDraft; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('temporary feedback report page', () => {
  it('has an honest empty state and a workspace next step', () => {
    render(<FeedbackPage />);
    expect(screen.getByRole('status')).toHaveTextContent('未保存的报告无法恢复');
    expect(screen.getByRole('link', { name: '返回工作台' })).toHaveAttribute('href', '/upload');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '结构化报告' })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    null, [], {}, { report: null, markdown: '' },
    { report: { ...report, strengths: null }, markdown: '' },
    { report: { ...report, overview: {} }, markdown: '' },
    { report: { ...report, issues: [null] }, markdown: '' },
    { report: { ...report, roleFit: { matches: [] } }, markdown: '' },
    { report: { ...report, rewriteExamples: [{ original: 'x' }] }, markdown: '' },
    { report: { ...report, reportLanguage: 'fr' }, markdown: '' },
    { report, markdown: null }, { report, markdown: {} }, { report },
    { report, markdown: 'x'.repeat(REPORT_LIMITS.markdown + 1) },
  ])('rejects malformed handoff %# without rendering unsafe structures', (value) => {
    window.__resumeReportDraft = value;
    render(<FeedbackPage />);
    expect(screen.getByRole('status')).toHaveTextContent('当前没有内存中的报告草稿');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('waits for hydration and router readiness before consuming the draft', () => {
    const draft = handoff();
    const html = renderToString(<FeedbackPage />);
    expect(html).toContain('正在载入临时报告');
    expect(html).not.toContain('当前没有内存中的报告草稿');
    expect(window.__resumeReportDraft).toBe(draft);
    context.router = { isReady: false, query: {} };
    const view = render(<FeedbackPage />);
    expect(screen.getByRole('status')).toHaveTextContent('正在载入临时报告');
    expect(screen.getByRole('region')).toHaveAttribute('aria-busy', 'true');
    expect(window.__resumeReportDraft).toBe(draft);
    context.router = { isReady: true, query: { id: 'draft' } };
    view.rerender(<FeedbackPage />);
    expect(screen.getByRole('textbox', { name: '编辑 Markdown' })).toHaveValue(reportToMarkdown(report));
    expect(screen.getByRole('region', { name: '报告详情' })).toHaveAttribute('aria-busy', 'false');
    expect(window.__resumeReportDraft).toBeUndefined();
  });

  it.each(['another-id', undefined, ['draft']])('does not display or consume a draft on id %j', async (id) => {
    const draft = handoff();
    context.router.query = { id };
    fetch.mockResolvedValue({ ok: false, status: 404 });
    render(<FeedbackPage />);
    expect(window.__resumeReportDraft).toBe(draft);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    if (typeof id === 'string') expect(await screen.findByRole('alert')).toHaveTextContent('报告不存在、已删除或已到期');
    else expect(screen.getByRole('status')).toHaveTextContent('当前没有内存中的报告草稿');
  });

  it('survives StrictMode effect replay but does not survive an actual remount', () => {
    handoff();
    const view = render(<StrictMode><FeedbackPage /></StrictMode>);
    expect(screen.getAllByText(report.overview).length).toBeGreaterThan(0);
    expect(screen.getByRole('textbox', { name: '编辑 Markdown' })).toHaveValue(reportToMarkdown(report));
    expect(window.__resumeReportDraft).toBeUndefined();
    fireEvent.change(screen.getByRole('textbox', { name: '编辑 Markdown' }), { target: { value: '备注' } });
    view.rerender(<StrictMode><FeedbackPage /></StrictMode>);
    expect(screen.getByRole('textbox', { name: '编辑 Markdown' })).toHaveValue('备注');
    view.unmount();
    render(<StrictMode><FeedbackPage /></StrictMode>);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('未保存的报告无法恢复');
  });

  it('hides and clears the consumed report when Next reuses the page for another id', () => {
    handoff();
    const view = render(<FeedbackPage />);
    fireEvent.change(screen.getByRole('textbox', { name: '编辑 Markdown' }), { target: { value: 'edited' } });
    context.router = { isReady: true, query: { id: 'some-id' } };
    view.rerender(<FeedbackPage />);
    expect(screen.queryByText(report.overview)).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(unloadCancelled()).toBe(false);
    context.router = { isReady: true, query: { id: 'draft' } };
    view.rerender(<FeedbackPage />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it.each([['zh', 'en'], ['en', 'zh'], ['en', 'en']])('uses %s UI and %s section language without translating report text', (uiLanguage, reportLanguage) => {
    context.language = uiLanguage;
    handoff({ ...report, reportLanguage });
    const view = render(<FeedbackPage />);
    const chineseReport = reportLanguage === 'zh';
    expect(screen.getByRole('heading', { name: chineseReport ? '结构化报告' : 'Structured report' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: chineseReport ? '结构化报告' : 'Structured report' })).toHaveAttribute('lang', chineseReport ? 'zh-CN' : 'en');
    expect(screen.getByRole('textbox', { name: uiLanguage === 'zh' ? '编辑 Markdown' : 'Edit Markdown' })).toBeInTheDocument();
    expect(screen.getAllByText(report.overview).length).toBeGreaterThan(0);
    context.language = uiLanguage === 'zh' ? 'en' : 'zh';
    view.rerender(<FeedbackPage />);
    expect(screen.getByRole('heading', { name: chineseReport ? '整体评价' : 'Overall assessment' })).toBeInTheDocument();
    expect(screen.getAllByText(report.overview).length).toBeGreaterThan(0);
  });

  it('renders English empty state and report limitations without Chinese UI strings', () => {
    context.language = 'en';
    const view = render(<FeedbackPage />);
    expect(screen.getByRole('status')).toHaveTextContent('cannot be recovered');
    expect(screen.getByRole('link', { name: 'Back to workspace' })).toBeInTheDocument();
    view.unmount();
    handoff({ ...report, reportLanguage: 'en', strengths: [], issues: [], roleFit: { matches: [], gaps: [], limitations: [] }, rewriteExamples: [] });
    render(<FeedbackPage />);
    expect(screen.getByText('There are no suitable sentences to rewrite.')).toBeInTheDocument();
    expect(screen.getByText(/cannot guarantee an interview or job offer/)).toBeInTheDocument();
    expect(screen.getByText(/Do not invent experience/)).toBeInTheDocument();
    expect(screen.getByText('Analysis limitations: None provided')).toBeInTheDocument();
  });

  it('sanitizes incoming Markdown and edits, renders safe links without resources', () => {
    const unsafe = '<img src="https://tracking.test/x" onerror="bad()"><script>bad()</script> ![图](https://tracking.test/x) [危险](javascript:bad) [安全](https://example.test)';
    const source = { ...report, overview: '<img src="https://tracking.test/x">事实原文' };
    handoff(source, unsafe);
    const { container } = render(<FeedbackPage />);
    const editor = screen.getByRole('textbox', { name: '编辑 Markdown' });
    expect(editor).toHaveValue(sanitizeMarkdown(unsafe));
    expect(screen.getByText(source.overview)).toBeInTheDocument();
    fireEvent.change(editor, { target: { value: unsafe + '<b>备注</b>' } });
    expect(editor).toHaveValue(sanitizeMarkdown(unsafe + '<b>备注</b>'));
    expect(container.querySelector('img, script, iframe')).toBeNull();
    expect(screen.getByRole('link', { name: '安全' })).toHaveAttribute('href', 'https://example.test');
    expect(screen.getByRole('link', { name: '安全' })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(screen.getByText(source.overview)).toBeInTheDocument();
    expect(screen.getByText(/Markdown 修改不会同步/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('supports empty Markdown, enforces the character limit and exposes editor guidance', () => {
    handoff(report, '');
    render(<FeedbackPage />);
    const editor = screen.getByRole('textbox', { name: '编辑 Markdown' });
    expect(editor).toHaveValue('');
    expect(editor).toHaveAttribute('maxlength', String(REPORT_LIMITS.markdown));
    expect(editor).toHaveAccessibleDescription(/Markdown 修改不会同步/);
    fireEvent.change(editor, { target: { value: 'x'.repeat(REPORT_LIMITS.markdown + 100) } });
    expect(editor.value).toHaveLength(REPORT_LIMITS.markdown);
    expect(screen.getByText(`字符上限: ${REPORT_LIMITS.markdown} / ${REPORT_LIMITS.markdown}`)).toBeInTheDocument();
  });

  it('guards the initial unsaved draft even when edits are reverted and cleans up on unmount', () => {
    handoff(report, 'initial');
    const view = render(<StrictMode><FeedbackPage /></StrictMode>);
    const editor = screen.getByRole('textbox', { name: '编辑 Markdown' });
    expect(unloadCancelled()).toBe(true);
    fireEvent.change(editor, { target: { value: 'changed' } });
    expect(screen.getByRole('status')).toHaveTextContent('尚未保存');
    expect(unloadCancelled()).toBe(true);
    fireEvent.change(editor, { target: { value: 'initial' } });
    expect(unloadCancelled()).toBe(true);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.change(editor, { target: { value: 'changed' } });
    expect(unloadCancelled()).toBe(true);
    view.unmount();
    expect(unloadCancelled()).toBe(false);
  });

  it('confirms same-tab link exits without replacing Next navigation and removes the guard', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    handoff(report, 'initial');
    const view = render(<FeedbackPage />);
    fireEvent.change(screen.getByRole('textbox', { name: '编辑 Markdown' }), { target: { value: 'changed' } });
    const link = screen.getByRole('link', { name: '返回工作台' });
    const clicked = vi.fn((event) => event.preventDefault());
    link.addEventListener('click', clicked);
    expect(fireEvent.click(link)).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
    expect(clicked).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(link);
    expect(clicked).toHaveBeenCalledOnce();
    confirm.mockClear();
    fireEvent.click(link, { ctrlKey: true });
    expect(confirm).not.toHaveBeenCalled();
    view.unmount();
    const otherLink = document.createElement('a');
    otherLink.href = '/settings';
    otherLink.addEventListener('click', (event) => event.preventDefault());
    document.body.appendChild(otherLink);
    fireEvent.click(otherLink);
    expect(confirm).not.toHaveBeenCalled();
    otherLink.remove();
  });
});
