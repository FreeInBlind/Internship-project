'use client';

import { useEffect, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { readLocal, readerRequest, readerUrl, type Progress, type ReaderIdentity } from '@/lib/reader-state';

export function ContinueReading({ workKey, issueWorkKey, contentVersion }: ReaderIdentity) {
  const { data: session, isPending, error } = authClient.useSession();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (isPending) return;
    let live = true;
    setProgress(null);
    setFailed(false);
    if (error) { setFailed(true); return; }
    if (!session) { setProgress(readLocal(issueWorkKey).progress); return; }
    readerRequest(`/api/v1/reading-progress?workId=${encodeURIComponent(workKey)}&issueWorkId=${encodeURIComponent(issueWorkKey)}`).then(data => {
      if (live) setProgress(data.items.find((p: Progress) => p.contentVersion === contentVersion) || data.items[0] || null);
    }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [session?.user.id, isPending, error, workKey, issueWorkKey, contentVersion]);
  const active = progress?.contentVersion === contentVersion;
  return <div className="continue-actions">
    <a className="primary-button" href={readerUrl(issueWorkKey, contentVersion)}>{active ? '继续阅读' : '开始阅读'} <span aria-hidden="true">↗</span></a>
    <small className="muted">{failed ? '进度暂不可用' : active ? `${session ? '云端' : '本机'} · 上次停在第 ${progress.currentOrder} 块` : progress ? '旧版本进度需重新定位' : session ? '云端记录' : '游客 · 本机保存'}</small>
  </div>;
}
