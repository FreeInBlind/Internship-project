import { describe, expect, it, vi } from 'vitest';
import { BrowserOcrError, OCR_ERROR_CODES, TESSERACT_RESOURCES, createBrowserOcr } from '../lib/browserOcr.js';

const resources = { workerPath: '/ocr/worker.min.js', corePath: '/ocr/tesseract-core.wasm.js', langPath: '/ocr/lang-data' };
const image = { name: 'resume.png' };
const size = { width: 100, height: 80 };

function workerWith(result = '识别文本') {
  return { recognize: vi.fn(async () => ({ data: { text: result } })), terminate: vi.fn(async () => {}) };
}

describe('browser OCR', () => {
  it('requires explicit local resource paths and never invents CDN paths', async () => {
    const ocr = createBrowserOcr({ getImageSize: async () => size });
    await expect(ocr.recognize(image)).rejects.toMatchObject({ code: OCR_ERROR_CODES.RESOURCE_CONFIG_REQUIRED });
  });

  it('uses the final same-origin resource options and reports progress', async () => {
    const worker = workerWith(' Hello 中文 ');
    const progress = vi.fn();
    let finalOptions;
    const ocr = createBrowserOcr({ workerFactory: vi.fn(async (_lang, _oem, opts) => {
      finalOptions = opts;
      opts.logger({ status: 'recognizing text', progress: 0.5 });
      return worker;
    }), workerOptions: { ...resources, gzip: true, langPath: '/wrong' }, getImageSize: async () => size, onProgress: progress });
    await expect(ocr.recognize(image)).resolves.toMatchObject({ text: 'Hello 中文', width: 100, height: 80 });
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ progress: 0.5 }));
    expect(finalOptions).toMatchObject({ ...TESSERACT_RESOURCES, gzip: false });
    expect(finalOptions.corePath).toBe('/vendor/tesseract/7.0.0/core');
    expect(finalOptions.langPath).toBe('/vendor/tesseract/models');
    expect(typeof finalOptions.errorHandler).toBe('function');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('maps initialization errors to a controlled failure', async () => {
    const ocr = createBrowserOcr({ workerOptions: resources, getImageSize: async () => size, workerFactory: async (_lang, _oem, opts) => {
      opts.errorHandler({ message: 'private worker detail' });
      throw new Error('private initialization detail');
    } });
    await expect(ocr.recognize(image)).rejects.toMatchObject({ code: OCR_ERROR_CODES.OCR_INIT_FAILED });
  });

  it('ends on the initialization error callback, terminates a late worker, and can retry', async () => {
    let reportError;
    let resolveWorker;
    const lateWorker = workerWith('must not be used');
    const retryWorker = workerWith('retry succeeded');
    const factory = vi.fn()
      .mockImplementationOnce((_lang, _oem, opts) => {
        reportError = opts.errorHandler;
        return new Promise((resolve) => { resolveWorker = resolve; });
      })
      .mockResolvedValueOnce(retryWorker);
    const ocr = createBrowserOcr({ workerOptions: resources, getImageSize: async () => size, workerFactory: factory, initTimeoutMs: 100 });
    const failedTask = ocr.recognize(image);
    await vi.waitFor(() => expect(reportError).toBeTypeOf('function'));
    await new Promise((resolve) => setTimeout(resolve, 1));
    reportError({ message: 'private worker detail' });
    await expect(failedTask).rejects.toMatchObject({ code: OCR_ERROR_CODES.OCR_INIT_FAILED });
    const retryTask = ocr.recognize(image);
    await expect(retryTask).resolves.toMatchObject({ text: 'retry succeeded' });
    resolveWorker(lateWorker);
    await vi.waitFor(() => expect(lateWorker.terminate).toHaveBeenCalledOnce());
    expect(retryWorker.recognize).toHaveBeenCalledOnce();
  });

  it('times out pending initialization and terminates a late worker', async () => {
    let resolveWorker;
    const lateWorker = workerWith('late');
    const ocr = createBrowserOcr({ workerOptions: resources, initTimeoutMs: 5, getImageSize: async () => size, workerFactory: () => new Promise((resolve) => { resolveWorker = resolve; }) });
    const task = ocr.recognize(image);
    await expect(task).rejects.toMatchObject({ code: OCR_ERROR_CODES.OCR_TIMEOUT });
    resolveWorker(lateWorker);
    await vi.waitFor(() => expect(lateWorker.terminate).toHaveBeenCalledOnce());
  });

  it('rejects oversized images', async () => {
    const ocr = createBrowserOcr({ workerOptions: resources, getImageSize: async () => ({ width: 1001, height: 100 }), maxDimension: 1000 });
    await expect(ocr.recognize(image)).rejects.toMatchObject({ code: OCR_ERROR_CODES.IMAGE_TOO_LARGE });
  });

  it('reports empty OCR and wraps worker failures', async () => {
    const empty = createBrowserOcr({ workerOptions: resources, workerFactory: async () => workerWith(''), getImageSize: async () => size });
    await expect(empty.recognize(image)).rejects.toMatchObject({ code: OCR_ERROR_CODES.EMPTY_TEXT });
    const failed = createBrowserOcr({ workerOptions: resources, workerFactory: async () => ({ recognize: async () => { throw new Error('boom'); }, terminate: vi.fn() }), getImageSize: async () => size });
    await expect(failed.recognize(image)).rejects.toMatchObject({ code: OCR_ERROR_CODES.OCR_FAILED });
  });

  it('cancels an old task and isolates its result from a new task', async () => {
    let resolveOld;
    const oldWorker = { recognize: vi.fn(() => new Promise((resolve) => { resolveOld = resolve; })), terminate: vi.fn() };
    const newWorker = workerWith('new result');
    const factory = vi.fn().mockResolvedValueOnce(oldWorker).mockResolvedValueOnce(newWorker);
    const ocr = createBrowserOcr({ workerOptions: resources, workerFactory: factory, getImageSize: async () => size });
    const oldTask = ocr.recognize(image);
    await vi.waitFor(() => expect(oldWorker.recognize).toHaveBeenCalledOnce());
    const newTask = ocr.recognize(image);
    resolveOld({ data: { text: 'stale result' } });
    await expect(oldTask).rejects.toMatchObject({ code: OCR_ERROR_CODES.CANCELLED });
    await expect(newTask).resolves.toMatchObject({ text: 'new result' });
  });

  it('supports explicit cancellation', async () => {
    const worker = { recognize: vi.fn(() => new Promise(() => {})), terminate: vi.fn() };
    const ocr = createBrowserOcr({ workerOptions: resources, workerFactory: async () => worker, getImageSize: async () => size });
    const task = ocr.recognize(image);
    await Promise.resolve();
    ocr.cancel();
    await expect(task).rejects.toBeInstanceOf(BrowserOcrError);
  });
});
