import { createWorker } from 'tesseract.js';

export const TESSERACT_RESOURCES = Object.freeze({
  workerPath: '/vendor/tesseract/7.0.0/worker/worker.min.js',
  corePath: '/vendor/tesseract/7.0.0/core',
  langPath: '/vendor/tesseract/models',
  gzip: false,
});

export const OCR_ERROR_CODES = Object.freeze({
  RESOURCE_CONFIG_REQUIRED: 'RESOURCE_CONFIG_REQUIRED',
  INVALID_IMAGE: 'INVALID_IMAGE',
  IMAGE_TOO_LARGE: 'IMAGE_TOO_LARGE',
  CANCELLED: 'CANCELLED',
  EMPTY_TEXT: 'EMPTY_TEXT',
  OCR_INIT_FAILED: 'OCR_INIT_FAILED',
  OCR_TIMEOUT: 'OCR_TIMEOUT',
  OCR_FAILED: 'OCR_FAILED',
});

export class BrowserOcrError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'BrowserOcrError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

const defaultSize = async (image) => {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(image);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  }
  if (typeof Image !== 'undefined') {
    const url = URL.createObjectURL(image);
    try {
      const element = new Image();
      await new Promise((resolve, reject) => {
        element.onload = resolve;
        element.onerror = () => reject(new Error('Image could not be decoded'));
        element.src = url;
      });
      return { width: element.naturalWidth, height: element.naturalHeight };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  throw new Error('No browser image decoder is available');
};

const configError = () => new BrowserOcrError(OCR_ERROR_CODES.RESOURCE_CONFIG_REQUIRED, '浏览器 OCR 需要配置本地资源。');
const cancelledError = () => new BrowserOcrError(OCR_ERROR_CODES.CANCELLED, 'OCR 已取消。');
const initFailedError = () => new BrowserOcrError(OCR_ERROR_CODES.OCR_INIT_FAILED, '本地 OCR 引擎初始化失败，请重试。');

export function createBrowserOcr(options = {}) {
  const {
    workerFactory = createWorker,
    workerOptions = {},
    language = 'eng+chi_sim',
    maxPixels = 40_000_000,
    maxDimension = 10_000,
    initTimeoutMs = 30_000,
    getImageSize = defaultSize,
    onProgress,
  } = options;

  let generation = 0;
  let active = null;

  const terminate = (request) => {
    if (request.terminated || !request.worker?.terminate) return;
    request.terminated = true;
    Promise.resolve(request.worker.terminate()).catch(() => {});
  };

  const cancel = () => {
    if (!active) return;
    const request = active;
    request.cancelled = true;
    request.controller.abort();
    clearTimeout(request.timeout);
    if (active?.id === request.id) active = null;
    terminate(request);
    if (request.cancelReject) request.cancelReject(cancelledError());
  };

  const recognize = (image, requestOptions = {}) => {
    cancel();
    const current = { id: ++generation, cancelled: false, controller: new AbortController(), worker: null, terminated: false, cancelReject: null, timeout: null, initError: null };
    active = current;
    const resources = { ...workerOptions, ...(requestOptions.workerOptions || {}) };
    if (!resources.workerPath || !resources.corePath || !resources.langPath) {
      active = null;
      return Promise.reject(configError());
    }
    if (!image) return Promise.reject(new BrowserOcrError(OCR_ERROR_CODES.INVALID_IMAGE, '未提供图片。'));

    const task = (async () => {
      try {
        const size = await getImageSize(image);
        if (!size?.width || !size?.height || !Number.isFinite(size.width) || !Number.isFinite(size.height)) throw new BrowserOcrError(OCR_ERROR_CODES.INVALID_IMAGE, '图片尺寸无法读取。');
        if (size.width > maxDimension || size.height > maxDimension || size.width * size.height > maxPixels) throw new BrowserOcrError(OCR_ERROR_CODES.IMAGE_TOO_LARGE, `图片尺寸超过限制（最大 ${maxDimension}px 或 ${maxPixels} 像素）。`);
        const languages = requestOptions.language || language;
        const finalResources = { ...resources, ...TESSERACT_RESOURCES };
        let reportWorkerError;
        const workerError = new Promise((_, reject) => { reportWorkerError = reject; });
        // Tesseract owns the worker until createWorker resolves, so retain only a safe category here.
        const handleWorkerError = () => {
          if (current.cancelled || current.initError) return;
          current.initError = true;
          reportWorkerError(initFailedError());
        };
        let factoryPromise;
        factoryPromise = Promise.resolve().then(() => workerFactory(languages, undefined, {
          ...finalResources,
          errorHandler: handleWorkerError,
          logger: (message) => {
            if (active?.id === current.id && !current.cancelled && typeof onProgress === 'function') onProgress({ status: message.status, progress: typeof message.progress === 'number' ? message.progress : undefined, taskId: current.id });
          },
        })).then((worker) => {
          if (current.initError) {
            current.worker = worker;
            terminate(current);
            throw initFailedError();
          }
          return worker;
        });
        const timeoutPromise = new Promise((_, reject) => {
          current.timeout = setTimeout(() => reject(new BrowserOcrError(OCR_ERROR_CODES.OCR_TIMEOUT, 'OCR 初始化超时，请重试。')), initTimeoutMs);
        });
        factoryPromise.then((lateWorker) => {
          if (current.cancelled || current.initError || active?.id !== current.id) {
            current.worker = lateWorker;
            terminate(current);
          }
        }).catch(() => {});
        const factoryResult = factoryPromise.then((value) => ({ type: 'worker', value }), (error) => ({ type: 'factoryError', error }));
        const initResult = workerError.then((error) => ({ type: 'initError', error }));
        const timeoutResult = timeoutPromise.then(() => ({ type: 'timeout' }), (error) => ({ type: 'timeoutError', error }));
        const outcome = await Promise.race([initResult, factoryResult, timeoutResult]);
        if (current.initError) {
          factoryPromise.then((lateWorker) => { current.worker = lateWorker; terminate(current); }).catch(() => {});
          throw initFailedError();
        }
        if (outcome.type === 'initError') {
          factoryPromise.then((lateWorker) => { current.worker = lateWorker; terminate(current); }).catch(() => {});
          throw outcome.error;
        }
        if (outcome.type === 'factoryError') throw outcome.error;
        if (outcome.type === 'timeoutError') throw outcome.error;
        const worker = outcome.value;
        if (current.initError) { current.worker = worker; terminate(current); throw initFailedError(); }
        clearTimeout(current.timeout);
        if (current.cancelled || active?.id !== current.id) { current.worker = worker; terminate(current); throw cancelledError(); }
        current.worker = worker;
        const result = await worker.recognize(image);
        if (current.initError) throw initFailedError();
        if (current.cancelled || active?.id !== current.id) throw cancelledError();
        const text = result?.data?.text?.trim() || '';
        if (!text) throw new BrowserOcrError(OCR_ERROR_CODES.EMPTY_TEXT, '未识别到文字。');
        return { text, width: size.width, height: size.height, taskId: current.id };
      } catch (error) {
        if (error?.code) throw error;
        if (current.cancelled || active?.id !== current.id || current.controller.signal.aborted) throw cancelledError();
        if (current.initError) throw initFailedError();
        throw new BrowserOcrError(OCR_ERROR_CODES.OCR_FAILED, 'OCR 识别失败。', error);
      } finally {
        clearTimeout(current.timeout);
        terminate(current);
        if (active?.id === current.id) active = null;
      }
    })();
    const cancellation = new Promise((_, reject) => { current.cancelReject = reject; });
    return Promise.race([task, cancellation]);
  };

  return { recognize, cancel };
}

export const recognizeImage = (image, options) => createBrowserOcr(options).recognize(image);
