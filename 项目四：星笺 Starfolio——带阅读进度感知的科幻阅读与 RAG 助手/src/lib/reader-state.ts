export type Anchor = { blockKey: string; order: number; label: string; heading: boolean };
export type Progress = {
  currentBlockKey: string; currentOrder: number; furthestBlockKey: string; furthestOrder: number;
  contentVersion: string; updatedAt: string; status?: string;
};
export type Bookmark = { id: string; blockKey: string; contentVersion: string; note: string; status?: string };
export type ReaderIdentity = { workKey: string; issueWorkKey: string; contentVersion: string };
export function localKey(part: string) { return `starfolio:guest:${part}`; }
export function readerUrl(part: string, version: string, block?: string) {
  return `/read/${encodeURIComponent(part)}?v=${encodeURIComponent(version)}${block ? `#${encodeURIComponent(block)}` : ''}`;
}
export function readLocal(part: string): { progress: Progress | null; bookmarks: Bookmark[] } {
  try {
    const data = JSON.parse(localStorage.getItem(localKey(part)) || '{}');
    const p = data.progress;
    return {
      progress: p && typeof p.currentBlockKey === 'string' && typeof p.furthestBlockKey === 'string' && typeof p.contentVersion === 'string' && Number.isSafeInteger(p.currentOrder) && Number.isSafeInteger(p.furthestOrder) ? p : null,
      bookmarks: Array.isArray(data.bookmarks) ? data.bookmarks.filter((b: Bookmark) => b && typeof b.id === 'string' && typeof b.blockKey === 'string' && typeof b.contentVersion === 'string' && typeof b.note === 'string') : [],
    };
  } catch { return { progress: null, bookmarks: [] }; }
}
export async function readerRequest(path: string, init?: RequestInit) {
  const response = await fetch(path, { cache: 'no-store', ...init });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw Object.assign(new Error(data?.error?.message || '请求失败，请重试。'), { code: data?.error?.code, status: response.status });
  return data;
}
