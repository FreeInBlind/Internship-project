import { describe, expect, it, vi } from 'vitest';
import {
  extractBrowserDocument,
  extractPdfText,
  validateDocxZip,
  validatePdfSignature,
} from '../lib/browserDocuments.js';

function bytes(values) { return Uint8Array.from(values); }

function minimalDocx({ required = true } = {}) {
  const names = required ? ['[Content_Types].xml', 'word/document.xml'] : ['word/document.xml'];
  const encoded = names.map((name) => new TextEncoder().encode(name));
  const centralSize = encoded.reduce((sum, name) => sum + 46 + name.length, 0);
  const total = 30 + 1 + centralSize + 22;
  const output = new Uint8Array(total);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(26, 1, true);
  output[30] = 0x78;
  let offset = 31;
  let centralOffset = offset;
  for (const name of encoded) {
    view.setUint32(offset, 0x02014b50, true);
    view.setUint32(offset + 24, 1, true);
    view.setUint16(offset + 28, name.length, true);
    output.set(name, offset + 46);
    offset += 46 + name.length;
  }
  const eocd = offset;
  view.setUint32(eocd, 0x06054b50, true);
  view.setUint16(eocd + 8, names.length, true);
  view.setUint16(eocd + 10, names.length, true);
  view.setUint32(eocd + 12, centralSize, true);
  view.setUint32(eocd + 16, centralOffset, true);
  return output;
}

describe('browser document extraction', () => {
  it('checks PDF magic bytes and rejects malformed input', async () => {
    expect(validatePdfSignature(bytes([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe(true);
    expect(validatePdfSignature(bytes([0x50, 0x4b, 0x03, 0x04]))).toBe(false);
    await expect(extractBrowserDocument(bytes([1, 2]), 'pdf')).resolves.toMatchObject({ ok: false, code: 'INVALID_PDF' });
  });

  it('requires DOCX ZIP signature and required package entries', () => {
    expect(validateDocxZip(bytes([0x50, 0x4b, 0x03, 0x04]))).toMatchObject({ ok: false, code: 'INVALID_DOCX' });
    expect(validateDocxZip(minimalDocx())).toMatchObject({ ok: true, entries: 2 });
    expect(validateDocxZip(new Uint8Array(3 * 1024 * 1024 + 1))).toMatchObject({ ok: false, code: 'INVALID_DOCX' });
    expect(validateDocxZip(minimalDocx({ required: false }))).toMatchObject({ ok: false, code: 'INVALID_DOCX' });
  });

  it('returns stable, redacted errors for unsupported document types', async () => {
    const result = await extractBrowserDocument(new Uint8Array([1]), 'doc');
    expect(result).toEqual({ ok: false, code: 'UNSUPPORTED_TYPE' });
    expect(JSON.stringify(result)).not.toMatch(/Error|stack|path|message/i);
  });

  it('rejects PDFs over five pages before reading a page', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const getPage = vi.fn();
    const pdfjs = {
      GlobalWorkerOptions: {},
      getDocument: vi.fn(() => ({ promise: Promise.resolve({ numPages: 7, getPage, destroy }) })),
    };
    const result = await extractPdfText(new TextEncoder().encode('%PDF-1.7'), {
      pdfjs,
      workerSrc: '/vendor/pdfjs/6.4.299/pdf.worker.mjs',
    });
    expect(result).toEqual({ ok: false, code: 'PDF_TOO_MANY_PAGES' });
    expect(getPage).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('processes pages in order through the page callback before cleanup', async () => {
    const order = [];
    const pages = [1, 2].map((index) => ({
      getTextContent: vi.fn().mockResolvedValue({ items: [{ str: `Page ${index}` }] }),
      cleanup: vi.fn(() => order.push(`cleanup-${index}`)),
    }));
    const destroy = vi.fn().mockResolvedValue(undefined);
    const pdfjs = {
      GlobalWorkerOptions: {},
      getDocument: vi.fn(() => ({ promise: Promise.resolve({ numPages: 2, getPage: vi.fn((n) => Promise.resolve(pages[n - 1])), destroy }) })),
    };
    const result = await extractPdfText(new TextEncoder().encode('%PDF-1.7'), {
      pdfjs,
      workerSrc: '/vendor/pdfjs/6.4.299/pdf.worker.mjs',
      onPage: async ({ pageNumber, text }) => { order.push(`page-${pageNumber}-${text}`); return { pageNumber, text: text.toUpperCase(), ocrUsed: pageNumber === 2 }; },
    });
    expect(result).toMatchObject({ ok: true, pages: [{ pageNumber: 1, text: 'PAGE 1' }, { pageNumber: 2, text: 'PAGE 2', ocrUsed: true }] });
    expect(order).toEqual(['page-1-Page 1', 'cleanup-1', 'page-2-Page 2', 'cleanup-2']);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('extracts every page in a valid five-page PDF and destroys it', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const pages = Array.from({ length: 5 }, (_, index) => ({
      getTextContent: vi.fn().mockResolvedValue({ items: [{ str: `Page ${index + 1}` }] }),
      cleanup: vi.fn(),
    }));
    const pdfjs = {
      GlobalWorkerOptions: {},
      getDocument: vi.fn(() => ({ promise: Promise.resolve({ numPages: 5, getPage: vi.fn((n) => Promise.resolve(pages[n - 1])), destroy }) })),
    };
    const result = await extractPdfText(new TextEncoder().encode('%PDF-1.7'), {
      pdfjs,
      workerSrc: '/vendor/pdfjs/6.4.299/pdf.worker.mjs',
    });
    expect(result).toMatchObject({ ok: true, pagesRead: 5, pageCount: 5, truncated: false });
    expect(result.text).toContain('Page 5');
    expect(destroy).toHaveBeenCalledOnce();
  });
});
