import type { Hit } from './evidence';

export function mergeNamespaceHits(groups: Hit[][], limit = 16) {
  const byId = new Map<string, Hit>();
  for (const hits of groups) {
    for (const hit of hits) {
      if (!hit || typeof hit._id !== 'string' || !Number.isFinite(hit._score)) continue;
      const current = byId.get(hit._id);
      if (!current || hit._score > current._score) byId.set(hit._id, hit);
    }
  }
  return [...byId.values()].sort((a, b) => b._score - a._score).slice(0, limit);
}
