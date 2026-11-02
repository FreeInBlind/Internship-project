vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated', data: { user: { id: 'fixture-owner' } } }) }));
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UploadPage from '../pages/upload';
import { LanguageProvider, useLanguage } from '../components/LanguageProvider';
import { createBrowserOcr } from '../lib/browserOcr';

const mocks = vi.hoisted(() => ({ push: vi.fn(), official: false, config: { baseUrl: 'https://ai.provider.com/v1', apiKey: 'private-fixture-key', model: 'fixture-model' } }));
vi.mock('next/router', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('../lib/requireSession', () => ({ requireSession: vi.fn() }));
vi.mock('../components/PageHead', () => ({ default: () => null }));
vi.mock('../components/CustomAiProvider', () => ({ useCustomAi: () => ({ config: mocks.config, revision: 0 }) }));
vi.mock('../lib/aiAvailability', () => ({ officialAiAvailable: () => mocks.official }));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ GlobalWorkerOptions: {} }));
vi.mock('../lib/browserOcr', async (original) => ({ ...await original(), createBrowserOcr: vi.fn() }));

const text = 'Entirely fictional resume text.';
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function SwitchLanguage() { const { toggleLanguage } = useLanguage(); return <button onClick={toggleLanguage}>Switch language</button>; }
function setup({ upload, analyze } = {}) {
  const fetchMock = vi.fn((url, options) => {
    if (url === '/api/upload') return upload ? upload(options) : Promise.resolve({ ok: true, json: async () => ({ extraction: { text: JSON.parse(options.body).text } }) });
    if (url === '/api/roast' || url === '/api/custom-ai/analyze') return analyze ? analyze(url, options) : Promise.resolve({ ok: false, json: async () => ({ error: { code: 'UPSTREAM_UNAVAILABLE' } }) });
    throw new Error('Unexpected URL in offline test');
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<LanguageProvider><SwitchLanguage /><UploadPage /></LanguageProvider>);
  return fetchMock;
}
function choose(content = text, extra = {}) {
  const file = { name: 'fictional.txt', size: content.length, arrayBuffer: async () => new TextEncoder().encode(content).buffer, ...extra };
  fireEvent.change(screen.getByLabelText('选择文件'), { target: { files: [file] } });
  return file;
}
async function confirm(content = text) {
  choose(content);
  await screen.findByRole('textbox', { name: '待确认简历文本' });
  fireEvent.click(screen.getByRole('button', { name: '确认并提交文本' }));
  await screen.findByLabelText('目标岗位（必填）');
}
function fillJob() {
  fireEvent.change(screen.getByLabelText('目标岗位（必填）'), { target: { value: 'Engineer' } });
  fireEvent.change(screen.getByLabelText('最高学历（必填）'), { target: { value: '本科' } });
}
const personalButton = () => screen.getByRole('button', { name: '使用个人 AI 分析' });
const officialButton = () => screen.getByRole('button', { name: '开始 AI 分析' });
const analysisCalls = (fetchMock) => fetchMock.mock.calls.filter(([url]) => url !== '/api/upload');

beforeEach(() => {
  mocks.official = false;
  mocks.config = { baseUrl: 'https://ai.provider.com/v1', apiKey: 'private-fixture-key', model: 'fixture-model' };
  mocks.push.mockReset().mockResolvedValue(true);
  window.localStorage.clear();
  delete window.__resumeReportDraft;
  vi.mocked(createBrowserOcr).mockReturnValue({ recognize: vi.fn(), cancel: vi.fn() });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); window.localStorage.clear(); delete window.__resumeReportDraft; });

