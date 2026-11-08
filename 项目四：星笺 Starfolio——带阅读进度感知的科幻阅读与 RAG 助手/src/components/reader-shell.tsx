'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AccountMenu } from './account-menu';
import { ReaderAiPanel } from './reader-ai-panel';
import { authClient } from '@/lib/auth-client';
import { localKey, readLocal, readerRequest, readerUrl, type Anchor, type Bookmark, type Progress, type ReaderIdentity } from '@/lib/reader-state';
import type { PdfPageTarget } from '@/lib/reader-pages';

type Props = ReaderIdentity & { anchors: Anchor[]; pages: PdfPageTarget[]; children: ReactNode };

export function ReaderShell({ workKey, issueWorkKey, contentVersion, anchors, pages, children }: Props) {
  const { data: session, isPending, error: sessionError } = authClient.useSession();
  const [ready, setReady] = useState(false);
  const [panel, setPanel] = useState<'contents' | 'bookmarks' | 'settings' | 'ai' | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [status, setStatus] = useState('正在加载阅读记录…');
  const [notice, setNotice] = useState('');
  const [bookmarkError, setBookmarkError] = useState('');
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [note, setNote] = useState('');
  const [settings, setSettings] = useState({ fontSize: 19, lineHeight: 2, theme: 'dark' });
  const [scope, setScope] = useState('before_current');
  const current = useRef<Progress | null>(null);
  const markRef = useRef<Bookmark[]>([]);
  const saveNow = useRef<() => void>(() => {});
  const jumpTo = useRef<(key: string) => void>(() => {});
  const explicitRead = useRef<() => void>(() => {});
  const anchorList = useRef(anchors);
  const byKey = useRef(new Map(anchors.map((a, index) => [a.blockKey, { ...a, index }])));

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem('starfolio:settings') || 'null');
      if (s) setSettings({ fontSize: Math.max(16, Math.min(26, Number(s.fontSize) || 19)), lineHeight: Math.max(1.5, Math.min(2.6, Number(s.lineHeight) || 2)), theme: ['dark', 'paper', 'light'].includes(s.theme) ? s.theme : 'dark' });
    } catch { /* Storage can be disabled by the browser. */ }
  }, []);

  useEffect(() => {
    if (isPending) return;
    let live = true, initialized = false, saving = false, blocked = false, frame = 0;
    let leaveRequested = false, retryCount = 0;
    let revision: string | null = null, saved = '', jumped = false, lastScrollY = window.scrollY;
    let timer: ReturnType<typeof setTimeout> | undefined;
    current.current = null;
    markRef.current = [];
    setReady(false); setProgress(null); setBookmarks([]); setNotice('');
    const query = `workId=${encodeURIComponent(workKey)}&issueWorkId=${encodeURIComponent(issueWorkKey)}`;
    const signature = (p: Progress) => `${p.currentBlockKey}:${p.furthestBlockKey}`;
    let latest: Progress | null = null;
    const publish = (p: Progress) => { latest = p; current.current = p; if (live) setProgress(p); };
    const payload = (p: Progress) => ({ workId: workKey, issueWorkId: issueWorkKey, contentVersion, blockKey: p.currentBlockKey, advanceRead: false, readThroughBlockKey: p.furthestBlockKey, expectedUpdatedAt: revision });

    async function flush(leaving = false) {
      const p = latest;
      if ((!initialized && !leaveRequested) || !p || blocked || signature(p) === saved) return;
      if (saving) { if (leaving) leaveRequested = true; return; }
      if (!session) {
        try {
          localStorage.setItem(localKey(issueWorkKey), JSON.stringify({ progress: p, bookmarks: markRef.current }));
          saved = signature(p);
          if (live) setStatus('已保存在本机');
        } catch { if (live) setStatus('本机保存失败，请检查浏览器存储权限'); }
        return;
      }
      saving = true;
      let retry = false;
      if (live) setStatus('正在保存云端进度…');
      try {
        const data = await readerRequest('/api/v1/reading-progress', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload(p)), keepalive: leaving });
        revision = data.progress.updatedAt;
        saved = signature(p);
        retryCount = 0;
        if (live) setStatus('已保存至云端');
      } catch (error) {
        const e = error as Error & { code?: string; status?: number };
        retry = (e.status === undefined || e.status === 429 || e.status >= 500) && retryCount < 2;
        if (live) setStatus(`${e.message}${retry ? '；将自动重试保存' : '；进度尚未保存，可点击“保存进度”重试'}`);
        if (['PROGRESS_CONFLICT', 'CONTENT_VERSION_MISMATCH', 'UNAUTHENTICATED'].includes(e.code || '')) {
          blocked = true;
          if (live) setNotice('记录或登录状态已变化，已暂停保存。请刷新读取最新记录。');
        }
      } finally {
        saving = false;
        if (!blocked && latest && signature(latest) !== saved) {
          if (leaveRequested && signature(latest) !== signature(p)) { initialized = true; leaveRequested = false; void flush(true); }
          else if (live && !leaving && !timer && (retry || signature(latest) !== signature(p))) {
            const delay = retry ? 3000 * 2 ** retryCount++ : 3000;
            timer = setTimeout(() => { timer = undefined; void flush(); }, delay);
          }
        }
      }
    }
    saveNow.current = () => { retryCount = 0; if (timer) clearTimeout(timer); timer = undefined; void flush(); };
    function schedule() {
      if (!timer) timer = setTimeout(() => { timer = undefined; void flush(); }, 3500);
    }
    function update(key: string, forceRead = false, continuousScroll = false) {
      const anchor = byKey.current.get(key);
      const p = current.current;
      if (!initialized || !anchor || !p) return;
      const edge = byKey.current.get(p.furthestBlockKey);
      if (anchor.order <= p.furthestOrder) jumped = false;
      const advances = forceRead || (!jumped && (anchor.index <= (edge?.index ?? 0) + 1 || (continuousScroll && p.currentOrder <= p.furthestOrder)));
      const next = { ...p, currentBlockKey: key, currentOrder: anchor.order, updatedAt: new Date().toISOString() };
      if (advances && anchor.order > p.furthestOrder) { next.furthestBlockKey = key; next.furthestOrder = anchor.order; }
      if (signature(next) !== signature(p)) {
        publish(next);
        history.replaceState(null, '', readerUrl(issueWorkKey, contentVersion, key));
        if (!session) void flush(); else schedule();
      }
    }
    function jump(key: string) {
      const target = document.getElementById(key);
      if (!target || !byKey.current.has(key)) { setNotice('这个锚点已失效。可用目录重新定位，或从头阅读。'); return; }
      jumped = !!current.current && byKey.current.get(key)!.order > current.current.furthestOrder;
      update(key);
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
      lastScrollY = window.scrollY;
      history.replaceState(null, '', readerUrl(issueWorkKey, contentVersion, key));
      setPanel(null);
    }
    jumpTo.current = jump;
    explicitRead.current = () => { const p = current.current; if (p) { jumped = false; update(p.currentBlockKey, true); void flush(); } };
    function observePosition() {
      if (!initialized || document.visibilityState === 'hidden') return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const elements = Array.from(document.querySelectorAll<HTMLElement>('[data-reader-block]'));
        const visible = elements.find(el => el.getBoundingClientRect().bottom > 150);
        const continuous = Math.abs(window.scrollY - lastScrollY) <= window.innerHeight * 1.25;
        lastScrollY = window.scrollY;
        const visibleAnchor = visible ? byKey.current.get(visible.id) : undefined;
        if (!continuous && current.current && visibleAnchor && visibleAnchor.order > current.current.furthestOrder) jumped = true;
        if (visible) update(visible.id, false, continuous);
      });
    }
    function intercept(event: MouseEvent) {
      const a = (event.target as HTMLElement).closest<HTMLAnchorElement>('a');
      if (!a || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
      const url = new URL(a.href, location.href);
      if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search && url.hash) {
        event.preventDefault();
        try { jump(decodeURIComponent(url.hash.slice(1))); } catch { setNotice('链接锚点无效。'); }
      }
    }
    function hashChange() { try { if (location.hash) jump(decodeURIComponent(location.hash.slice(1))); } catch { setNotice('链接锚点无效。'); } }
    function leaving() { if (timer) clearTimeout(timer); timer = undefined; leaveRequested = true; void flush(true); }
    function visibility() {
      if (document.visibilityState === 'hidden') leaving();
      else { leaveRequested = false; if (initialized && latest && signature(latest) !== saved) schedule(); }
    }

    async function initialize() {
      if (sessionError) { setStatus('账户状态读取失败，请刷新重试'); return; }
      try {
        let record: Progress | null = null;
        if (session) {
          const data = await readerRequest(`/api/v1/reading-progress?${query}`);
          record = data.items.find((p: Progress) => p.contentVersion === contentVersion) || null;
          if (!record && data.items.length && live) setNotice('已有旧版本进度，需要重新定位；当前从头开始。');
          revision = record?.updatedAt ?? null;
        } else {
          const data = readLocal(issueWorkKey);
          record = data.progress?.contentVersion === contentVersion ? data.progress : null;
          markRef.current = data.bookmarks;
          if (live) setBookmarks(data.bookmarks);
          if (data.progress && !record && live) setNotice('本机记录属于旧内容版本，需要重新定位。');
        }
        if (!live) return;
        if (record && (!byKey.current.has(record.currentBlockKey) || !byKey.current.has(record.furthestBlockKey))) {
          setNotice('保存的锚点已失效，已暂停保存。可从书库重新打开正文。'); blocked = true; record = null;
        }
        const first = anchorList.current[0];
        if (!first) return;
        const p = record || { currentBlockKey: first.blockKey, currentOrder: first.order, furthestBlockKey: first.blockKey, furthestOrder: first.order, contentVersion, updatedAt: new Date().toISOString() };
        publish(p); saved = record ? signature(p) : '';
        initialized = true;
        const hash = location.hash;
        if (hash) { try { jump(decodeURIComponent(hash.slice(1))); } catch { setNotice('链接锚点无效。'); } }
        else if (record) jump(record.currentBlockKey);
        setReady(true); setStatus(session ? '云端记录已加载' : '游客 · 阅读记录保存在本机');
        if (session) {
          try {
            let cursor: string | null = null;
            const all: Bookmark[] = [];
            do {
              const data = await readerRequest(`/api/v1/bookmarks?${query}${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`);
              all.push(...data.items); cursor = data.nextCursor;
            } while (cursor && live);
            if (live) { markRef.current = all; setBookmarks(all); }
          } catch { if (live) setBookmarkError('书签加载失败，请刷新重试。'); }
        }
      } catch { if (live) setStatus('阅读记录加载失败，保存已暂停。请刷新重试。'); }
    }
    void initialize();
    window.addEventListener('scroll', observePosition, { passive: true });
    window.addEventListener('hashchange', hashChange);
    document.addEventListener('click', intercept);
    window.addEventListener('pagehide', leaving);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      leaving(); live = false; initialized = false;
      if (timer) clearTimeout(timer);
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', observePosition); window.removeEventListener('hashchange', hashChange);
      document.removeEventListener('click', intercept); window.removeEventListener('pagehide', leaving); document.removeEventListener('visibilitychange', visibility);
    };
  }, [isPending, session?.user.id, sessionError, workKey, issueWorkKey, contentVersion]);

  useEffect(() => {
    if (!panel || !window.matchMedia('(max-width: 850px)').matches) return;
    const previous = document.activeElement as HTMLElement | null;
    const drawer = document.getElementById('reader-panel');
    const controls = () => Array.from(drawer?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, textarea, select') || []);
    controls()[0]?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') setPanel(null);
      if (event.key === 'Tab') {
        const items = controls(), first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = overflow; previous?.focus(); };
  }, [panel]);

  function changeSettings(next: typeof settings) {
    setSettings(next);
    try { localStorage.setItem('starfolio:settings', JSON.stringify(next)); } catch { setNotice('设置仅在本次页面生效，浏览器未允许本机保存。'); }
  }
  async function saveBookmark(remove?: Bookmark) {
    if (!ready || bookmarkBusy || !current.current) return;
    setBookmarkBusy(true); setBookmarkError('');
    try {
      let next: Bookmark[];
      if (session) {
        if (remove) { await readerRequest(`/api/v1/bookmarks/${encodeURIComponent(remove.id)}`, { method: 'DELETE' }); next = markRef.current.filter(b => b.id !== remove.id); }
        else {
          const data = await readerRequest('/api/v1/bookmarks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workId: workKey, issueWorkId: issueWorkKey, contentVersion, blockKey: current.current.currentBlockKey, note }) });
          next = [...markRef.current.filter(b => b.id !== data.bookmark.id), data.bookmark];
        }
      } else {
        next = remove ? markRef.current.filter(b => b.id !== remove.id) : markRef.current.some(b => b.blockKey === current.current!.currentBlockKey && b.contentVersion === contentVersion) ? markRef.current : [...markRef.current, { id: crypto.randomUUID(), blockKey: current.current.currentBlockKey, contentVersion, note }];
        localStorage.setItem(localKey(issueWorkKey), JSON.stringify({ progress: current.current, bookmarks: next }));
      }
      markRef.current = next; setBookmarks(next); setNote('');
    } catch (error) { setBookmarkError((error as Error).message || '书签未保存，请重试。'); }
    finally { setBookmarkBusy(false); }
  }
  const active = byKey.current.get(progress?.currentBlockKey || '');
  const percent = active ? Math.round(((active.index + 1) / anchors.length) * 100) : 0;
  const headings = anchors.filter(a => a.heading);
  return <div className={`reader-app theme-${settings.theme}`} style={{ '--reader-size': `${settings.fontSize}px`, '--reader-leading': settings.lineHeight } as CSSProperties}>
    <header className="reader-header"><a className="brand" href="/">✦ 星笺</a><a className="quiet-button" href="/">← 书库</a><AccountMenu /></header>
    <nav className="reader-toolbar" aria-label="阅读工具">
      {([['contents', '目录'], ['bookmarks', '书签'], ['settings', '设置'], ['ai', 'AI 讨论']] as const).map(([id, label]) => <button key={id} type="button" aria-expanded={panel === id} aria-controls="reader-panel" onClick={() => setPanel(panel === id ? null : id)}>{label}{id === 'bookmarks' && ` ${bookmarks.length}`}</button>)}
      <span className="position-label">{ready ? `当前位置 ${percent}% · 第 ${progress?.currentOrder} 块` : '加载记录中'}</span>
    </nav>
    {notice && <div className="reader-notice" role="alert">{notice} <a href={readerUrl(issueWorkKey, contentVersion)}>从头打开</a></div>}
    <div className="reader-layout">
      {panel && <div className="drawer-backdrop" onClick={() => setPanel(null)} />}
      <aside id="reader-panel" className={`reader-panel ${panel ? 'is-open' : ''}`} aria-label="阅读面板">
        <div className="panel-heading"><h2>{panel === 'bookmarks' ? '我的书签' : panel === 'settings' ? '阅读设置' : panel === 'ai' ? 'AI 讨论' : '阅读导航'}</h2><button className="close-panel" onClick={() => setPanel(null)} aria-label="关闭面板">✕</button></div>
        {(!panel || panel === 'contents') && <>
          <h3>PDF 页码</h3>
          {pages.length ? <div className="page-grid">{pages.map(page => <button key={page.pdfPageIndex} disabled={!ready} onClick={() => jumpTo.current(page.blockKey)} aria-label={`定位到 PDF 第 ${page.pdfPageIndex + 1} 页的对应段落`}>{page.pdfPageIndex + 1}</button>)}</div> : <p className="muted small">当前收录内容没有可定位的 PDF 页码。</p>}
          <p className="muted small">仅列出当前文章已收录且有正文锚点的页面；跨页段落定位到段首。</p>
          <h3>章节</h3>
          <p className="muted small">{headings.length ? '章节候选 · 按原文平铺' : '当前文章无已识别章节'}</p>
          <div className="chapter-list">{headings.map(a => <button key={a.blockKey} disabled={!ready} onClick={() => jumpTo.current(a.blockKey)}>{a.label}</button>)}</div>
          <p className="muted small">目录和书签跳转只移动当前位置，不会自动扩展已读范围。</p>
        </>}
        {panel === 'bookmarks' && <>
          <p className="muted small">{session ? '书签保存至当前账户' : '游客书签仅保存在本机'}。重复添加同一段不会覆盖短注。</p>
          <label className="field-label">短注（可选）<textarea value={note} maxLength={500} rows={2} onChange={e => setNote(e.target.value)} /></label>
          <button className="primary-button" disabled={!ready || bookmarkBusy} onClick={() => void saveBookmark()}>保存当前位置</button>
          {bookmarkError && <p role="alert" className="error-text">{bookmarkError}</p>}
          {!bookmarks.length && <p className="muted">还没有书签，留住一段线索吧。</p>}
          <ul className="bookmark-list">{bookmarks.map(b => {
            const a = byKey.current.get(b.blockKey);
            const valid = b.contentVersion === contentVersion && !!a && b.status !== 'needs_relocation';
            return <li key={b.id}>{valid ? <button className="bookmark-location" onClick={() => jumpTo.current(b.blockKey)}>{a.label}</button> : <p>旧版本或失效锚点 · 需重新定位</p>}{b.note && <p>{b.note}</p>}<button className="quiet-button" disabled={bookmarkBusy} onClick={() => void saveBookmark(b)}>删除书签</button></li>;
          })}</ul>
        </>}
        {panel === 'settings' && <>
          <label className="setting-label">字号 <span>{settings.fontSize}px</span><input aria-label="字号" type="range" min={16} max={26} value={settings.fontSize} onChange={e => changeSettings({ ...settings, fontSize: Number(e.target.value) })} /></label>
          <label className="setting-label">行距 <span>{settings.lineHeight.toFixed(1)}</span><input aria-label="行距" type="range" min={1.5} max={2.6} step={0.1} value={settings.lineHeight} onChange={e => changeSettings({ ...settings, lineHeight: Number(e.target.value) })} /></label>
          <div className="theme-options">{[['dark', '深夜'], ['paper', '纸页'], ['light', '明亮']].map(([theme, label]) => <button key={theme} aria-pressed={settings.theme === theme} onClick={() => changeSettings({ ...settings, theme })}>{label}</button>)}</div>
          <p className="muted small">设置保存在当前浏览器，登录后继续沿用。</p>
        </>}
        {panel === 'ai' && <ReaderAiPanel workKey={workKey} issueWorkKey={issueWorkKey} contentVersion={contentVersion} onLocate={blockKey => jumpTo.current(blockKey)} />}
      </aside>
      <main className="reader-main">{children}</main>
      <aside className="reader-context"><span className="eyebrow">READING COMPANION</span><h2>让故事慢慢展开</h2><p>在当前阅读范围内检索，并回到原文核对。</p><p className="small">打开 AI 讨论面板，提问并查看带页码来源的回答。</p></aside>
    </div>
    <footer className="reading-status"><span role="status">{status}</span><span>最远已读：第 {progress?.furthestOrder ?? '—'} 块</span>{progress && progress.currentOrder > progress.furthestOrder && <button disabled={!ready} onClick={() => explicitRead.current()}>将当前位置及之前标为已读</button>}<button disabled={!ready} onClick={() => saveNow.current()}>保存进度</button></footer>
  </div>;
}
