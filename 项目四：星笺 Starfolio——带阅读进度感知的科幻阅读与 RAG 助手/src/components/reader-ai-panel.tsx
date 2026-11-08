'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { readerUrl, type ReaderIdentity } from '@/lib/reader-state';
import { isRagScope, isRagSource, readSse, type RagMode, type RagScope, type RagSource } from '@/lib/rag-protocol';

export type ReaderAiPanelProps = ReaderIdentity & { onLocate?: (blockKey: string) => void };

type AnswerState = {
  truncated: boolean;
  context: string;
  status: 'idle' | 'streaming' | 'completed' | 'no_answer' | 'stopped' | 'incomplete' | 'error';
  question: string;
  text: string;
  sources: RagSource[];
  scope: RagScope | null;
  message: string;
};

function emptyAnswer(context: string): AnswerState {
  return { context, truncated: false, status: 'idle', question: '', text: '', sources: [], scope: null, message: '' };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scopeDescription(scope: RagScope) {
  const coverage = scope.coverage === 'opening_excerpt'
    ? '仅收录开篇摘录，不代表本期刊载部分或完整作品全文。'
    : '收录范围为本期刊载部分，不代表跨期作品完整。';
  if (scope.range) return `本次服务端范围：第 ${scope.range.startOrder}—${scope.range.endOrder} 个内容块。${coverage}`;
  const reason = scope.emptyReason === 'no_progress' ? '尚无当前版本的云端阅读进度'
    : scope.emptyReason === 'at_start' ? '当前位置在开头，之前没有内容'
    : scope.emptyReason === 'no_content' ? '当前刊载部分暂无可用正文'
    : scope.emptyReason || '当前范围没有可用内容';
  return `本次服务端范围为空：${reason}。${coverage}`;
}

export function ReaderAiPanel({ workKey, issueWorkKey, contentVersion, onLocate }: ReaderAiPanelProps) {
  const { data: session, isPending, error: sessionError } = authClient.useSession();
  const [question, setQuestion] = useState('');
  const [mode, setMode] = useState<RagMode>('before_current');
  const [rerank, setRerank] = useState(true);
  const [recap, setRecap] = useState(false);
  const authKey = !isPending && !sessionError && session ? `${session.user.id}:${session.session.id}` : null;
  const context = JSON.stringify([workKey, issueWorkKey, contentVersion, mode, rerank, recap, authKey, isPending, Boolean(sessionError)]);
  const latestContext = useRef(context);
  latestContext.current = context;
  const sequence = useRef(0);
  const active = useRef<AbortController | null>(null);
  const [answer, setAnswer] = useState<AnswerState>(() => emptyAnswer(context));
  const visible = answer.context === context ? answer : emptyAnswer(context);
  const busy = visible.status === 'streaming';
  const headingId = useId();
  const inputId = useId();

  useEffect(() => {
    sequence.current++;
    active.current?.abort();
    active.current = null;
    setAnswer(emptyAnswer(context));
    return () => { sequence.current++; active.current?.abort(); active.current = null; };
  }, [context]);

  useEffect(() => { setQuestion(''); }, [workKey, issueWorkKey, contentVersion, authKey]);

  function changeRecap(next: boolean) {
    sequence.current++;
    active.current?.abort();
    active.current = null;
    setAnswer(emptyAnswer(context));
    setRecap(next);
    if (next) setRerank(false);
  }

  function changeOptions(nextMode: RagMode, nextRerank: boolean) {
    sequence.current++;
    active.current?.abort();
    active.current = null;
    setAnswer(emptyAnswer(context));
    setMode(nextMode);
    setRerank(nextRerank);
  }

  function stop() {
    sequence.current++;
    active.current?.abort();
    active.current = null;
    setAnswer(previous => previous.context === context
      ? { ...previous, status: 'stopped', message: '已停止。当前内容仅为未完成的部分回答，不代表完整结论。' }
      : previous);
  }

  async function ask() {
    const submitted = recap ? '按正文顺序回顾当前范围。' : question.trim();
    if (!authKey || busy || !submitted || submitted.length > 500) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const requestSequence = ++sequence.current;
    const requestContext = context;
    const current = () => sequence.current === requestSequence && latestContext.current === requestContext && !controller.signal.aborted;
    const update = (patch: Partial<AnswerState>) => {
      if (current()) setAnswer(previous => current() ? { ...previous, ...patch } : previous);
    };
    setAnswer({ ...emptyAnswer(requestContext), question: submitted, status: 'streaming', message: '正在检索当前选择范围内的来源…' });
    let terminal = false;
    let receivedSources = false;
    let requestId: string | null = null;
    let text = '';
    try {
      // readerRequest parses JSON eagerly; QA must keep the response body as a stream.
      const response = await fetch(`/api/v1/works/${encodeURIComponent(workKey)}/qa`, {
        method: 'POST', cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ question: submitted, issueWorkId: issueWorkKey, mode, rerank, recap }),
      });
      if (!current()) { await response.body?.cancel(); return; }
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const detail = object(body) && object(body.error) ? body.error : null;
        throw new Error(detail && typeof detail.message === 'string' ? detail.message
          : response.status === 401 ? '登录已失效，请重新登录后提问。' : '问答请求失败，请重试。');
      }
      if (!response.body || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'text/event-stream') {
        await response.body?.cancel();
        throw new Error('问答响应不是有效的事件流，请重试。');
      }
      for await (const frame of readSse(response.body, controller.signal)) {
        if (!current()) break;
        if (!['sources', 'delta', 'done', 'error'].includes(frame.event)) continue;
        const payload: unknown = JSON.parse(frame.data);
        if (!object(payload) || typeof payload.requestId !== 'string' || !payload.requestId) throw new Error('问答事件格式无效，回答未完成。');
        if (requestId !== null && requestId !== payload.requestId) throw new Error('问答事件身份不一致，回答未完成。');
        requestId = payload.requestId;
        if (frame.event === 'error') {
          if (!object(payload.error) || typeof payload.error.message !== 'string'
            || typeof payload.error.code !== 'string' || typeof payload.error.retryable !== 'boolean') throw new Error('问答错误事件格式无效。');
          terminal = true;
          update({ status: 'error', message: `${payload.error.message}${text ? ' 已显示内容仅为未完成的部分回答。' : ''}` });
          break; // An error is terminal; no done event is required or consumed.
        }
        if (frame.event === 'sources') {
          if (receivedSources || !Array.isArray(payload.sources) || !payload.sources.every(isRagSource) || !isRagScope(payload.scope)
            || new Set(payload.sources.map(source => source.citationId)).size !== payload.sources.length) throw new Error('来源或范围信息无效，回答未完成。');
          receivedSources = true;
          update({ sources: payload.sources, scope: payload.scope, truncated: payload.truncated === true, message: recap ? '正在按正文顺序生成有限范围回顾…' : '正在生成基于这些来源的回答…' });
        } else if (frame.event === 'delta') {
          if (!receivedSources || typeof payload.text !== 'string') throw new Error('回答缺少有效来源信息。');
          text += payload.text;
          if (text.length > 512 * 1024) throw new Error('回答过长，已停止接收；当前内容不完整。');
          update({ text });
        } else {
          if (!receivedSources || (payload.status !== 'completed' && payload.status !== 'no_answer')
            || (payload.message !== undefined && typeof payload.message !== 'string')) throw new Error('问答结束事件格式无效。');
          terminal = true;
          update({ status: payload.status, message: typeof payload.message === 'string' ? payload.message
            : payload.status === 'no_answer' ? '当前阅读范围内没有足够证据，暂时无法回答。' : '回答完成，请结合来源核对。' });
          break;
        }
      }
      if (current() && !terminal) update({ status: 'incomplete', message: '连接已结束，但未收到完成确认。当前内容仅为未完成的部分回答，请重新提问。' });
    } catch (error) {
      if (current()) update({ status: 'error', message: `${error instanceof Error ? error.message : '问答连接失败，请重试。'}${text ? ' 当前显示的部分回答未完成。' : ''}` });
    } finally {
      if (sequence.current === requestSequence) active.current = null;
    }
  }

  return <section className="rag-panel" aria-labelledby={headingId}>
    <h2 id={headingId}>阅读问答</h2>
    <p className="muted">单轮问答，仅使用本次选择并由服务端核验的阅读范围；不会携带旧问题的上下文。</p>
    {isPending ? <p className="muted">正在确认账户…</p>
      : sessionError ? <p role="alert">账户状态获取失败，请刷新后重试。</p>
      : !session ? <p className="muted">问答需要<a href={`/account?returnTo=${encodeURIComponent(readerUrl(issueWorkKey, contentVersion))}`}>登录 / 注册</a>。游客本机进度不用于问答范围。</p> : null}
    <label className="field-label">回答范围
      <select value={mode} onChange={event => changeOptions(event.target.value as RagMode, rerank)}>
        <option value="before_current">当前位置之前（不含当前位置）</option>
        <option value="read">已读范围（云端最远已读）</option>
        <option value="full">当前刊载部分全部已收录内容（可能剧透）</option>
      </select>
    </label>
    <p className="muted">“全部已收录内容”不代表整部作品；开篇摘录不会扩展为全文。当前位置与已读边界以服务端保存的进度为准。</p>
    <label className="field-label">问答方式
      <select value={recap ? 'recap' : 'qa'} onChange={event => changeRecap(event.target.value === 'recap')}>
        <option value="qa">当前范围内提问</option>
        <option value="recap">按正文顺序回顾当前范围</option>
      </select>
    </label>
    <p className="muted">顺序回顾最多使用 48 个正文块、10,000 个字符；范围更长时只回顾前段并明确标示。</p>
    <label className="field-label">结果重排
      <select value={rerank ? 'on' : 'off'} disabled={recap} onChange={event => changeOptions(mode, event.target.value === 'on')}>
        <option value="on">开启重排</option><option value="off">关闭重排</option>
      </select>
    </label>
    <label className="field-label" htmlFor={inputId}>你的问题</label>
    <textarea id={inputId} rows={3} maxLength={500} value={question} onChange={event => setQuestion(event.target.value)} placeholder={recap ? '可选：指定关注的人物或情节' : '想问哪些情节或设定？'} disabled={!authKey || busy || recap} />
    <div className="rag-actions">
      <button type="button" className="primary-button" onClick={() => { void ask(); }} disabled={!authKey || busy || (!recap && !question.trim())}>提问</button>
      {busy && <button type="button" className="quiet-button" onClick={stop}>停止回答</button>}
    </div>
    {visible.scope && <p className="muted">{scopeDescription(visible.scope)}</p>}
    {visible.status !== 'idle' && <div className="rag-answer" aria-busy={busy}>
      <p><strong>本次问题</strong> {visible.question}</p>
      {visible.text && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{visible.text}</p>}
      {visible.truncated && <p role="status">当前范围超过回顾上限；本次只覆盖按正文顺序读取的前段。</p>}
      <p role={visible.status === 'error' || visible.status === 'incomplete' ? 'alert' : 'status'}>{visible.message}</p>
    </div>}
    {visible.scope && <div className="rag-sources">
      <h3>本次来源 · {visible.sources.length}</h3>
      {visible.sources.length === 0 && <p className="muted">服务端未提供可用来源；不会生成或补造来源卡片。</p>}
      {visible.sources.map(source => <article key={source.citationId}>
        <h4>[{source.citationId}]{source.title ? ` ${source.title}` : ''}</h4>
        <p className="muted">PDF 第 {source.pdfPageStart + 1}{source.pdfPageEnd !== source.pdfPageStart ? `—${source.pdfPageEnd + 1}` : ''} 页
          {source.printedPageStart !== null && <> · 印刷页 {source.printedPageStart}{source.printedPageEnd !== null && source.printedPageEnd !== source.printedPageStart ? `—${source.printedPageEnd}` : ''}</>}
        </p>
        <p className="muted">来源短摘录（并非全文）</p>
        <blockquote style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{source.excerpt}</blockquote>
        <a className="quiet-button" href={readerUrl(source.location.issueWorkId, source.location.contentVersion, source.location.paragraphKey)} onClick={event => {
          if (onLocate && source.location.issueWorkId === issueWorkKey && source.location.contentVersion === contentVersion
            && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
            event.preventDefault();
            onLocate(source.location.paragraphKey);
          }
        }}>{source.location.issueWorkId === issueWorkKey && source.location.contentVersion === contentVersion ? '定位原文' : '打开来源版本原文'}</a>
      </article>)}
    </div>}
  </section>;
}
