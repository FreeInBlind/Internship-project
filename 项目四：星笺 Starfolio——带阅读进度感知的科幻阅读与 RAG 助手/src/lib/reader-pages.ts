export type PdfPageTarget = {
  pdfPageIndex: number;
  blockKey: string;
};

type PageSourceBlock = {
  blockKey: string;
  order: number;
  source: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function pageIndices(source: unknown) {
  if (!isRecord(source)) return [];
  const segments = Array.isArray(source.segments) ? source.segments : [];
  const indices = segments
    .filter(isRecord)
    .map((segment) => segment.pdf_page_index)
    .filter((page): page is number => typeof page === 'number' && Number.isSafeInteger(page) && page >= 0);
  if (indices.length || segments.length) return indices;
  return Number.isSafeInteger(source.pdf_page_index) && Number(source.pdf_page_index) >= 0
    ? [Number(source.pdf_page_index)]
    : [];
}

export function buildPdfPageNavigation(blocks: PageSourceBlock[]): PdfPageTarget[] {
  const targets = new Map<number, string>();
  for (const block of [...blocks].sort((a, b) => a.order - b.order)) {
    for (const page of pageIndices(block.source)) {
      if (!targets.has(page)) targets.set(page, block.blockKey);
    }
  }
  return [...targets]
    .sort(([a], [b]) => a - b)
    .map(([pdfPageIndex, blockKey]) => ({ pdfPageIndex, blockKey }));
}
