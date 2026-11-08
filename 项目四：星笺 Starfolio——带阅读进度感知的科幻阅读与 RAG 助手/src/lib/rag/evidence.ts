import { createHash } from 'node:crypto';
import { isWaivedReview } from '../acceptance-policy.mjs';

export type Scope = { workKey: string; issueWorkKey: string; contentVersion: string; coverage: string; range: { startOrder: number; endOrder: number } | null };
export type Hit = { _id: string; _score: number; work_key: string; issue_work_key: string; content_version: string; block_key: string; block_order: number; span_start: number; span_end: number; text_hash: string; coverage: string; embedding_model: string; chunker_version: string };
export type Block = { blockKey: string; issueWorkKey: string; contentVersion: string; kind: string; order: number; text: string; contentHash: string; source: Record<string, unknown>; qualityStatus: string; workKey: string; currentVersion: string; coverage: string; issueKey: string; title: string; review?: Record<string, unknown>; sourceFileSha256?: string; humanReviewStatus?: string | null };
export type Evidence = { hit: Hit; block: Block; text: string; rankScore: number };
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

export function validateEvidence(hit: Hit, block: Block, scope?: Scope): Evidence | null {
  if (!hit || !block || !Number.isFinite(hit._score) || block.kind !== 'body'
    || !(block.qualityStatus === 'verified_text' || (block.humanReviewStatus === 'not_reviewed'
      && ['needs_review', 'ocr_uncertain', 'structure_uncertain'].includes(block.qualityStatus)
      && !!block.sourceFileSha256 && isWaivedReview(block.review, { issueWorkKey: block.issueWorkKey,
        contentVersion: block.contentVersion, coverage: block.coverage, sourceFileSha256: block.sourceFileSha256 })
      && Array.isArray(block.source.segments) && block.source.segments.length > 0
      && block.source.segments.every((segment: Record<string, unknown>) => segment.file_sha256 === block.sourceFileSha256)))
    || hit.embedding_model !== 'embed-multilingual-v3.0' || hit.chunker_version !== 'body-block-v1'
    || hit.work_key !== block.workKey || hit.issue_work_key !== block.issueWorkKey || hit.content_version !== block.contentVersion
    || block.contentVersion !== block.currentVersion || hit.coverage !== block.coverage || hit.block_key !== block.blockKey
    || hit.block_order !== block.order || hit.text_hash !== block.contentHash || sha(block.text) !== block.contentHash
    || !Number.isSafeInteger(hit.span_start) || !Number.isSafeInteger(hit.span_end) || hit.span_start < 0
    || hit.span_end <= hit.span_start || hit.span_end > block.text.length) return null;
  if (scope && (!scope.range || scope.workKey !== block.workKey || scope.issueWorkKey !== block.issueWorkKey
    || scope.contentVersion !== block.contentVersion || scope.coverage !== block.coverage
    || block.order < scope.range.startOrder || block.order > scope.range.endOrder)) return null;
  const id = `sf-${sha(JSON.stringify([block.issueWorkKey, block.contentVersion, block.blockKey, hit.span_start, hit.span_end,
    'body-block-v1', 'exact-block-text-v1', 'embed-multilingual-v3.0', 1024]))}`;
  if (hit._id !== id) return null;
  return { hit, block, text: block.text.slice(hit.span_start, hit.span_end), rankScore: hit._score };
}

export function packEvidence(items: Evidence[]) {
  const seen = new Set<string>();
  const output: Evidence[] = [];
  let characters = 0;
  for (const item of items) {
    if (seen.has(item.hit._id) || characters + item.text.length > 2600) continue;
    output.push(item); seen.add(item.hit._id); characters += item.text.length;
    if (output.length === 6) break;
  }
  return output;
}

export function packOrderedEvidence(items: Evidence[], limits = { blocks: 48, characters: 10_000 }) {
  const output: Evidence[] = [];
  let characters = 0;
  const seen = new Set<string>();
  for (const item of items) {
    if (output.length >= limits.blocks) break;
    if (seen.has(item.block.blockKey)) continue;
    if (characters + item.text.length > limits.characters) break;
    output.push(item);
    seen.add(item.block.blockKey);
    characters += item.text.length;
  }
  return output;
}

export function rerankEvidence(items: Evidence[], results: { index: number; relevance_score: number }[]) {
  const seen = new Set<number>();
  return results.map((result) => {
    if (!Number.isSafeInteger(result.index) || result.index < 0 || result.index >= items.length || seen.has(result.index)
      || !Number.isFinite(result.relevance_score) || result.relevance_score < 0 || result.relevance_score > 1) throw new Error('Invalid rerank response');
    seen.add(result.index);
    return { ...items[result.index], rankScore: result.relevance_score };
  }).sort((a, b) => b.rankScore - a.rankScore);
}

export function validateCitations(answer: string, ids: Set<string>) {
  const markers = [...answer.matchAll(/\[(cit_[^\]\s]+)\]/g)].map((match) => match[1]);
  return markers.every((id) => ids.has(id));
}
