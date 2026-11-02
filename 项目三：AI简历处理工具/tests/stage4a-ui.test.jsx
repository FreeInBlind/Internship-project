vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated', data: { user: { id: 'fixture-owner' } } }) }));
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UploadPage from '../pages/upload';
import FeedbackPage from '../pages/feedback/[id]';
import { createBrowserOcr } from '../lib/browserOcr';
import { reportToMarkdown } from '../lib/reportSchema';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/router', () => ({ useRouter: () => ({ push, isReady: true, query: { id: 'draft' } }) }));
vi.mock('../lib/requireSession', () => ({ requireSession: vi.fn() }));
vi.mock('../components/PageHead', () => ({ default: () => null }));
// Retained analysis behavior is exercised only with an explicit offline availability mock.
vi.mock('../lib/aiAvailability', () => ({ officialAiAvailable: () => true }));
vi.mock('../components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'zh', t: { feedbackTitle: '分析报告', officialAi: '官方 AI', officialAiPaused: '官方 AI 暂不开放', officialAiUnavailable: '暂不支持', customAiSettings: '独立配置自定义 AI' } }) }));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ GlobalWorkerOptions: {} }));
vi.mock('../lib/browserOcr', async (importOriginal) => ({ ...await importOriginal(), createBrowserOcr: vi.fn() }));

const resumeText = '曾负责团队管理工作。';
const report = { schemaVersion: 1, reportLanguage: 'zh', overview: '项目经验较清晰', strengths: ['团队协作'], issues: [{ evidence: '负责团队管理', problem: '缺少成果依据', suggestion: '补充可核实的成果' }], roleFit: { matches: ['团队管理经验'], gaps: ['缺少工程实践'], limitations: ['未提供完整项目细节'] }, rewriteExamples: [{ original: '负责团队管理', suggested: '负责团队协作与任务分配', notes: '仅在事实属实时采用' }] };
const imageFile = { name: 'fictional-resume.png', size: 100, type: 'image/png', arrayBuffer: async () => new ArrayBuffer(1) };
function deferred() { let resolve; let reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }
function success(value = report) { return { ok: true, json: async () => ({ ok: true, report: value }) }; }
function chooseFile() { fireEvent.change(screen.getByLabelText(/选择文件/), { target: { files: [imageFile] } }); }
function analysisCalls(fetchMock) { return fetchMock.mock.calls.filter(([url]) => url === '/api/roast'); }
async function confirmText() {
  chooseFile();
  await screen.findByRole('textbox', { name: '待确认简历文本' });
  fireEvent.click(screen.getByRole('button', { name: '确认并提交文本' }));
  await screen.findByLabelText('目标岗位（必填）');
}
function fillDetails() {
  fireEvent.change(screen.getByLabelText('目标岗位（必填）'), { target: { value: '前端工程师' } });
  fireEvent.change(screen.getByLabelText('最高学历（必填）'), { target: { value: '不便提供' } });
}
function startAnalysis() { fireEvent.click(screen.getByRole('button', { name: '开始 AI 分析' })); }
function setupUpload(analyze = () => Promise.resolve(success())) {
  const fetchMock = vi.fn((url, options) => {
    if (url === '/api/upload') return Promise.resolve({ ok: true, json: async () => ({ extraction: { text: JSON.parse(options.body).text } }) });
    if (url === '/api/roast') return analyze(options);
    throw new Error('Unexpected request');
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<UploadPage />);
  return fetchMock;
}
beforeEach(() => {
  push.mockResolvedValue(true);
  vi.mocked(createBrowserOcr).mockReturnValue({ recognize: vi.fn().mockResolvedValue({ text: resumeText }), cancel: vi.fn() });
  delete window.__resumeReportDraft;
});
afterEach(() => { cleanup(); delete window.__resumeReportDraft; vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('stage 4A explicit analysis flow (DOM/mocked APIs)', () => {
  it('requires job title and education without sending an analysis request', async () => {
    const fetchMock = setupUpload();
    await confirmText();
    startAnalysis();
    expect(screen.getByText(/请填写岗位和最高学历/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('目标岗位（必填）'), { target: { value: '前端工程师' } });
    startAnalysis();
    expect(analysisCalls(fetchMock)).toHaveLength(0);
    expect(push).not.toHaveBeenCalled();
  });

  it('sends confirmed text and complete job fields once, shows loading, and hands off a validated report', async () => {
    const pending = deferred();
    const fetchMock = setupUpload(() => pending.promise);
    await confirmText();
    fillDetails();
    fireEvent.change(screen.getByLabelText('职位描述（可选）'), { target: { value: 'React 与团队协作' } });
    fireEvent.change(screen.getByLabelText('薪资信息（可选）'), { target: { value: '面议' } });
    expect(analysisCalls(fetchMock)).toHaveLength(0);
    startAnalysis();
    const button = screen.getByRole('button', { name: '开始 AI 分析' });
    expect(button).toBeDisabled();
    expect(screen.getByText('正在分析…')).toBeInTheDocument();
    fireEvent.click(button);
    expect(analysisCalls(fetchMock)).toHaveLength(1);
    const [, options] = analysisCalls(fetchMock)[0];
    expect(options).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' } });
    expect(JSON.parse(options.body)).toEqual({ text: resumeText, jobTitle: '前端工程师', education: '不便提供', optionalJd: 'React 与团队协作', salary: '面议', reportLanguage: 'zh', requestId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i) });
    await act(async () => pending.resolve(success()));
    expect(window.__resumeReportDraft).toEqual({ report, markdown: reportToMarkdown(report), ownerId: 'fixture-owner', input: { confirmedResumeText: resumeText, jobTitle: '前端工程师', education: '不便提供', optionalJd: 'React 与团队协作', salary: '面议', reportLanguage: 'zh' } });
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/feedback/draft');
  });

  it('keeps confirmed text read-only rather than displaying unsent edits', async () => {
    setupUpload();
    await confirmText();
    expect(screen.getByRole('textbox', { name: '待确认简历文本' })).toHaveAttribute('readonly');
  });

  it.each([
    ['SERVICE_DISABLED', '分析服务尚未启用。'],
    ['SERVICE_UNAVAILABLE', '分析服务暂不可用，本次请求已结束。'],
    ['QUOTA_EXHAUSTED', '官方分析今日额度已用完。'],
    ['UPSTREAM_TIMEOUT', '分析请求超时，结果可能仍在处理中。请勿重复提交或刷新。'],
    ['INVALID_REPORT', '分析结果未通过校验，本次请求已结束。'],
    ['REQUEST_IN_PROGRESS', '分析失败，本次请求已结束。'],
  ])('shows a controlled %s error without automatically retrying', async (code, message) => {
    const fetchMock = setupUpload(() => Promise.resolve({ ok: false, json: async () => ({ error: { code, message: 'PRIVATE UPSTREAM DETAIL' } }) }));
    await confirmText(); fillDetails(); startAnalysis();
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始 AI 分析' })).toBeDisabled();
    expect(analysisCalls(fetchMock)).toHaveLength(1);
    expect(push).not.toHaveBeenCalled();
    expect(window.__resumeReportDraft).toBeUndefined();
    expect(screen.queryByText(/PRIVATE UPSTREAM DETAIL/)).not.toBeInTheDocument();
  });

  it.each([
    ['schema', { ...report, strengths: null }],
    ['language', { ...report, reportLanguage: 'en' }],
    ['citation', { ...report, issues: [{ ...report.issues[0], evidence: '未出现的虚构经历' }] }],
  ])('rejects a successful HTTP response with invalid %s', async (_kind, invalidReport) => {
    const fetchMock = setupUpload(() => Promise.resolve(success(invalidReport)));
    await confirmText(); fillDetails(); startAnalysis();
    expect(await screen.findByText('分析结果未通过内容校验，本次请求已结束。')).toBeInTheDocument();
    expect(analysisCalls(fetchMock)).toHaveLength(1);
    expect(push).not.toHaveBeenCalled();
    expect(window.__resumeReportDraft).toBeUndefined();
  });

  it('does not resubmit an uncertain official request, even if the disabled DOM state is bypassed', async () => {
    const fetchMock = setupUpload(() => Promise.resolve({ ok: false, json: async () => ({ error: { code: 'UPSTREAM_TIMEOUT' } }) }));
    await confirmText(); fillDetails(); startAnalysis();
    await screen.findByText(/分析请求超时/);
    const button = screen.getByRole('button', { name: '开始 AI 分析' });
    expect(button).toBeDisabled();
    button.disabled = false;
    fireEvent.click(button);
    expect(analysisCalls(fetchMock)).toHaveLength(1);
    expect(push).not.toHaveBeenCalled();
  });

  it.each(['reset', 'replacement', 'unmount'])('ignores a late analysis report after %s', async (action) => {
    const pending = deferred();
    setupUpload(() => pending.promise);
    await confirmText(); fillDetails(); startAnalysis();
    if (action === 'reset') fireEvent.click(screen.getByRole('button', { name: '重新选择文件' }));
    if (action === 'replacement') { chooseFile(); await waitFor(() => expect(screen.queryByLabelText('目标岗位（必填）')).not.toBeInTheDocument()); }
    if (action === 'unmount') cleanup();
    await act(async () => pending.resolve(success()));
    expect(push).not.toHaveBeenCalled();
    expect(window.__resumeReportDraft).toBeUndefined();
  });

  it('does not show an old rejection on a replacement file', async () => {
    const pending = deferred();
    setupUpload(() => pending.promise);
    await confirmText(); fillDetails(); startAnalysis();
    chooseFile();
    await waitFor(() => expect(screen.queryByLabelText('目标岗位（必填）')).not.toBeInTheDocument());
    await act(async () => pending.reject(new Error('old request failed')));
    fireEvent.click(screen.getByRole('button', { name: '确认并提交文本' }));
    await screen.findByLabelText('目标岗位（必填）');
    expect(screen.queryByText('old request failed')).not.toBeInTheDocument();
  });

  it('starts a new request identifier when replacing a previously analyzed file', async () => {
    const fetchMock = setupUpload(() => Promise.resolve({ ok: false, json: async () => ({ error: { code: 'QUOTA_EXHAUSTED' } }) }));
    await confirmText(); fillDetails(); startAnalysis();
    await screen.findByText('官方分析今日额度已用完。');
    const firstId = JSON.parse(analysisCalls(fetchMock)[0][1].body).requestId;
    await confirmText(); fillDetails(); startAnalysis();
    await screen.findByText('官方分析今日额度已用完。');
    expect(JSON.parse(analysisCalls(fetchMock)[1][1].body).requestId).not.toBe(firstId);
  });
});

describe('stage 4A memory-only feedback (DOM)', () => {
  it('displays structured sections, consumes the handoff, and sanitizes Markdown edits without saving', () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    window.__resumeReportDraft = { report, markdown: reportToMarkdown(report) };
    render(<FeedbackPage />);
    for (const heading of ['结构化报告', '整体评价', '优点', '问题及修改建议', '目标岗位适配', '原句改写示例']) expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.getAllByText(report.overview)).toHaveLength(2);
    expect(screen.getByText('原文：负责团队管理')).toBeInTheDocument();
    expect(screen.getByText('原句：负责团队管理')).toBeInTheDocument();
    expect(screen.getByText(/临时分析结果；仅主动保存后才会出现在历史记录/)).toBeInTheDocument();
    const editor = screen.getByLabelText('编辑 Markdown');
    expect(editor).toHaveValue(reportToMarkdown(report));
    fireEvent.change(editor, { target: { value: '<b>编辑</b> ![图](https://example.test/x.png) [危险](javascript:bad) [安全](https://example.test)' } });
    expect(editor).toHaveValue('编辑 图 危险 [安全](https://example.test)');
    expect(window.__resumeReportDraft).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
  });

  it('shows the empty rewrite state and loses the unsaved draft on remount', () => {
    window.__resumeReportDraft = { report: { ...report, rewriteExamples: [] }, markdown: '草稿' };
    const view = render(<FeedbackPage />);
    expect(screen.getByText('没有适合的原句可改写。')).toBeInTheDocument();
    view.unmount();
    render(<FeedbackPage />);
    expect(screen.getByRole('status')).toHaveTextContent('当前没有内存中的报告草稿');
    expect(screen.queryByLabelText('编辑 Markdown')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '结构化报告' })).not.toBeInTheDocument();
  });
});
