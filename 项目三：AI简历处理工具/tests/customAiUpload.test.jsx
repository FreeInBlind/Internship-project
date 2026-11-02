vi.mock('next-auth/react', () => ({ useSession: () => ({ status: identity.status, data: identity.owner ? { user: { id: identity.owner } } : null }) }));
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UploadPage from '../pages/upload';
import { LanguageProvider } from '../components/LanguageProvider';
import { reportToMarkdown } from '../lib/reportSchema';
import { createBrowserOcr } from '../lib/browserOcr';

const { push, customAiState, availability, identity } = vi.hoisted(() => ({
  push: vi.fn(), customAiState: { config: null, revision: 0 }, availability: { official: false }, identity: { status: 'authenticated', owner: 'fixture-owner' },
}));
vi.mock('next/router', () => ({ useRouter: () => ({ push }) }));
vi.mock('../lib/requireSession', () => ({ requireSession: vi.fn() }));
vi.mock('../components/PageHead', () => ({ default: () => null }));
vi.mock('../components/CustomAiProvider', () => ({ useCustomAi: () => customAiState }));
vi.mock('../lib/aiAvailability', () => ({ officialAiAvailable: () => availability.official }));
vi.mock('../lib/browserOcr', async (importOriginal) => ({ ...await importOriginal(), createBrowserOcr: vi.fn() }));

