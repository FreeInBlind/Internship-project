import { ApiError, api, body, checkWriteOrigin, fields, json, requireUser, text } from '@/lib/api';
import { searchLibrary } from '@/db/reading';
import { getEvidenceBlocks } from '@/db/rag';
import { namespacesForSearch } from '@/lib/rag/config';
import { mergeNamespaceHits } from '@/lib/rag/search-routing';
import { embedQuery, search } from '@/lib/rag/providers';
import { validateEvidence, type Hit } from '@/lib/rag/evidence';
import { sourceFor } from '@/lib/rag/retrieval';
import { acquireRag } from '@/lib/rag/limits';

export const runtime = 'nodejs';
export const POST = api(async (request) => {
  checkWriteOrigin(request);
  const userId = await requireUser(request);
  const input = await body(request);
  fields(input, ['query', 'rerank']);
  const query = text(input.query, 'query', 300).trim();
  if (input.rerank !== false) throw new ApiError(400, 'VALIDATION_ERROR', '找书暂不支持重排');
  const release = acquireRag(userId);
  const abort = new AbortController();
  request.signal.addEventListener('abort', () => abort.abort(request.signal.reason), { once: true });
  try {
    const directMatches = await searchLibrary({ query, limit: 100 });
    const embedded = await embedQuery(query, abort.signal);
    const hits = mergeNamespaceHits(await Promise.all(namespacesForSearch().map((namespace) =>
      search(embedded.vector, undefined, abort.signal, namespace))));
    const blocks = await getEvidenceBlocks(hits.map((hit: Hit) => hit.block_key));
    const byKey = new Map(blocks.map((block) => [block.blockKey, block]));
    const evidence = hits.flatMap((hit: Hit) => {
      const block = byKey.get(hit.block_key);
      const item = block && validateEvidence(hit, block);
      return item ? [item] : [];
    });
    const grouped = new Map<string, (typeof evidence)[number]>();
    for (const item of evidence) {
      const key = `${item.block.issueWorkKey}:${item.block.contentVersion}`;
      const previous = grouped.get(key);
      if (!previous || item.rankScore > previous.rankScore) grouped.set(key, item);
    }
    const directKeys = new Set(directMatches.map(item => `${item.issueWorkKey}:${item.contentVersion}`));
    const items = [...grouped.values()].sort((a, b) => {
      const aDirect = directKeys.has(`${a.block.issueWorkKey}:${a.block.contentVersion}`);
      const bDirect = directKeys.has(`${b.block.issueWorkKey}:${b.block.contentVersion}`);
      return Number(bDirect) - Number(aDirect) || b.rankScore - a.rankScore;
    }).map((item, index) => ({
      matchReason: directKeys.has(`${item.block.issueWorkKey}:${item.block.contentVersion}`) ? '标题或原始署名匹配，且有语义证据' : '语义片段匹配',
      workKey: item.block.workKey,
      issueWorkKey: item.block.issueWorkKey,
      title: item.block.title,
      coverage: item.block.coverage,
      contentVersion: item.block.contentVersion,
      source: sourceFor(item, index),
      score: item.rankScore,
    }));
    return json({ items, message: '结果来自已收录内容的相关片段，并按刊载单元合并；不代表完整书目。' });
  } finally { release(); }
});
