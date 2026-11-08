import 'server-only';

import { ApiError } from '@/lib/api';
import { getEvidenceBlocks, getOrderedEvidenceBlocks } from '@/db/rag';
import { getReadingRange, type ReadingRangeMode } from '@/db/user-reading';
import { createHash } from 'node:crypto';
import type { RagSource } from '@/lib/rag-protocol';
import { namespaceFor } from './config';
import { embedQuery, rerank, search } from './providers';
import { packEvidence, packOrderedEvidence, rerankEvidence, validateEvidence, type Evidence, type Hit, type Scope } from './evidence';

export async function hydrate(hits: Hit[], scope?: Scope) {
  const safeHits = hits.filter((hit) => hit && typeof hit.block_key === 'string' && hit._score >= 0.25);
  const blocks = await getEvidenceBlocks(safeHits.map((hit) => hit.block_key));
  const byKey = new Map(blocks.map((block) => [block.blockKey, block]));
  return safeHits.flatMap((hit) => { const block = byKey.get(hit.block_key); const item = block && validateEvidence(hit, block, scope); return item ? [item] : []; });
}

export async function retrieve(question: string, signal: AbortSignal, options: { userId: string; workKey: string; issueWorkKey: string; mode: ReadingRangeMode; rerank: boolean }) {
  let scope = await getReadingRange(options.userId, options.workKey, options.issueWorkKey, options.mode);
  const usage: { embeddingTokens: number | null; rerankUnits: number | null } = { embeddingTokens: null, rerankUnits: null };
  if (!scope.range) return { scope, evidence: [] as Evidence[], usage };
  const namespace = namespaceFor(scope.issueWorkKey, scope.contentVersion);
  if (!namespace) throw new ApiError(503, 'UPSTREAM_ERROR', '当前内容尚未建立可用检索索引');
  const query = await embedQuery(question, signal); usage.embeddingTokens = query.tokens;
  const hits = await search(query.vector, { work_key: { $eq: scope.workKey }, issue_work_key: { $eq: scope.issueWorkKey },
    content_version: { $eq: scope.contentVersion }, block_order: { $gte: scope.range.startOrder, $lte: scope.range.endOrder } }, signal, namespace);
  const recheck = async () => {
    const next = await getReadingRange(options.userId, options.workKey, options.issueWorkKey, options.mode);
    if (next.contentVersion !== scope.contentVersion) throw new ApiError(409, 'CONTENT_VERSION_MISMATCH', '正文已更新，请刷新后重新提问');
    const range = scope.range && next.range
      ? next.range.endOrder <= scope.range.endOrder
        ? next.range
        : { ...next.range, endOrder: scope.range.endOrder, endBlockKey: scope.range.endBlockKey }
      : null;
    scope = { ...next, range } as typeof scope;
    return hydrate(hits, scope);
  };
  let evidence = await recheck();
  if (options.rerank && evidence.length) {
    const ranked = await rerank(question, evidence.map((item) => item.text), signal); usage.rerankUnits = ranked.units;
    evidence = rerankEvidence(evidence, ranked.results).filter((item) => item.rankScore >= 0.1);
  }
  const fresh = new Map((await recheck()).map((item) => [item.hit._id, item]));
  evidence = evidence.flatMap((item) => { const current = fresh.get(item.hit._id); return current ? [{ ...current, rankScore: item.rankScore }] : []; });
  return { scope, evidence: packEvidence(evidence), usage };
}

