const PDFJS_VERSION = '6.4.299';
const PDF_MAX_PAGES = 5;
const MAX_INPUT_BYTES = 3 * 1024 * 1024;
const DOCX_MAX_ENTRIES = 2000;
const DOCX_MAX_UNCOMPRESSED = 20 * 1024 * 1024;
const DOCX_MAX_NAME_LENGTH = 1024;

const fail = (code) => ({ ok: false, code });
const success = (text, extra = {}) => ({ ok: true, text, ...extra });

function asBytes(input) {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return null;
}

export function validatePdfSignature(input) {
  const bytes = asBytes(input);
  return bytes && bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-';
}

export function validateDocxZip(input) {
  const bytes = asBytes(input);
  if (!bytes || bytes.length > MAX_INPUT_BYTES || bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) return fail('INVALID_DOCX');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const start = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= start; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return fail('INVALID_DOCX');
  const entries = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (!entries || entries > DOCX_MAX_ENTRIES || centralOffset + centralSize > bytes.length) return fail('DOCX_LIMIT');

  const names = new Set();
  let offset = centralOffset;
  let total = 0;
  for (let i = 0; i < entries; i += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) return fail('INVALID_DOCX');
    const compressed = view.getUint32(offset + 20, true);
    const uncompressed = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    if (nameLength > DOCX_MAX_NAME_LENGTH || offset + 46 + nameLength + extraLength + commentLength > bytes.length) return fail('DOCX_LIMIT');
    const name = new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    if (name.includes('..') || name.startsWith('/') || name.includes('\\')) return fail('INVALID_DOCX');
    names.add(name);
    total += uncompressed;
    if (total > DOCX_MAX_UNCOMPRESSED || compressed > bytes.length) return fail('DOCX_LIMIT');
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (!names.has('[Content_Types].xml') || !names.has('word/document.xml')) return fail('INVALID_DOCX');
  return { ok: true, entries, uncompressedBytes: total };
}

export async function extractPdfPages(input, options = {}) {
  const bytes = asBytes(input);
  if (!validatePdfSignature(bytes)) return fail('INVALID_PDF');
  let pdf;
  try {
    const pdfjs = options.pdfjs || await import('pdfjs-dist/legacy/build/pdf.mjs');
    if (pdfjs.GlobalWorkerOptions) {
      if (!options.workerSrc) return fail('PDF_WORKER_CONFIG_REQUIRED');
      pdfjs.GlobalWorkerOptions.workerSrc = options.workerSrc;
    }
    const loadingTask = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, enableScripting: false });
    options.signal?.addEventListener('abort', () => {
      try { loadingTask.destroy?.(); } catch { /* best effort */ }
    }, { once: true });
    pdf = await loadingTask.promise;
    options.onDocument?.(pdf);
    if (options.signal?.aborted) return fail('PDF_CANCELLED');
    const pageCount = pdf.numPages;
    if (!pageCount) return fail('PDF_EMPTY');
    if (pageCount > PDF_MAX_PAGES) return fail('PDF_TOO_MANY_PAGES');
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      if (options.signal?.aborted) return fail('PDF_CANCELLED');
      const page = await pdf.getPage(pageNumber);
      try {
        if (options.signal?.aborted) return fail('PDF_CANCELLED');
        const content = await page.getTextContent();
        const text = content.items.map((item) => item.str || '').join(' ').trim();
        const value = await options.onPage?.({ page, pageNumber, pageCount, text });
        pages.push(value === undefined ? { pageNumber, text } : value);
      } finally {
        page.cleanup?.();
      }
    }
    return success(pages.map((page) => page.text || '').join('\n\n').trim(), { pageCount, pagesRead: pageCount, truncated: false, pages });
  } catch (error) {
    if (error?.code === 'PDF_CANCELLED') return fail('PDF_CANCELLED');
    return fail('PDF_EXTRACTION_FAILED');
  } finally {
    try { await pdf?.destroy?.(); } catch { /* release is best effort */ }
  }
}

export async function extractPdfText(input, options = {}) {
  return extractPdfPages(input, options);
}

export async function extractDocxText(input) {
  const bytes = asBytes(input);
  const validation = validateDocxZip(bytes);
  if (!validation.ok) return validation;
  try {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ arrayBuffer: bytes.slice().buffer });
    const text = result.value.trim();
    return text ? success(text) : fail('EMPTY_TEXT');
  } catch {
    return fail('DOCX_EXTRACTION_FAILED');
  }
}

export async function extractBrowserDocument(input, type, options = {}) {
  const normalized = String(type || '').toLowerCase().replace(/^.*\./, '');
  if (normalized === 'pdf') return extractPdfText(input, options);
  if (normalized === 'docx') return extractDocxText(input);
  return fail('UNSUPPORTED_TYPE');
}

export const limits = Object.freeze({ PDF_MAX_PAGES, DOCX_MAX_ENTRIES, DOCX_MAX_UNCOMPRESSED, DOCX_MAX_NAME_LENGTH });