const text = 'Led a team and delivered projects.';
const report = { schemaVersion: 1, reportLanguage: 'zh', overview: '经验清晰', strengths: ['团队协作'], issues: [{ evidence: 'Led a team', problem: '缺少成果', suggestion: '补充成果' }], roleFit: { matches: ['协作'], gaps: ['细节'], limitations: ['未提供更多信息'] }, rewriteExamples: [{ original: 'Led a team', suggested: 'Led a cross-functional team', notes: '仅在属实时采用' }] };
const file = { name: 'resume.txt', size: text.length, arrayBuffer: async () => new TextEncoder().encode(text).buffer };
function deferred() { let resolve; let reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }
function setup({ config = { baseUrl: 'https://ai.example/v1', apiKey: 'secret-key', model: 'model-x' }, analyze = () => Promise.resolve({ ok: true, json: async () => ({ ok: true, report }) }), official = false } = {}) {
  customAiState.config = config; customAiState.revision = 0; availability.official = official;
  const fetchMock = vi.fn((url, options) => {
    if (url === '/api/upload') return Promise.resolve({ ok: true, json: async () => ({ extraction: { text: JSON.parse(options.body).text } }) });
    if (url === '/api/custom-ai/analyze') return analyze(options);
    throw new Error(`Unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const view = render(<LanguageProvider><UploadPage /></LanguageProvider>);
  return { fetchMock, rerender: () => view.rerender(<LanguageProvider><UploadPage /></LanguageProvider>) };
}
async function confirmText() {
  fireEvent.change(screen.getByLabelText(/选择文件/), { target: { files: [file] } });
  await screen.findByRole('textbox', { name: '待确认简历文本' });
  fireEvent.click(screen.getByRole('button', { name: '确认并提交文本' }));
  await screen.findByLabelText('目标岗位（必填）');
  fireEvent.change(screen.getByLabelText('目标岗位（必填）'), { target: { value: 'Engineer' } });
  fireEvent.change(screen.getByLabelText('最高学历（必填）'), { target: { value: '本科' } });
}
const analyzeButton = () => screen.getByRole('button', { name: '使用个人 AI 分析' });
function calls(mock) { return mock.mock.calls.filter(([url]) => url === '/api/custom-ai/analyze'); }

beforeEach(() => {
  identity.status = 'authenticated'; identity.owner = 'fixture-owner';
  push.mockResolvedValue(true); delete window.__resumeReportDraft;
  vi.mocked(createBrowserOcr).mockReturnValue({ recognize: vi.fn(), cancel: vi.fn() });
});
afterEach(() => { cleanup(); delete window.__resumeReportDraft; vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('personal AI upload flow', () => {
  it('sends only confirmed text on explicit click and hands off a validated draft without exposing key', async () => {
    const { fetchMock } = setup({ official: false });
    await confirmText();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(analyzeButton()).toBeEnabled();
    fireEvent.click(analyzeButton());
    await waitFor(() => expect(push).toHaveBeenCalledWith('/feedback/draft'));
    const [, options] = calls(fetchMock)[0];
    const sent = JSON.parse(options.body);
    expect(sent).toMatchObject({ config: { baseUrl: 'https://ai.example/v1', apiKey: 'secret-key', model: 'model-x' }, input: { text, jobTitle: 'Engineer', education: '本科' }, requestId: expect.any(String) });
    expect(sent.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(window.__resumeReportDraft).toEqual({ report, markdown: reportToMarkdown(report), ownerId: 'fixture-owner', input: { confirmedResumeText: text, jobTitle: 'Engineer', education: '本科', optionalJd: '', salary: '', reportLanguage: 'zh' } });
    expect(JSON.stringify(window.__resumeReportDraft)).not.toContain('secret-key');
    expect(screen.getByText(/官方 AI 暂不开放/)).toBeInTheDocument();
  });

  it('uses an owner-scoped saved configuration reference without transmitting a key', async () => {
    const { fetchMock } = setup({ config: { source: 'saved', baseUrl: 'https://ai.example/v1', model: 'model-saved', configVersion: 'fixture-version', hasKey: true }, analyze: () => Promise.resolve({ ok: true, json: async () => ({ ok: true, report, config: { baseUrl: 'https://ai.example/v1', configVersion: 'fixture-version' }, effectiveModel: 'model-saved' }) }) });
    await confirmText();
    fireEvent.click(analyzeButton());
    await waitFor(() => expect(push).toHaveBeenCalledWith('/feedback/draft'));
    const sent = JSON.parse(calls(fetchMock)[0][1].body);
    expect(sent).toMatchObject({ source: 'saved', configVersion: 'fixture-version', model: 'model-saved', input: { text } });
    expect(sent).not.toHaveProperty('config');
    expect(JSON.stringify(sent)).not.toContain('apiKey');
    expect(window.__resumeReportDraft.input.confirmedResumeText).toBe(text);
    expect(JSON.stringify(window.__resumeReportDraft)).not.toContain('configVersion');
  });

  it.each(['version', 'url', 'model'])('rejects a saved response with a different %s', async (mismatch) => {
    const config = { source: 'saved', baseUrl: 'https://ai.example/v1', model: 'model-saved', configVersion: 'fixture-version', hasKey: true };
    setup({ config, analyze: () => Promise.resolve({ ok: true, json: async () => ({ ok: true, report, config: { baseUrl: mismatch === 'url' ? 'https://other.example/v1' : config.baseUrl, configVersion: mismatch === 'version' ? 'other-version' : config.configVersion }, effectiveModel: mismatch === 'model' ? 'other-model' : config.model }) }) });
    await confirmText();
    fireEvent.click(analyzeButton());
    await screen.findByText(/个人 AI 返回的报告未通过校验/);
    expect(push).not.toHaveBeenCalled();
    expect(window.__resumeReportDraft).toBeUndefined();
  });

  it('does not call personal or official analysis without personal configuration', async () => {
    const { fetchMock } = setup({ config: null, official: true });
    await confirmText();
    expect(analyzeButton()).toBeDisabled();
    expect(screen.getByText('尚未配置个人 AI，建议先配置后再开始。')).toBeInTheDocument();
    fireEvent.click(analyzeButton());
    expect(calls(fetchMock)).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('locks repeated clicks synchronously and consumes failed, timed-out, or invalid attempts', async () => {
    for (const response of [
      { ok: false, json: async () => ({ code: 'UPSTREAM_TIMEOUT' }) },
      { ok: true, json: async () => ({ ok: true, report: { ...report, overview: '' } }) },
    ]) {
      cleanup(); vi.clearAllMocks(); delete window.__resumeReportDraft;
      const pending = deferred();
      const { fetchMock } = setup({ analyze: () => pending.promise });
      await confirmText();
      fireEvent.click(analyzeButton()); fireEvent.click(analyzeButton());
      expect(calls(fetchMock)).toHaveLength(1);
      await act(async () => pending.resolve(response));
      expect(analyzeButton()).toBeDisabled();
      expect(calls(fetchMock)).toHaveLength(1);
      expect(window.__resumeReportDraft).toBeUndefined();
    }
  });

  it.each(['fixture-owner-b', null])('clears confirmed input and ignores a late result after owner becomes %s', async (owner) => {
    const pending = deferred();
    const { rerender } = setup({ analyze: () => pending.promise });
    await confirmText();
    fireEvent.click(analyzeButton());
    identity.owner = owner;
    identity.status = owner ? 'authenticated' : 'unauthenticated';
    rerender();
    expect(screen.queryByDisplayValue(text)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Engineer')).not.toBeInTheDocument();
    await act(async () => pending.resolve({ ok: true, json: async () => ({ ok: true, report }) }));
    expect(push).not.toHaveBeenCalled();
    expect(window.__resumeReportDraft).toBeUndefined();
  });

  it.each(['cancel', 'reset', 'replace', 'unmount', 'config', 'field'])('aborts or ignores a stale response after %s', async (action) => {
    const pending = deferred();
    const { fetchMock, rerender } = setup({ analyze: (options) => { window.requestSignal = options.signal; return pending.promise; } });
    await confirmText(); fireEvent.click(analyzeButton());
    const signal = window.requestSignal;
    if (action === 'cancel') fireEvent.click(screen.getByRole('button', { name: '取消个人 AI 分析' }));
    if (action === 'reset') fireEvent.click(screen.getByRole('button', { name: '重新选择文件' }));
    if (action === 'replace') fireEvent.change(screen.getByLabelText(/选择文件/), { target: { files: [file] } });
    if (action === 'unmount') cleanup();
    if (action === 'config') { customAiState.revision += 1; customAiState.config = { baseUrl: 'https://other.example', apiKey: 'new-key', model: 'new' }; rerender(); }
    if (action === 'field') fireEvent.change(screen.getByLabelText('目标岗位（必填）'), { target: { value: 'Designer' } });
    if (action === 'cancel' || action === 'reset' || action === 'replace' || action === 'unmount' || action === 'field') expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve({ ok: true, json: async () => ({ ok: true, report }) }));
    expect(push).not.toHaveBeenCalled(); expect(window.__resumeReportDraft).toBeUndefined();
    expect(calls(fetchMock)).toHaveLength(1);
  });
});