export async function retrieveRecap(options: { userId: string; workKey: string; issueWorkKey: string; mode: ReadingRangeMode }) {
  const scope = await getReadingRange(options.userId, options.workKey, options.issueWorkKey, options.mode);
  const usage = { embeddingTokens: null, rerankUnits: null };
  if (!scope.range) return { scope, evidence: [] as Evidence[], truncated: false, usage };
  const latest = await getReadingRange(options.userId, options.workKey, options.issueWorkKey, options.mode);
  if (latest.contentVersion !== scope.contentVersion) throw new ApiError(409, 'CONTENT_VERSION_MISMATCH', '正文已更新，请刷新后重新提问');
  if (!latest.range) return { scope: { ...latest, range: null }, evidence: [] as Evidence[], truncated: false, usage };
  const startOrder = Math.max(scope.range.startOrder, latest.range.startOrder);
  const endOrder = Math.min(scope.range.endOrder, latest.range.endOrder);
  if (startOrder > endOrder) return { scope: { ...latest, range: null }, evidence: [] as Evidence[], truncated: false, usage };
  const allowed = { ...latest, range: {
    ...latest.range, startOrder, endOrder,
    startBlockKey: startOrder === latest.range.startOrder ? latest.range.startBlockKey : scope.range.startBlockKey,
    endBlockKey: endOrder === latest.range.endOrder ? latest.range.endBlockKey : scope.range.endBlockKey,
  } };
  const rows = await getOrderedEvidenceBlocks({ issueWorkKey: scope.issueWorkKey, contentVersion: scope.contentVersion,
    startOrder, endOrder, limit: 49 });
  const evidence: Evidence[] = rows.flatMap((block) => {
    const digest = createHash('sha256').update(block.text).digest('hex');
    if (digest !== block.contentHash || !block.source || !Array.isArray(block.source.segments) || !block.source.segments.length) return [];
    const stableId = `sf-${createHash('sha256').update(JSON.stringify([block.issueWorkKey, block.contentVersion, block.blockKey,
      0, block.text.length, 'body-block-v1', 'exact-block-text-v1', 'embed-multilingual-v3.0', 1024])).digest('hex')}`;
    const item: Evidence = { hit: { _id: stableId, _score: 1, work_key: block.workKey,
      issue_work_key: block.issueWorkKey, content_version: block.contentVersion, block_key: block.blockKey,
      block_order: block.order, span_start: 0, span_end: block.text.length, text_hash: block.contentHash,
      coverage: block.coverage, embedding_model: 'embed-multilingual-v3.0', chunker_version: 'body-block-v1' },
      block, text: block.text, rankScore: 1 };
    return validateEvidence(item.hit, block, allowed) ? [item] : [];
  });
  const packed = packOrderedEvidence(evidence);
  return { scope: allowed, evidence: packed, truncated: evidence.length > packed.length || rows.length === 49, usage };
}

export function sourceFor(item: Evidence, index: number): RagSource {
  const segments = Array.isArray(item.block.source.segments) ? item.block.source.segments as Record<string, unknown>[] : [];
  const pages = segments.filter((segment) => Number.isSafeInteger(segment.pdf_page_index) && Number(segment.pdf_page_index) >= 0
    && typeof segment.location_key === 'string' && segment.location_key.length > 0);
  if (!pages.length || pages.length !== segments.length) throw new ApiError(502, 'UPSTREAM_ERROR', '证据缺少完整可定位来源');
  const ordered = [...pages].sort((a, b) => Number(a.pdf_page_index) - Number(b.pdf_page_index));
  const first = ordered[0], last = ordered.at(-1)!;
  return { citationId: `cit_${index + 1}`, workId: item.block.workKey, issueId: item.block.issueKey, issueWorkId: item.block.issueWorkKey,
    title: item.block.title, paragraphStart: item.block.blockKey, paragraphEnd: item.block.blockKey,
    pdfPageStart: Number(first.pdf_page_index), pdfPageEnd: Number(last.pdf_page_index),
    printedPageStart: typeof first.printed_page_number === 'string' ? first.printed_page_number : null,
    printedPageEnd: typeof last.printed_page_number === 'string' ? last.printed_page_number : null,
    excerpt: item.text, spanStart: item.hit.span_start, spanEnd: item.hit.span_end,
    sourceSegments: segments.flatMap(segment => Number.isSafeInteger(segment.pdf_page_index) && Number(segment.pdf_page_index) >= 0
      && typeof segment.location_key === 'string' ? [{ pdfPageIndex: Number(segment.pdf_page_index),
        printedPageNumber: typeof segment.printed_page_number === 'string' ? segment.printed_page_number : null,
        locationKey: segment.location_key }] : []),
    location: { issueWorkId: item.block.issueWorkKey, paragraphKey: item.block.blockKey, contentVersion: item.block.contentVersion } };
}
