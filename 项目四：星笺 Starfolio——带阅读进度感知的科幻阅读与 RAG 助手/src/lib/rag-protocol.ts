export type RagMode = 'before_current' | 'read' | 'full';
export type RagCoverage = 'complete_issue_work' | 'opening_excerpt';

export type RagSource = {
  citationId: string;
  workId: string;
  issueId: string;
  issueWorkId: string;
  paragraphStart: string;
  paragraphEnd: string;
  pdfPageStart: number;
  pdfPageEnd: number;
  printedPageStart: string | null;
  printedPageEnd: string | null;
  excerpt: string;
  spanStart: number;
  spanEnd: number;
  sourceSegments: { pdfPageIndex: number; printedPageNumber: string | null; locationKey: string }[];
  location: { issueWorkId: string; paragraphKey: string; contentVersion: string };
  title?: string;
};

export type RagScope = {
  contentVersion: string;
  coverage: RagCoverage;
  range: { startOrder: number; endOrder: number } | null;
  emptyReason: string | null;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isRagSource(value: unknown): value is RagSource {
  if (!record(value) || !record(value.location)) return false;
  return ['citationId', 'workId', 'issueId', 'issueWorkId', 'paragraphStart', 'paragraphEnd'].every(key => nonempty(value[key]))
    && nonnegative(value.pdfPageStart) && nonnegative(value.pdfPageEnd) && value.pdfPageEnd >= value.pdfPageStart
    && (value.printedPageStart === null || typeof value.printedPageStart === 'string')
    && (value.printedPageEnd === null || typeof value.printedPageEnd === 'string')
    && typeof value.excerpt === 'string'
    && nonnegative(value.spanStart) && nonnegative(value.spanEnd) && value.spanEnd >= value.spanStart
    && value.location.issueWorkId === value.issueWorkId
    && nonempty(value.location.paragraphKey) && nonempty(value.location.contentVersion)
    && Array.isArray(value.sourceSegments) && value.sourceSegments.length > 0 && value.sourceSegments.every(segment => record(segment)
      && nonnegative(segment.pdfPageIndex) && (segment.printedPageNumber === null || typeof segment.printedPageNumber === 'string')
      && nonempty(segment.locationKey))
    && (value.title === undefined || typeof value.title === 'string');
}

export function isRagScope(value: unknown): value is RagScope {
  if (!record(value) || !nonempty(value.contentVersion)) return false;
  if (value.coverage !== 'complete_issue_work' && value.coverage !== 'opening_excerpt') return false;
  if (value.emptyReason !== null && typeof value.emptyReason !== 'string') return false;
  return value.range === null || (record(value.range)
    && nonnegative(value.range.startOrder) && value.range.startOrder > 0
    && nonnegative(value.range.endOrder) && value.range.endOrder >= value.range.startOrder);
}

const MAX_SSE_BYTES = 256 * 1024;

/** Parse SSE framing only. The consumer owns application-level terminal events.
 * An unterminated frame at EOF is discarded, as required by SSE framing.
 */
export async function* readSse(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<{ event: string; data: string }> {
  const reader = stream.getReader();
  // Keep BOMs in the decoder; only the first stream BOM may be ignored.
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let line = '';
  let frameBytes = 0;
  let event = 'message';
  let data: string[] = [];
  let hasData = false;
  let skipLf = false;
  let firstLine = true;

  const checkAbort = () => {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  };
  const cancel = () => { void reader.cancel().catch(() => {}); };
  const count = (bytes: number) => {
    frameBytes += bytes;
    if (frameBytes > MAX_SSE_BYTES) throw new Error('SSE 单帧或缓冲区超过 256 KiB。');
  };

  signal?.addEventListener('abort', cancel, { once: true });
  try {
    checkAbort();
    while (true) {
      const chunk = await reader.read();
      checkAbort();
      if (chunk.done) {
        // Validate any trailing UTF-8 without dispatching an unfinished frame.
        decoder.decode();
        return;
      }
      let start = 0;
      for (let index = 0; index < chunk.value.length; index++) {
        const byte = chunk.value[index];
        if (skipLf) {
          skipLf = false;
          if (byte === 10) {
            // CRLF is one line ending but both bytes count inside an open frame.
            if (frameBytes > 0) count(1);
            start = index + 1;
            continue;
          }
        }
        if (byte !== 10 && byte !== 13) continue;
        checkAbort();
        count(index - start + 1);
        line += decoder.decode(chunk.value.subarray(start, index), { stream: true });
        line += decoder.decode();
        start = index + 1;
        skipLf = byte === 13;
        if (firstLine) {
          firstLine = false;
          if (line.startsWith('﻿')) line = line.slice(1);
        }
        const completeLine = line;
        line = '';
        if (completeLine === '') {
          const frame = hasData ? { event, data: data.join('\n') } : null;
          event = 'message';
          data = [];
          hasData = false;
          frameBytes = 0;
          if (frame) yield frame;
        } else if (!completeLine.startsWith(':')) {
          const colon = completeLine.indexOf(':');
          const field = colon < 0 ? completeLine : completeLine.slice(0, colon);
          let value = colon < 0 ? '' : completeLine.slice(colon + 1);
          if (value.startsWith(' ')) value = value.slice(1);
          if (field === 'event') event = value || 'message';
          else if (field === 'data') { data.push(value); hasData = true; }
        }
      }
      count(chunk.value.length - start);
      line += decoder.decode(chunk.value.subarray(start), { stream: true });
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    try { await reader.cancel(); } catch { /* The stream may already be closed or errored. */ }
    reader.releaseLock();
  }
}
