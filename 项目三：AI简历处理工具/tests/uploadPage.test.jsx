vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated', data: { user: { id: 'fixture-owner' } } }) }));
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UploadPage from '../pages/upload';
import { LanguageProvider } from '../components/LanguageProvider';
import { BrowserOcrError, OCR_ERROR_CODES, createBrowserOcr } from '../lib/browserOcr';
import { extractPdfPages } from '../lib/browserDocuments';

vi.mock('../lib/requireSession', () => ({ requireSession: vi.fn() }));
vi.mock('next/router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../lib/browserDocuments', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, extractPdfPages: vi.fn() };
});
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ GlobalWorkerOptions: {} }));
vi.mock('../components/PageHead', () => ({ default: () => null }));
vi.mock('../lib/browserOcr', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, createBrowserOcr: vi.fn() };
});

const imageFile = { name: 'resume.png', size: 100, type: 'image/png', arrayBuffer: async () => new ArrayBuffer(1) };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function chooseImage(file = imageFile) {
  const input = screen.getByLabelText(/选择文件/);
  fireEvent.change(input, { target: { files: [file] } });
  return input;
}

function choosePdf(file = { name: 'sample.pdf', size: 128, type: 'application/pdf', arrayBuffer: async () => new ArrayBuffer(8) }) {
  const input = screen.getByLabelText(/选择文件/);
  fireEvent.change(input, { target: { files: [file] } });
  return input;
}

function mockPdfModule() {
  vi.doMock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ GlobalWorkerOptions: {} }));
}

function mockScannedPdfPage() {
  return {
    getViewport: ({ scale }) => ({ width: 400 * scale, height: 600 * scale }),
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
  };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); vi.doUnmock('pdfjs-dist/legacy/build/pdf.mjs'); });