describe('upload UI boundaries', () => {
  it('explains the three steps, all accepted formats, privacy and configuration before selecting a file', () => {
    mocks.config = null;
    const fetchMock = setup();
    for (const name of ['1. 选择简历', '2. 核对文本', '3. 填写信息并分析']) expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    expect(screen.getByText(/TXT \/ MD \/ PDF \/ DOCX \/ PNG \/ JPG \/ JPEG \/ WebP/)).toHaveTextContent('最大 3MB');
    expect(screen.getByText(/PDF 最多 5 页/)).toHaveTextContent('UTF-8');
    expect(screen.getByText(/PDF 最多 5 页/)).toHaveTextContent('本地中英文 OCR');
    expect(screen.getByText(/原文件仅在浏览器内读取/)).toHaveTextContent('不会上传');
    expect(screen.getByText(/原文件仅在浏览器内读取/)).toHaveTextContent('文本和文件名会发送到本站校验，不会保存');
    expect(screen.getByText(/原文件仅在浏览器内读取/)).toHaveTextContent('只有主动点击分析');
    expect(screen.getByText(/原文件仅在浏览器内读取/)).toHaveTextContent('当前账户历史，保留 14 天');
    expect(screen.getByText(/个人 AI 可仅本次使用/)).toHaveTextContent('加密保存到账户');
    expect(screen.getByText(/个人 AI 可仅本次使用/)).toHaveTextContent('未分析的工作台文本离页即丢失');
    expect(screen.getByText(/个人 AI 可仅本次使用/)).toHaveTextContent('首次保存起保留 14 天');
    expect(screen.getByText('尚未配置个人 AI，建议先配置后再开始。')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '配置个人 AI' })).toHaveAttribute('href', '/settings');
    expect(document.body.textContent).not.toMatch(/03 \/ Extract|阶段|后续实现/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders shared job context before personal and secondary official AI, with bounded inputs', async () => {
    const fetchMock = setup();
    await confirm();
    const context = screen.getByRole('region', { name: '求职信息' });
    const personal = screen.getByRole('region', { name: '个人 AI' });
    const official = screen.getByRole('region', { name: '官方 AI' });
    expect(context.compareDocumentPosition(personal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(personal.compareDocumentPosition(official) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(official).queryByLabelText('目标岗位（必填）')).not.toBeInTheDocument();
    expect(within(context).getByLabelText('目标岗位（必填）')).toHaveAttribute('maxlength', '200');
    expect(within(context).getByLabelText('职位描述（可选）')).toHaveAttribute('maxlength', '12000');
    expect(within(context).getByLabelText('薪资信息（可选）')).toHaveAttribute('maxlength', '200');
    expect(personalButton()).toBeDisabled();
    fillJob();
    expect(personalButton()).toBeEnabled();
    expect(within(official).getByRole('button')).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain('private-fixture-key');
  });

  it('disables both AI actions above 20,000 characters and lets the user edit without truncation', async () => {
    mocks.official = true;
    const fetchMock = setup();
    const longText = 'x'.repeat(20001);
    await confirm(longText);
    fillJob();
    expect(screen.getByRole('textbox', { name: '待确认简历文本' })).toHaveValue(longText);
    expect(personalButton()).toBeDisabled();
    expect(officialButton()).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('不会自动截断内容');
    fireEvent.click(screen.getByRole('button', { name: '返回核对文本' }));
    const editor = screen.getByRole('textbox', { name: '待确认简历文本' });
    expect(editor).not.toHaveAttribute('readonly');
    expect(editor).toHaveValue(longText);
    fireEvent.change(editor, { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: '确认并提交文本' }));
    await screen.findByLabelText('目标岗位（必填）');
    expect(personalButton()).toBeEnabled();
    expect(officialButton()).toBeEnabled();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).text).toHaveLength(20001);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).text).toBe(text);
    expect(analysisCalls(fetchMock)).toHaveLength(0);
  });

  it('switches all input labels and education option labels without changing entered values', async () => {
    const fetchMock = setup();
    await confirm();
    fillJob();
    fireEvent.click(screen.getByRole('button', { name: 'Switch language' }));
    expect(screen.getByLabelText('Target role (required)')).toHaveValue('Engineer');
    expect(screen.getByLabelText('Education (required)')).toHaveValue('本科');
    expect(screen.getByRole('option', { name: 'Bachelor’s degree' })).toHaveValue('本科');
    expect(screen.getByLabelText('Job description (optional)')).toHaveAttribute('maxlength', '12000');
    expect(screen.getByLabelText('Salary context (optional)')).toHaveAttribute('maxlength', '200');
    expect(screen.getByLabelText('Report language')).toHaveValue('zh');
    expect(screen.getByLabelText('Resume text to confirm')).toHaveValue(text);
    expect(screen.getByLabelText('Choose file')).toBeInTheDocument();
    expect(screen.getByText(/forwarded through this app’s server/)).toBeInTheDocument();
    expect(screen.getByText(/The original file stays in your browser/)).toHaveTextContent('without saving them');
    expect(screen.getByRole('button', { name: 'Currently unavailable' })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['empty', { size: 0 }, '文件不能为空'],
    ['oversize', { size: 3 * 1024 * 1024 + 1 }, '文件超过 3MB'],
    ['unsupported', { name: 'bad.exe' }, '不支持的文件类型'],
  ])('rejects %s metadata before reading or networking', async (_name, extra, message) => {
    const fetchMock = setup();
    const read = vi.fn();
    choose(text, { ...extra, arrayBuffer: read });
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(read).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows loading and cancel while reading, and ignores the cancelled read result', async () => {
    const read = deferred();
    const fetchMock = setup();
    choose(text, { arrayBuffer: () => read.promise });
    expect(screen.getByRole('status')).toHaveTextContent('正在读取文件');
    fireEvent.click(screen.getByRole('button', { name: '取消识别' }));
    await act(async () => read.resolve(new TextEncoder().encode(text).buffer));
    expect(screen.getByRole('status')).toHaveTextContent('已取消文件读取');
    expect(screen.queryByRole('textbox', { name: '待确认简历文本' })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('ignores a late DOCX result after selecting a new file', async () => {
    const workers = [];
    vi.stubGlobal('Worker', class {
      constructor() { workers.push(this); this.terminate = vi.fn(); }
      postMessage(message) { this.message = message; }
    });
    const fetchMock = setup();
    choose(text, { name: 'old.docx' });
    await act(async () => {});
    expect(workers).toHaveLength(1);
    choose('New selected text');
    expect(await screen.findByRole('textbox', { name: '待确认简历文本' })).toHaveValue('New selected text');
    await act(async () => workers[0].onmessage({ data: { id: workers[0].message.id, ok: true, text: 'STALE DOCX CONTENT' } }));
    expect(screen.getByRole('textbox', { name: '待确认简历文本' })).toHaveValue('New selected text');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('confirmation and analysis request boundaries', () => {
  it.each(['http', 'mismatch', 'invalid', 'network', 'unauthorized'])('keeps editable text after %s confirmation failure and hides untrusted server details', async (kind) => {
    const fetchMock = setup({ upload: () => {
      if (kind === 'network') return Promise.reject(new Error('private-network-credential'));
      return Promise.resolve({ ok: !['http', 'unauthorized'].includes(kind), status: kind === 'unauthorized' ? 401 : 500, json: async () => kind === 'invalid' ? { extraction: { text: {} } } : { extraction: { text: 'mismatched-private-text' }, error: { message: 'private-server-detail' } } });
    } });
    choose();
    const editor = await screen.findByRole('textbox', { name: '待确认简历文本' });
    fireEvent.click(screen.getByRole('button', { name: '确认并提交文本' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(kind === 'unauthorized' ? '请先复制当前文本' : '文本确认失败');
    expect(editor).toHaveValue(text);
    expect(editor).not.toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: '确认并提交文本' })).toBeEnabled();
    expect(document.body.textContent).not.toMatch(/private-server-detail|mismatched-private-text|private-network-credential/);
    expect(screen.queryByLabelText('目标岗位（必填）')).not.toBeInTheDocument();
    expect(analysisCalls(fetchMock)).toHaveLength(0);
    if (kind === 'unauthorized') expect(screen.getByRole('link', { name: '重新登录' })).toHaveAttribute('href', '/login');
  });

  it('locks repeated confirmation submissions and shows loading without losing the text', async () => {
    const pending = deferred();
    const fetchMock = setup({ upload: () => pending.promise });
    choose();
    await screen.findByLabelText('待确认简历文本');
    const form = screen.getByRole('form', { name: '2. 核对文本' });
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(form).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: '正在确认文本…' })).toBeDisabled();
    expect(screen.getByLabelText('待确认简历文本')).toHaveValue(text);
    await act(async () => pending.resolve({ ok: true, json: async () => ({ extraction: { text } }) }));
    expect(await screen.findByLabelText('目标岗位（必填）')).toBeInTheDocument();
    expect(analysisCalls(fetchMock)).toHaveLength(0);
  });

  it('prevents confirmation of empty or over-limit text without sending requests', async () => {
    const fetchMock = setup();
    choose();
    const editor = await screen.findByLabelText('待确认简历文本');
    for (const value of ['   ', 'x'.repeat(200001)]) {
      fireEvent.change(editor, { target: { value } });
      fireEvent.click(screen.getByRole('button', { name: '确认并提交文本' }));
      expect(screen.getByRole('alert')).toHaveTextContent(value.trim() ? '200,000' : '文本不能为空');
      expect(editor).toHaveValue(value);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it.each(['official', 'personal'])('prevents concurrent analysis while %s is loading', async (mode) => {
    mocks.official = true;
    const pending = deferred();
    const fetchMock = setup({ analyze: () => pending.promise });
    await confirm();
    fillJob();
    fireEvent.click(mode === 'official' ? officialButton() : personalButton());
    expect(personalButton()).toBeDisabled();
    expect(officialButton()).toBeDisabled();
    fireEvent.click(mode === 'official' ? personalButton() : officialButton());
    expect(analysisCalls(fetchMock)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '返回核对文本' })).not.toBeInTheDocument();
    if (mode === 'personal') {
      fireEvent.click(screen.getByRole('button', { name: '取消个人 AI 分析' }));
      expect(personalButton()).toBeDisabled();
    }
    await act(async () => pending.resolve({ ok: false, json: async () => ({ error: { code: 'UPSTREAM_UNAVAILABLE' } }) }));
    if (mode === 'official') expect(officialButton()).toBeDisabled();
    expect(analysisCalls(fetchMock)).toHaveLength(1);
  });

  it('consumes an official failure once per selection and displays a fixed error for unknown exceptions', async () => {
    mocks.official = true;
    const fetchMock = setup({ analyze: () => Promise.reject(new Error('private-provider-detail secret-token')) });
    await confirm();
    fillJob();
    fireEvent.click(officialButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('分析失败，本次请求已结束。');
    expect(document.body.textContent).not.toMatch(/private-provider-detail|secret-token/);
    expect(officialButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText('目标岗位（必填）'), { target: { value: 'Designer' } });
    expect(officialButton()).toBeDisabled();
    fireEvent.click(officialButton());
    expect(analysisCalls(fetchMock)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '重新选择文件' }));
    await confirm();
    fillJob();
    expect(officialButton()).toBeEnabled();
  });
});
