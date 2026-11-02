import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useLanguage } from '../components/LanguageProvider';
import { reportToMarkdown, validateReportInput, validateCitations } from '../lib/reportSchema';
import { requireSession } from '../lib/requireSession';
import { officialAiAvailable } from '../lib/aiAvailability';
import Button from '../components/Button';
import PageHead from '../components/PageHead';
import { decodeUtf8Text, extensionOf, validateUploadMetadata } from '../lib/extraction';
import { uploadCopy, uploadMessage } from '../lib/uploadCopy';
import { extractPdfPages } from '../lib/browserDocuments';
import * as pdfjsModule from 'pdfjs-dist/legacy/build/pdf.mjs';
import { BrowserOcrError, OCR_ERROR_CODES, TESSERACT_RESOURCES, createBrowserOcr } from '../lib/browserOcr';
import { useCustomAi } from '../components/CustomAiProvider';
import { customAiRequest } from '../lib/customAiClient';
import { useSession } from 'next-auth/react';
import { createReportDraft } from '../lib/reportDraft';

export { requireSession as getServerSideProps };

const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'webp']);
const textExtensions = new Set(['txt', 'md']);
const analysisLimits = { text: 20000, jobTitle: 200, education: 200, optionalJd: 12000, salary: 200 };

export default function UploadPage() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const copy = uploadCopy[language] || uploadCopy.zh;
  const { config: customAiConfig, revision: customAiRevision } = useCustomAi();
  const { data: session, status: sessionStatus } = useSession();
  const ownerId = sessionStatus === 'authenticated' ? session?.user?.id || null : null;
  const ownerRef = useRef(ownerId);
  ownerRef.current = ownerId;
  const previousOwnerRef = useRef(ownerId);
  useEffect(() => {
    if (previousOwnerRef.current === ownerId) return;
    previousOwnerRef.current = ownerId;
    selectionRef.current += 1;
    invalidatePersonalAnalysis();
    delete window.__resumeReportDraft;
    resetSelection();
    // Owner changes discard the whole selection; other form changes do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);
  const personalText = language === 'zh' ? {
    mode: '个人 AI', missing: '尚未配置个人 AI，建议先配置后再开始。', analyze: '使用个人 AI 分析', settings: '配置个人 AI',
    notice: '仅在你明确点击分析后，已确认的简历文本和求职信息才会经本站服务器转发至所选 AI 服务商；服务商可能收费。取消请求不保证服务商停止处理。',
    busy: '正在通过个人 AI 分析…', cancelled: '请求已取消。服务商可能仍在处理。',
    used: '此份已确认内容已尝试分析，不会再次发送。重新选择文件并重新确认后可开始新分析。',
    failed: '个人 AI 请求失败。此份内容不会重新发送，请重新选择文件后再试。', invalid: '个人 AI 返回的报告未通过校验。此份内容不会重新发送，请重新选择文件后再试。',
  } : {
    mode: 'Personal AI', missing: 'Personal AI is not configured. Set it up before starting.', analyze: 'Analyze with personal AI', settings: 'Configure personal AI',
    notice: 'Only after you explicitly start analysis will the confirmed resume text and job context be forwarded through this app’s server to your selected AI provider; charges may apply. Cancellation cannot guarantee that the provider stops processing.',
    busy: 'Analyzing with personal AI…', cancelled: 'Request cancelled. The provider may still be processing it.',
    used: 'This confirmed content has already been submitted for analysis and will not be sent again. Choose and confirm a new file to start another analysis.',
    failed: 'The personal AI request failed. This content will not be sent again. Choose a new file to try again.', invalid: 'The personal AI report did not pass validation. This content will not be sent again. Choose a new file to try again.',
  };
  const [state, setState] = useState({ status: 'idle', message: '', fileName: '', fileType: '', text: '', result: null, ocrUsed: false, progress: 0, jobTitle: '', education: '', optionalJd: '', salary: '', reportLanguage: 'zh', roastResult: null, customAiResult: null });
  const docxWorkerRef = useRef(null);
  const ocrRef = useRef(null);
  const pdfTaskRef = useRef(null);
  const selectionRef = useRef(0);
  const analysisRequestIdRef = useRef(null);
  const officialAnalysisLockRef = useRef(false);
  const officialAttemptRef = useRef(false);
  const confirmationLockRef = useRef(false);
  const personalAttemptRef = useRef(false);
  const personalLockRef = useRef(false);
  const personalGenerationRef = useRef(0);
  const personalControllerRef = useRef(null);
  const customAiRevisionRef = useRef(customAiRevision);
  customAiRevisionRef.current = customAiRevision;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; personalGenerationRef.current += 1; personalControllerRef.current?.abort(); };
  }, []);

  useEffect(() => {
    ocrRef.current = createBrowserOcr({
      workerOptions: TESSERACT_RESOURCES,
      language: 'eng+chi_sim',
      onProgress: ({ status, progress }) => setState((current) => ({ ...current, message: status || '正在识别…', progress: typeof progress === 'number' ? progress : current.progress })),
    });
    return () => {
      selectionRef.current += 1;
      officialAnalysisLockRef.current = false;
      ocrRef.current?.cancel();
      pdfTaskRef.current?.controller.abort();
      pdfTaskRef.current?.renderTask?.cancel?.();
      pdfTaskRef.current?.pdf?.destroy?.();
      docxWorkerRef.current?.terminate();
    };
  }, []);

  useEffect(() => {
    if (!personalControllerRef.current) return;
    invalidatePersonalAnalysis();
    setState((current) => ({ ...current, customAiResult: 'cancelled' }));
  }, [customAiRevision]);

  function invalidatePersonalAnalysis() {
    personalGenerationRef.current += 1;
    personalControllerRef.current?.abort();
    personalControllerRef.current = null;
    personalLockRef.current = false;
  }

  function cancelPersonalAnalysis() {
    if (!personalControllerRef.current) return;
    invalidatePersonalAnalysis();
    setState((current) => ({ ...current, customAiResult: 'cancelled' }));
  }

  function updateJobField(field, value) {
    const wasBusy = Boolean(personalControllerRef.current);
    if (wasBusy) invalidatePersonalAnalysis();
    setState((current) => ({ ...current, [field]: value, ...(wasBusy ? { customAiResult: 'cancelled' } : {}) }));
  }

  function analysisInputError() {
    if (!state.result?.text?.trim() || state.result.text.length > analysisLimits.text) return copy.analysisTooLong;
    if (!state.jobTitle.trim() || !state.education.trim()) return copy.missingFields;
    if (Object.entries(analysisLimits).some(([field, max]) => field !== 'text' && state[field].length > max)) return copy.invalidFields;
    const payload = { resume: state.result.text, jobTitle: state.jobTitle, education: state.education, jobDescription: state.optionalJd, salaryContext: state.salary, reportLanguage: state.reportLanguage };
    if (new TextEncoder().encode(JSON.stringify(payload)).length > 96 * 1024) return copy.tooLarge;
    return '';
  }

  function editConfirmedText() {
    if (personalAttemptRef.current || officialAttemptRef.current) return;
    setState((current) => ({ ...current, status: 'editing', result: null, message: '', customAiResult: null, roastResult: null }));
  }

  async function submitPersonalAnalysis() {
    if (!ownerId || !customAiConfig || state.status !== 'complete' || personalLockRef.current || personalAttemptRef.current || officialAnalysisLockRef.current) return;
    const inputError = analysisInputError();
    if (inputError) {
      setState((current) => ({ ...current, customAiResult: { error: 'fields', message: inputError } }));
      return;
    }
    // Lock synchronously before any render or asynchronous work; all outcomes consume this selection.
    personalLockRef.current = true;
    personalAttemptRef.current = true;
    const generation = ++personalGenerationRef.current;
    const selectionId = selectionRef.current;
    const revision = customAiRevision;
    const controller = new AbortController();
    personalControllerRef.current = controller;
    const snapshot = state;
    const requestOwner = ownerId;
    const isCurrent = () => mountedRef.current && requestOwner === ownerRef.current && !controller.signal.aborted && generation === personalGenerationRef.current && selectionId === selectionRef.current && revision === customAiRevisionRef.current;
    setState((current) => ({ ...current, customAiResult: 'loading' }));
    try {
      const body = await customAiRequest('/api/custom-ai/analyze', {
        ...(customAiConfig.source === 'saved'
          ? { source: 'saved', configVersion: customAiConfig.configVersion, model: customAiConfig.model }
          : { config: { baseUrl: customAiConfig.baseUrl, apiKey: customAiConfig.apiKey, model: customAiConfig.model } }),
        input: { text: snapshot.result.text, jobTitle: snapshot.jobTitle, education: snapshot.education, optionalJd: snapshot.optionalJd, salary: snapshot.salary, reportLanguage: snapshot.reportLanguage },
        requestId: crypto.randomUUID(),
      }, { signal: controller.signal });
      if (!isCurrent()) return;
      const savedTargetMatches = customAiConfig.source !== 'saved' || (body?.config?.configVersion === customAiConfig.configVersion && body?.config?.baseUrl === customAiConfig.baseUrl && body?.effectiveModel === customAiConfig.model);
      if (!savedTargetMatches || body?.ok !== true || !validateReportInput(body?.report).ok || body.report.reportLanguage !== snapshot.reportLanguage || !validateCitations(body.report, snapshot.result.text)) {
        setState((current) => ({ ...current, customAiResult: { error: 'invalid' } }));
        return;
      }
      const markdown = reportToMarkdown(body.report);
      const handoff = createReportDraft(body.report, markdown, { confirmedResumeText: snapshot.result.text, jobTitle: snapshot.jobTitle, education: snapshot.education, optionalJd: snapshot.optionalJd, salary: snapshot.salary, reportLanguage: snapshot.reportLanguage }, ownerId);
      if (!handoff || ownerRef.current !== ownerId) return;
      window.__resumeReportDraft = handoff;
      setState((current) => ({ ...current, customAiResult: 'complete' }));
      await router.push('/feedback/draft');
    } catch (error) {
      if (!isCurrent()) return;
      setState((current) => ({ ...current, customAiResult: { error: error?.code === 'INVALID_REPORT' ? 'invalid' : 'failed' } }));
    } finally {
      if (generation === personalGenerationRef.current) {
        personalControllerRef.current = null;
        personalLockRef.current = false;
      }
    }
  }

  async function extractDocxInWorker(buffer) {
    const worker = new Worker('/vendor/mammoth/docx.worker.js');
    docxWorkerRef.current = worker;
    let timeout;
    try {
      return await new Promise((resolve) => {
        const id = `${Date.now()}-${Math.random()}`;
        const finish = (result) => {
          clearTimeout(timeout);
          worker.terminate();
          if (docxWorkerRef.current === worker) docxWorkerRef.current = null;
          resolve(result);
        };
        timeout = setTimeout(() => finish({ ok: false, code: 'DOCX_EXTRACTION_FAILED' }), 30000);
        worker.onmessage = (event) => { if (event.data?.id === id) finish(event.data); };
        worker.onerror = () => finish({ ok: false, code: 'DOCX_EXTRACTION_FAILED' });
        worker.postMessage({ id, buffer }, [buffer]);
      });
    } finally {
      clearTimeout(timeout);
      worker.terminate();
      if (docxWorkerRef.current === worker) docxWorkerRef.current = null;
    }
  }

  async function chooseFile(event) {
    const input = event.target;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const extension = extensionOf(file.name);
    const valid = validateUploadMetadata({ fileName: file.name, fileSize: file.size, extension });
    const selectionId = ++selectionRef.current;
    invalidatePersonalAnalysis();
    personalAttemptRef.current = false;
    analysisRequestIdRef.current = null;
    officialAnalysisLockRef.current = false;
    officialAttemptRef.current = false;
    confirmationLockRef.current = false;
    docxWorkerRef.current?.terminate();
    docxWorkerRef.current = null;
    ocrRef.current?.cancel();
    stopPdfTask();
    setState({ status: 'idle', message: '', fileName: '', fileType: '', text: '', result: null, ocrUsed: false, progress: 0, jobTitle: '', education: '', optionalJd: '', salary: '', reportLanguage: 'zh', roastResult: null, customAiResult: null });
    if (file.size === 0) {
      setState((current) => ({ ...current, status: 'error', message: '文件不能为空。' }));
      return;
    }
    if (!valid.ok) {
      setState((current) => ({ ...current, status: 'error', message: valid.code === 'FILE_TOO_LARGE' ? '文件超过 3MB 限制。' : '不支持的文件类型。', fileName: '', fileType: '', text: '', result: null }));
      return;
    }
    if (!textExtensions.has(extension) && !['pdf', 'docx'].includes(extension) && !imageExtensions.has(extension)) {
      setState((current) => ({ ...current, status: 'error', message: '当前仅支持 TXT、MD、PDF、DOCX 和图片。', fileName: '', fileType: '', text: '', result: null, ocrUsed: false, progress: 0 }));
      return;
    }
    setState((current) => ({ ...current, status: 'processing', fileName: file.name, fileType: extension, message: '正在读取文件…' }));
    try {
      const buffer = await file.arrayBuffer();
      if (selectionId !== selectionRef.current) return;
      let text;
      let ocrUsed = false;
      if (imageExtensions.has(extension)) {
        setState((current) => ({ ...current, status: 'processing', message: '正在加载本地 OCR 模型…', fileName: file.name, fileType: extension, text: '', result: null, ocrUsed: true, progress: 0 }));
        const recognized = await ocrRef.current.recognize(file);
        if (selectionId !== selectionRef.current) return;
        text = recognized.text;
        ocrUsed = true;
      } else if (extension === 'pdf') {
        setState((current) => ({ ...current, status: 'processing', fileName: file.name, fileType: extension, message: '正在打开 PDF…', progress: 0 }));
        const pdfjs = pdfjsModule;
        if (selectionId !== selectionRef.current) return;
        const controller = new AbortController();
        const task = { controller, pdf: null, renderTask: null };
        pdfTaskRef.current = task;
        const extracted = await extractPdfPages(buffer, {
          pdfjs,
          workerSrc: '/vendor/pdfjs/6.4.299/pdf.worker.mjs',
          signal: controller.signal,
          onDocument: (pdf) => { task.pdf = pdf; },
          onPage: async ({ page, pageNumber, pageCount, text: nativeText }) => {
            if (selectionId !== selectionRef.current || controller.signal.aborted) {
              const error = new Error('PDF cancelled');
              error.code = 'PDF_CANCELLED';
              throw error;
            }
            setState((current) => ({ ...current, status: 'processing', fileName: file.name, fileType: extension, message: `正在处理第 ${pageNumber}/${pageCount} 页…`, progress: (pageNumber - 1) / pageCount }));
            const normalized = nativeText.replace(/\s+/g, ' ').trim();
            const needsOcr = normalized.length < 40;
            if (!needsOcr) return { pageNumber, text: normalized, ocrUsed: false };
            const viewport = page.getViewport({ scale: 1 });
            const scale = Math.min(2, 2200 / Math.max(viewport.width, viewport.height));
            const rendered = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = Math.min(Math.ceil(rendered.width), 2200);
            canvas.height = Math.min(Math.ceil(rendered.height), 2200);
            const context = canvas.getContext('2d', { willReadFrequently: false });
            if (!context) throw new Error('PDF canvas unavailable');
            const renderTask = page.render({ canvasContext: context, viewport: rendered });
            task.renderTask = renderTask;
            try {
              await renderTask.promise;
              if (selectionId !== selectionRef.current || controller.signal.aborted) {
                const error = new Error('PDF cancelled');
                error.code = 'PDF_CANCELLED';
                throw error;
              }
              setState((current) => ({ ...current, message: `正在识别第 ${pageNumber}/${pageCount} 页…`, progress: (pageNumber - 0.5) / pageCount }));
              const recognized = await ocrRef.current.recognize(canvas);
              if (selectionId !== selectionRef.current || controller.signal.aborted) {
                const error = new Error('PDF cancelled');
                error.code = 'PDF_CANCELLED';
                throw error;
              }
              return { pageNumber, text: recognized.text, ocrUsed: true };
            } finally {
              task.renderTask = null;
              canvas.width = 1;
              canvas.height = 1;
            }
          },
        });
        if (pdfTaskRef.current === task) pdfTaskRef.current = null;
        if (selectionId !== selectionRef.current) return;
        if (!extracted.ok) {
          const messages = { INVALID_PDF: 'PDF 文件无效。', PDF_TOO_MANY_PAGES: 'PDF 最多支持 5 页。', PDF_CANCELLED: '已取消 PDF 识别。', PDF_EMPTY: 'PDF 不含可处理页面。', PDF_EXTRACTION_FAILED: 'PDF 文本提取失败，请检查文件是否加密或损坏。' };
          const error = new Error(messages[extracted.code] || 'PDF 文本提取失败。');
          error.code = extracted.code;
          throw error;
        }
        text = extracted.pages.map((page) => page.text).filter(Boolean).join('\n\n').trim();
        ocrUsed = extracted.pages.some((page) => page.ocrUsed);
        if (!text) throw new Error('PDF 不含可识别文字。');
      } else if (extension === 'docx') {
        const extracted = await extractDocxInWorker(buffer);
        if (selectionId !== selectionRef.current) return;
        if (!extracted.ok || !extracted.text) throw new Error('DOCX 文本提取失败，文件可能损坏或不含正文。');
        text = extracted.text;
      } else {
        const decoded = decodeUtf8Text(buffer);
        if (!decoded.ok) {
          setState((current) => ({ ...current, status: 'error', message: '文件不是有效的 UTF-8 文本，或包含二进制内容。', fileName: '', fileType: '', text: '', result: null }));
          return;
        }
        text = decoded.text;
      }
      if (text.length > 200000) throw new Error('文本超过 200,000 字符限制，请精简后再确认。');
      setState((current) => ({ ...current, status: 'editing', message: '', fileName: file.name, fileType: extension, text, result: null, ocrUsed, progress: 1 }));
    } catch (error) {
      if (error?.code === OCR_ERROR_CODES.CANCELLED || selectionId !== selectionRef.current) return;
      docxWorkerRef.current?.terminate();
      docxWorkerRef.current = null;
      const ocrMessages = {
        [OCR_ERROR_CODES.IMAGE_TOO_LARGE]: '图片尺寸超过限制，请选择较小或分辨率更低的图片。',
        [OCR_ERROR_CODES.EMPTY_TEXT]: '未识别到文字，请检查图片清晰度。',
        [OCR_ERROR_CODES.OCR_INIT_FAILED]: '本地 OCR 引擎初始化失败，请检查资源后重试。',
        [OCR_ERROR_CODES.OCR_TIMEOUT]: '本地 OCR 初始化超时，请重新选择图片重试。',
        [OCR_ERROR_CODES.OCR_FAILED]: '图片识别失败，请重新选择图片重试。',
        [OCR_ERROR_CODES.RESOURCE_CONFIG_REQUIRED]: '本地 OCR 资源未正确配置，请联系管理员。',
      };
      const documentMessages = {
        INVALID_PDF: 'PDF 文件无效。',
        PDF_TOO_MANY_PAGES: 'PDF 最多支持 5 页。',
        PDF_CANCELLED: '已取消 PDF 识别。',
        PDF_EMPTY: 'PDF 不含可处理页面。',
        PDF_EXTRACTION_FAILED: 'PDF 文本提取失败，请检查文件是否加密或损坏。',
      };
      const safeDocumentMessages = new Set(['DOCX 文本提取失败，文件可能损坏或不含正文。', 'PDF 不含可识别文字。', '文本超过 200,000 字符限制，请精简后再确认。']);
      const message = documentMessages[error?.code] || (safeDocumentMessages.has(error?.message) ? error.message : null) || (error instanceof BrowserOcrError
        ? ocrMessages[error.code] || '文件读取失败，请重试。'
        : '文件读取失败，请重试。');
      setState((current) => ({ ...current, status: 'error', message, progress: 0 }));
    }
  }

  function stopPdfTask() {
    const task = pdfTaskRef.current;
    if (!task) return;
    task.controller.abort();
    task.renderTask?.cancel?.();
    task.pdf?.destroy?.();
    pdfTaskRef.current = null;
  }

  function resetSelection() {
    invalidatePersonalAnalysis();
    selectionRef.current += 1;
    analysisRequestIdRef.current = null;
    officialAnalysisLockRef.current = false;
    officialAttemptRef.current = false;
    confirmationLockRef.current = false;
    docxWorkerRef.current?.terminate();
    docxWorkerRef.current = null;
    ocrRef.current?.cancel();
    stopPdfTask();
    setState({ status: 'idle', message: '', fileName: '', fileType: '', text: '', result: null, ocrUsed: false, progress: 0, jobTitle: '', education: '', optionalJd: '', salary: '', reportLanguage: 'zh', roastResult: null, customAiResult: null });
  }

  function cancelOcr() {
    selectionRef.current += 1;
    docxWorkerRef.current?.terminate();
    docxWorkerRef.current = null;
    ocrRef.current?.cancel();
    stopPdfTask();
    setState((current) => ({ ...current, status: 'idle', message: current.fileType === 'pdf' ? '已取消 PDF 识别。' : imageExtensions.has(current.fileType) ? '已取消图片识别。' : '已取消文件读取。', text: '', result: null, progress: 0 }));
  }

  async function submitAnalysis() {
    if (!ownerId || !officialAiAvailable() || officialAnalysisLockRef.current || officialAttemptRef.current || personalLockRef.current) return;
    if (state.status !== 'complete' || state.roastResult === 'loading' || state.roastResult?.report) return;
    const inputError = analysisInputError();
    if (inputError) { setState((current) => ({ ...current, roastResult: { error: inputError } })); return; }
    // Lock synchronously so rapid clicks cannot create a second official request.
    officialAnalysisLockRef.current = true;
    officialAttemptRef.current = true;
    const snapshot = state;
    const selectionId = selectionRef.current;
    const requestId = analysisRequestIdRef.current || crypto.randomUUID();
    analysisRequestIdRef.current = requestId;
    setState((current) => ({ ...current, roastResult: 'loading' }));
    try {
      const response = await fetch('/api/roast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: snapshot.result.text, jobTitle: snapshot.jobTitle, education: snapshot.education, optionalJd: snapshot.optionalJd, salary: snapshot.salary, reportLanguage: snapshot.reportLanguage, requestId }) });
      const body = await response.json();
      if (!mountedRef.current || ownerId !== ownerRef.current || selectionId !== selectionRef.current) return;
      if (!response.ok) {
        const messages = { QUOTA_EXHAUSTED: '官方分析今日额度已用完。', UPSTREAM_TIMEOUT: '分析请求超时，结果可能仍在处理中。请勿重复提交或刷新。', INVALID_REPORT: '分析结果未通过校验，本次请求已结束。', SERVICE_DISABLED: '分析服务尚未启用。', SERVICE_UNAVAILABLE: '分析服务暂不可用，本次请求已结束。', UPSTREAM_RATE_LIMIT: '分析供应商暂时限流，本次请求已结束。', UPSTREAM_UNAVAILABLE: '分析供应商暂不可用，本次请求已结束。' };
        throw new Error(messages[body?.error?.code] || '分析失败，本次请求已结束。');
      }
      if (!validateReportInput(body?.report).ok || body.report.reportLanguage !== snapshot.reportLanguage || !validateCitations(body.report, snapshot.result.text)) throw new Error('分析结果未通过内容校验，本次请求已结束。');
      const markdown = reportToMarkdown(body.report);
      const handoff = createReportDraft(body.report, markdown, { confirmedResumeText: snapshot.result.text, jobTitle: snapshot.jobTitle, education: snapshot.education, optionalJd: snapshot.optionalJd, salary: snapshot.salary, reportLanguage: snapshot.reportLanguage }, ownerId);
      if (!handoff || ownerRef.current !== ownerId) return;
      window.__resumeReportDraft = handoff;
      await router.push('/feedback/draft');
    } catch (error) {
      if (!mountedRef.current || ownerId !== ownerRef.current || selectionId !== selectionRef.current) return;
      officialAnalysisLockRef.current = false;
      const safeMessages = new Set(['官方分析今日额度已用完。', '分析请求超时，结果可能仍在处理中。请勿重复提交或刷新。', '分析结果未通过校验，本次请求已结束。', '分析服务尚未启用。', '分析服务暂不可用，本次请求已结束。', '分析供应商暂时限流，本次请求已结束。', '分析供应商暂不可用，本次请求已结束。', '分析结果未通过内容校验，本次请求已结束。']);
      const message = safeMessages.has(error?.message) ? error.message : '分析失败，本次请求已结束。';
      setState((current) => ({ ...current, roastResult: { error: uploadMessage(message, language) } }));
    }
  }

  async function submitText(event) {
    event.preventDefault();
    if (state.status !== 'editing' || confirmationLockRef.current) return;
    if (!state.text.trim() || state.text.length > 200000) {
      setState((current) => ({ ...current, message: current.text.trim() ? '文本超过 200,000 字符限制，请精简后再确认。' : '文本不能为空，请先补充或核对简历内容。' }));
      return;
    }
    confirmationLockRef.current = true;
    const selectionId = selectionRef.current;
    const submittedState = state;
    setState((current) => ({ ...current, status: 'submitting', message: '' }));
    try {
      const response = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: submittedState.text, fileName: submittedState.fileName, fileType: submittedState.fileType, ocrUsed: submittedState.ocrUsed }) });
      const body = await response.json();
      if (selectionId !== selectionRef.current || !mountedRef.current) return;
      if (!response.ok) {
        setState((current) => ({ ...current, status: 'editing', message: response.status === 401 ? 'UNAUTHORIZED' : 'CONFIRMATION_FAILED' }));
        return;
      }
      if (typeof body?.extraction?.text !== 'string' || !body.extraction.text.trim() || body.extraction.text !== submittedState.text) {
        setState((current) => ({ ...current, status: 'editing', message: 'CONFIRMATION_FAILED' }));
        return;
      }
      setState((current) => ({ ...current, status: 'complete', result: body.extraction, message: '文本已确认。此操作未调用 AI。' }));
    } catch {
      if (selectionId !== selectionRef.current || !mountedRef.current) return;
      setState((current) => ({ ...current, status: 'editing', message: 'CONFIRMATION_FAILED' }));
    } finally {
      if (selectionId === selectionRef.current) confirmationLockRef.current = false;
    }
  }

  const hasText = ['editing', 'submitting', 'complete'].includes(state.status);
  const complete = state.status === 'complete';
  const officialEnabled = officialAiAvailable();
  const analysisError = complete ? analysisInputError() : '';
  const attempted = personalAttemptRef.current || officialAttemptRef.current;
  const textTooLong = complete && state.result.text.length > analysisLimits.text;
  const displayedMessage = state.message === 'CONFIRMATION_FAILED' ? copy.confirmationFailed
    : state.message === 'UNAUTHORIZED' ? copy.sessionExpired : uploadMessage(state.message, language);
  const fieldClass = 'mt-2 w-full rounded-lg border border-ink/20 bg-white p-3 disabled:bg-ink/5';
  const actionClass = 'inline-flex min-h-11 items-center justify-center rounded-lg px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50';
  if (!ownerId || previousOwnerRef.current !== ownerId) return <><PageHead page="workspace" /><p role="status">{t.navLoading}</p></>;
  return <>
    <PageHead page="workspace" />
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange">{copy.eyebrow}</p>
        <h1 className="mt-3 text-4xl font-black leading-tight tracking-tight">{copy.title}</h1>
        <p className="mt-4 text-lg leading-8 text-ink/65">{copy.intro}</p>
        <p className="mt-4 rounded-lg border border-ink/15 bg-paper p-4 text-sm leading-6 text-ink/75">{copy.privacy}</p>
      </header>
      <aside className="rounded-lg border border-orange/35 bg-orange/5 p-5" aria-labelledby="ai-setup-heading">
        <h2 id="ai-setup-heading" className="font-bold">{copy.setupTitle}</h2>
        <p className="mt-2 text-sm leading-6 text-ink/70">{copy.setupBody}</p>
        {state.status === 'idle' && <p className="mt-2 text-sm font-semibold">{customAiConfig ? copy.configured : personalText.missing}</p>}
        <Button href="/settings" variant="secondary" className="mt-3">{copy.settings}</Button>
      </aside>
      <section className="space-y-4 rounded-lg border border-ink/15 bg-white p-6" aria-labelledby="upload-file-heading">
        <h2 id="upload-file-heading" className="text-xl font-bold">{copy.stepFile}</h2>
        <label className="block cursor-pointer rounded-lg border border-dashed border-ink/30 bg-paper p-6 text-center focus-within:ring-2 focus-within:ring-orange">
          <span className="font-semibold">{copy.choose}</span>
          <input className="sr-only" type="file" aria-label={copy.choose} aria-describedby="upload-file-hint upload-file-limits" accept=".txt,.md,.pdf,.docx,.png,.jpg,.jpeg,.webp" onChange={chooseFile} />
        </label>
        <p id="upload-file-hint" className="text-sm font-medium">{copy.fileHint}</p>
        <p id="upload-file-limits" className="text-sm leading-6 text-ink/65">{copy.limits}</p>
        {(state.status === 'error' || (state.status === 'idle' && state.message)) && <p className={`rounded-lg border p-4 text-sm ${state.status === 'error' ? 'border-red-300 bg-red-50 text-red-800' : 'border-blue-300 bg-blue-50 text-blue-900'}`} role={state.status === 'error' ? 'alert' : 'status'}>{displayedMessage}</p>}
        {state.status === 'processing' && <div className="rounded-lg border border-blue-300 bg-blue-50 p-4 text-sm text-blue-900" role="status" aria-live="polite">
          <p>{displayedMessage}{typeof state.progress === 'number' && state.progress > 0 ? ` ${Math.round(state.progress * 100)}%` : ''}</p>
          <button type="button" className="mt-3 underline" onClick={cancelOcr}>{copy.cancel}</button>
        </div>}
      </section>
      <section className="space-y-4 rounded-lg border border-ink/15 bg-white p-6" aria-labelledby="upload-text-heading">
        <h2 id="upload-text-heading" className="text-xl font-bold">{copy.stepText}</h2>
        <p className="text-sm leading-6 text-ink/65">{copy.textHint}</p>
        <p id="upload-text-limits" className="text-xs leading-5 text-ink/60">{copy.extractionLimit}</p>
        {!hasText && <p className="text-sm text-ink/60">{copy.waitForText}</p>}
        {hasText && <form onSubmit={submitText} className="space-y-4" aria-label={copy.stepText} aria-busy={state.status === 'submitting'}>
          <p className="break-all text-sm font-medium">{state.fileName}</p>
          {state.fileType === 'pdf' && <p className="text-sm text-ink/60">{state.ocrUsed ? copy.pdfOcr : copy.pdfNative}</p>}
          <label className="block text-sm font-semibold" htmlFor="upload-confirmed-text">{copy.textLabel}</label>
          <textarea id="upload-confirmed-text" className="min-h-72 w-full rounded-lg border border-ink/20 p-4 leading-7" value={state.text} readOnly={state.status !== 'editing'} aria-describedby="upload-text-limits" onChange={(event) => setState((current) => ({ ...current, text: event.target.value, message: '' }))} />
          <p className="text-xs text-ink/60">{state.text.length.toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')} {copy.chars}</p>
          {state.status === 'editing' && state.message && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">{displayedMessage}</p>}
          {state.status === 'editing' && state.message === 'UNAUTHORIZED' && <Button href="/login" variant="secondary">{copy.login}</Button>}
          <div className="flex flex-wrap gap-3">
            {!complete && <button className={`${actionClass} bg-ink text-paper`} disabled={state.status !== 'editing'} type="submit">{state.status === 'submitting' ? copy.confirming : copy.confirm}</button>}
            {complete && !attempted && <button className={`${actionClass} border border-ink/25`} type="button" onClick={editConfirmedText}>{copy.edit}</button>}
            <button className={`${actionClass} border border-ink/25`} disabled={state.status === 'submitting'} type="button" onClick={resetSelection}>{copy.reset}</button>
          </div>
          {complete && <p className="rounded-lg border border-green-300 bg-green-50 p-4 text-sm text-green-900" role="status">{uploadMessage('文本已确认。此操作未调用 AI。', language)} {language === 'zh' ? `共 ${state.result.text.length} 个字符。` : `${state.result.text.length} characters.`}</p>}
        </form>}
      </section>
      <section className="space-y-6" aria-labelledby="upload-analysis-heading">
        <h2 id="upload-analysis-heading" className="text-xl font-bold">{copy.stepAnalysis}</h2>
        {!complete && <p className="text-sm text-ink/60">{copy.waitForConfirmation}</p>}
        {complete && <>
          {textTooLong && <p role="alert" className="rounded-lg border border-orange/50 bg-orange/10 p-4 text-sm">{copy.analysisTooLong}</p>}
          <section className="space-y-4 rounded-lg border border-ink/15 bg-white p-6" aria-labelledby="job-context-heading">
            <h3 id="job-context-heading" className="text-lg font-bold">{copy.details}</h3>
            <p className="text-sm leading-6 text-ink/65">{copy.detailsHint}</p>
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="text-sm font-semibold">{copy.job}<input className={fieldClass} value={state.jobTitle} maxLength={analysisLimits.jobTitle} disabled={officialAnalysisLockRef.current} onChange={(event) => updateJobField('jobTitle', event.target.value)} /></label>
              <label className="text-sm font-semibold">{copy.education}<select className={fieldClass} value={state.education} disabled={officialAnalysisLockRef.current} onChange={(event) => updateJobField('education', event.target.value)}>
                <option value="">{copy.select}</option>{copy.educationOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></label>
              <div className="sm:col-span-2"><label className="text-sm font-semibold" htmlFor="upload-job-description">{copy.jd}</label><textarea id="upload-job-description" className={`${fieldClass} min-h-28`} value={state.optionalJd} maxLength={analysisLimits.optionalJd} disabled={officialAnalysisLockRef.current} aria-describedby="upload-jd-hint" onChange={(event) => updateJobField('optionalJd', event.target.value)} /><p id="upload-jd-hint" className="mt-2 text-xs text-ink/60">{copy.jdHint}</p></div>
              <label className="text-sm font-semibold">{copy.salary}<input className={fieldClass} value={state.salary} maxLength={analysisLimits.salary} disabled={officialAnalysisLockRef.current} onChange={(event) => updateJobField('salary', event.target.value)} /></label>
              <label className="text-sm font-semibold">{copy.reportLanguage}<select className={fieldClass} value={state.reportLanguage} disabled={officialAnalysisLockRef.current} onChange={(event) => updateJobField('reportLanguage', event.target.value)}><option value="zh">中文</option><option value="en">English</option></select></label>
            </div>
            {analysisError && !textTooLong && <p className="text-sm text-ink/65">{analysisError}</p>}
          </section>
          <section className="space-y-4 rounded-lg border border-orange/40 bg-orange/5 p-6" aria-labelledby="personal-ai-title" aria-busy={state.customAiResult === 'loading'}>
            <h3 id="personal-ai-title" className="text-lg font-bold">{personalText.mode}</h3>
            {customAiConfig ? <dl className="grid gap-1 break-all text-sm"><dt className="font-semibold">{copy.provider}</dt><dd>{customAiConfig.baseUrl}</dd><dt className="mt-2 font-semibold">{copy.model}</dt><dd>{customAiConfig.model}</dd></dl> : <p className="text-sm">{personalText.missing}</p>}
            <p className="text-sm leading-6 text-ink/70">{personalText.notice}</p>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className={`${actionClass} bg-ink text-white`} disabled={!customAiConfig || Boolean(analysisError) || personalAttemptRef.current || personalLockRef.current || officialAnalysisLockRef.current || state.roastResult === 'loading'} onClick={submitPersonalAnalysis}>{personalText.analyze}</button>
              {state.customAiResult === 'loading' && <button type="button" className={`${actionClass} border border-ink/25`} onClick={cancelPersonalAnalysis}>{copy.cancelPersonal}</button>}
            </div>
            {state.customAiResult && <p role={state.customAiResult?.error ? 'alert' : 'status'} className="text-sm">{state.customAiResult === 'loading' ? personalText.busy : state.customAiResult === 'cancelled' ? personalText.cancelled : state.customAiResult.error === 'fields' ? state.customAiResult.message : personalText[state.customAiResult.error] || personalText.used}</p>}
            {personalAttemptRef.current && state.customAiResult !== 'loading' && <p className="text-xs leading-5 text-ink/65">{personalText.used}</p>}
          </section>
          <section className="space-y-4 rounded-lg border border-ink/15 bg-paper p-6" aria-labelledby="official-ai-title">
            <h3 id="official-ai-title" className="text-lg font-bold">{t.officialAi}</h3>
            <p className="text-sm leading-6 text-ink/65">{officialEnabled ? t.officialAiReady : t.officialAiPaused}</p>
            <button className={`${actionClass} border border-ink/25`} disabled={!officialEnabled || Boolean(analysisError) || officialAnalysisLockRef.current || officialAttemptRef.current || personalLockRef.current || state.roastResult === 'loading'} type="button" onClick={submitAnalysis}>{officialEnabled ? copy.official : t.officialAiUnavailable}</button>
            {state.roastResult && <p className="rounded-lg border border-ink/15 p-4 text-sm" role={state.roastResult?.error ? 'alert' : 'status'}>{state.roastResult === 'loading' ? copy.officialBusy : state.roastResult.error || copy.officialDone}</p>}
            {officialAttemptRef.current && state.roastResult !== 'loading' && <p className="text-xs leading-5 text-ink/65">{copy.officialDone}</p>}
          </section>
        </>}
      </section>
      <Button href="/">{copy.back}</Button>
    </div>
  </>;
}