describe('upload page OCR flow', () => {
  it('shows a controlled initialization error, clears busy state, and does not submit', async () => {
    const recognize = vi.fn().mockRejectedValue(new BrowserOcrError(OCR_ERROR_CODES.OCR_INIT_FAILED, 'private detail'));
    vi.mocked(createBrowserOcr).mockReturnValue({ recognize, cancel: vi.fn() });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<LanguageProvider><UploadPage /></LanguageProvider>);
    chooseImage();

    expect(await screen.findByRole('alert')).toHaveTextContent('本地 OCR 引擎初始化失败');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认并提交文本' })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).not.toHaveTextContent('private detail');
  });

  it('only posts the recognized text after explicit confirmation', async () => {
    const recognize = vi.fn().mockResolvedValue({ text: 'Recognized resume text' });
    vi.mocked(createBrowserOcr).mockReturnValue({ recognize, cancel: vi.fn() });
    const fetchMock = vi.fn(async (_url, options) => ({ ok: true, json: async () => ({ extraction: { text: JSON.parse(options.body).text } }) }));
    vi.stubGlobal('fetch', fetchMock);

    render(<LanguageProvider><UploadPage /></LanguageProvider>);
    chooseImage();

    const textArea = await screen.findByRole('textbox', { name: '待确认简历文本' });
    expect(textArea).toHaveValue('Recognized resume text');
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(textArea, { target: { value: 'Confirmed edited text' } });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认并提交文本' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith('/api/upload', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ text: 'Confirmed edited text', fileName: 'resume.png', fileType: 'png', ocrUsed: true }),
    }));
    expect(await screen.findByText(/共 21 个字符/)).toBeInTheDocument();
    expect(await screen.findByLabelText('目标岗位（必填）')).toBeInTheDocument();
    expect(screen.queryByLabelText('最高学历（必填）')).toHaveValue('');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not call the analysis API while editing job details or report language', async () => {
    const recognize = vi.fn().mockResolvedValue({ text: 'Resume content for an engineer role.' });
    vi.mocked(createBrowserOcr).mockReturnValue({ recognize, cancel: vi.fn() });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ extraction: { text: 'Resume content for an engineer role.' } }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<LanguageProvider><UploadPage /></LanguageProvider>);
    chooseImage();
    await screen.findByRole('textbox', { name: '待确认简历文本' });
    fireEvent.click(screen.getByRole('button', { name: '确认并提交文本' }));
    await screen.findByLabelText('目标岗位（必填）');
    fireEvent.change(screen.getByLabelText('目标岗位（必填）'), { target: { value: 'Engineer' } });
    fireEvent.change(screen.getByLabelText('最高学历（必填）'), { target: { value: '本科' } });
    fireEvent.change(screen.getByLabelText('报告语言'), { target: { value: 'en' } });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/upload');
  });

  it('shows a usable cancel action while OCR is pending and ignores its late result', async () => {
    const pending = deferred();
    const cancel = vi.fn();
    vi.mocked(createBrowserOcr).mockReturnValue({ recognize: vi.fn(() => pending.promise), cancel });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<LanguageProvider><UploadPage /></LanguageProvider>);
    chooseImage();

    expect(await screen.findByRole('button', { name: '取消识别' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '取消识别' }));
    expect(cancel).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '取消识别' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('已取消图片识别。');

    pending.resolve({ text: 'stale recognized result' });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '待确认简历文本' })).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('已取消图片识别。');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('processes mixed PDF pages in order, exposes progress, and posts only edited text after confirmation', async () => {
    vi.mocked(extractPdfPages).mockImplementation(async (_buffer, options) => {
      const pageSet = (async () => {
        const first = await options.onPage({ page: {}, pageNumber: 1, pageCount: 3, text: 'MIXED PAGE ALPHA with enough native text to exceed the sparse threshold and stay native.' });
        const second = await options.onPage({ page: mockScannedPdfPage(), pageNumber: 2, pageCount: 3, text: '' });
        const third = await options.onPage({ page: {}, pageNumber: 3, pageCount: 3, text: 'MIXED PAGE CHARLIE with enough native text to exceed the sparse threshold and stay native.' });
        return { ok: true, text: [first.text, second.text, third.text].join('\\n\\n'), pages: [first, second, third] };
      })();
      return pageSet;
    });
    const recognize = vi.fn().mockResolvedValue({ text: 'SCAN PAGE BRAVO' });
    vi.mocked(createBrowserOcr).mockReturnValue({ recognize, cancel: vi.fn() });
    const fetchMock = vi.fn(async (_url, options) => ({ ok: true, json: async () => ({ extraction: { text: JSON.parse(options.body).text } }) }));
    vi.stubGlobal('fetch', fetchMock);
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName) => tagName === 'canvas'
      ? { width: 0, height: 0, getContext: () => ({}) }
      : originalCreateElement(tagName));

    render(<LanguageProvider><UploadPage /></LanguageProvider>);
    choosePdf();
    await waitFor(() => expect(extractPdfPages).toHaveBeenCalledOnce());
    expect(fetchMock).not.toHaveBeenCalled();

    await waitFor(() => expect(recognize).toHaveBeenCalledOnce());
    await screen.findByRole('textbox', { name: '待确认简历文本' });
    const textArea = screen.getByRole('textbox', { name: '待确认简历文本' });
    expect(textArea.value.indexOf('MIXED PAGE ALPHA')).toBeLessThan(textArea.value.indexOf('SCAN PAGE BRAVO'));
    expect(textArea.value.indexOf('SCAN PAGE BRAVO')).toBeLessThan(textArea.value.indexOf('MIXED PAGE CHARLIE'));
    expect(textArea.value.match(/SCAN PAGE BRAVO/g)).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(textArea, { target: { value: 'edited mixed PDF text' } });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认并提交文本' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ text: 'edited mixed PDF text', fileName: 'sample.pdf', fileType: 'pdf', ocrUsed: true });
  });

  it('shows PDF page progress and a cancel action while page OCR is pending', async () => {
    const pending = deferred();
    const cancel = vi.fn();
    vi.mocked(extractPdfPages).mockImplementation(async (_buffer, options) => {
      await options.onPage({ page: mockScannedPdfPage(), pageNumber: 1, pageCount: 2, text: '' });
      return new Promise(() => {});
    });
    vi.mocked(createBrowserOcr).mockReturnValue({ recognize: vi.fn(() => pending.promise), cancel });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName) => tagName === 'canvas'
      ? { width: 0, height: 0, getContext: () => ({}) }
      : originalCreateElement(tagName));

    render(<LanguageProvider><UploadPage /></LanguageProvider>);
    choosePdf();
    expect(await screen.findByText(/正在识别第 1\/2 页/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消识别' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认并提交文本' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消识别' }));
    expect(cancel).toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('已取消 PDF 识别。');
    pending.resolve({ text: 'late PDF OCR result' });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '待确认简历文本' })).not.toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses native text without OCR for a text PDF page', async () => {
    vi.mocked(extractPdfPages).mockImplementation(async (_buffer, options) => {
      const page = await options.onPage({ page: {}, pageNumber: 1, pageCount: 1, text: 'A sufficiently long native-only PDF page that does not need OCR.' });
      return { ok: true, pages: [page], text: page.text };
    });
    const recognize = vi.fn();
    vi.mocked(createBrowserOcr).mockReturnValue({ recognize, cancel: vi.fn() });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<LanguageProvider><UploadPage /></LanguageProvider>);
    choosePdf();
    expect(await screen.findByRole('textbox', { name: '待确认简历文本' })).toHaveValue('A sufficiently long native-only PDF page that does not need OCR.');
    expect(recognize).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not expose partial PDF text or allow submission when a page fails', async () => {
    vi.mocked(extractPdfPages).mockImplementation(async (_buffer, options) => {
      await options.onPage({ page: {}, pageNumber: 1, pageCount: 2, text: 'A sufficiently long first native page that is not enough to finish the document.' });
      return { ok: false, code: 'PDF_EXTRACTION_FAILED' };
    });
    vi.mocked(createBrowserOcr).mockReturnValue({ recognize: vi.fn(), cancel: vi.fn() });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<LanguageProvider><UploadPage /></LanguageProvider>);
    choosePdf();
    expect(await screen.findByRole('alert')).toHaveTextContent('PDF 文本提取失败');
    expect(screen.queryByRole('textbox', { name: '待确认简历文本' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认并提交文本' })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores old PDF page callbacks and progress after cancellation and reselection', async () => {
    const firstStarted = deferred();
    let firstResolve;
    vi.mocked(extractPdfPages)
      .mockImplementationOnce((_buffer, options) => {
        firstStarted.resolve(options);
        return new Promise((resolve) => { firstResolve = resolve; });
      })
      .mockImplementationOnce(async (_buffer, options) => {
        const page = await options.onPage({ page: {}, pageNumber: 1, pageCount: 1, text: 'The replacement PDF contains enough native text and should remain visible.' });
        return { ok: true, pages: [page], text: page.text };
      });
    vi.mocked(createBrowserOcr).mockReturnValue({ recognize: vi.fn(), cancel: vi.fn() });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<LanguageProvider><UploadPage /></LanguageProvider>);
    choosePdf({ name: 'old.pdf', size: 100, type: 'application/pdf', arrayBuffer: async () => new ArrayBuffer(8) });
    const oldOptions = await firstStarted.promise;
    fireEvent.click(await screen.findByRole('button', { name: '取消识别' }));
    expect(screen.getByRole('status')).toHaveTextContent('已取消 PDF 识别。');

    choosePdf({ name: 'new.pdf', size: 100, type: 'application/pdf', arrayBuffer: async () => new ArrayBuffer(8) });
    const textArea = await screen.findByRole('textbox', { name: '待确认简历文本' });
    await expect(oldOptions.onPage({ page: {}, pageNumber: 2, pageCount: 2, text: 'STALE PAGE MUST NOT REPLACE NEW FILE' })).rejects.toMatchObject({ code: 'PDF_CANCELLED' });
    firstResolve?.({ ok: true, pages: [{ pageNumber: 2, text: 'STALE PAGE MUST NOT REPLACE NEW FILE' }], text: 'STALE PAGE MUST NOT REPLACE NEW FILE' });
    expect(textArea).toHaveValue('The replacement PDF contains enough native text and should remain visible.');
    expect(screen.queryByText(/正在处理第 2\/2 页/)).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows selecting the same file again and clears a prior successful result on failure', async () => {
    const pending = deferred();
    const recognize = vi.fn()
      .mockResolvedValueOnce({ text: 'First recognized text' })
      .mockReturnValueOnce(pending.promise);
    const file = { ...imageFile, arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)) };
    vi.mocked(createBrowserOcr).mockReturnValue({ recognize, cancel: vi.fn() });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ extraction: { text: 'First recognized text' } }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<LanguageProvider><UploadPage /></LanguageProvider>);
    chooseImage(file);
    const confirm = await screen.findByRole('button', { name: '确认并提交文本' });
    fireEvent.click(confirm);
    await screen.findByText(/共 21 个字符/);

    fireEvent.click(screen.getByRole('button', { name: '重新选择文件' }));
    expect(screen.queryByText(/共 21 个字符/)).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '待确认简历文本' })).not.toBeInTheDocument();

    await waitFor(() => {
      chooseImage(file);
      expect(recognize).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText(/共 21 个字符/)).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '待确认简历文本' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();

    pending.reject(new Error('private detail'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('文件读取失败'));
    expect(screen.getByRole('alert')).not.toHaveTextContent('private detail');
    expect(screen.queryByText(/共 21 个字符/)).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '待确认简历文本' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
