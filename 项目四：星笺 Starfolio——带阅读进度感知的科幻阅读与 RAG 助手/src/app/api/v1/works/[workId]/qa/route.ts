import { randomUUID } from 'node:crypto';
import { api, ApiError, body, checkWriteOrigin, fields, requireUser, text } from '@/lib/api';
import { retrieve, retrieveRecap, sourceFor } from '@/lib/rag/retrieval';
import { generate } from '@/lib/rag/providers';
import { acquireRag } from '@/lib/rag/limits';
import { readSse, type RagMode } from '@/lib/rag-protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();
const frame = (event: string, value: unknown) => `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;

async function handle(request: Request, workIdParam: string) {
  checkWriteOrigin(request);
  const userId = await requireUser(request);
  const input = await body(request);
  fields(input, ['question', 'issueWorkId', 'mode', 'rerank', 'recap']);
  const recap = input.recap === true;
  const question = recap ? (input.question === undefined ? '按正文顺序回顾当前范围。' : text(input.question, 'question', 500).trim()) : text(input.question, 'question', 500).trim();
  const issueWorkId = text(input.issueWorkId, 'issueWorkId', 160);
  const mode = input.mode;
  if (mode !== 'before_current' && mode !== 'read' && mode !== 'full') throw new ApiError(400, 'VALIDATION_ERROR', '阅读范围无效');
  if (typeof input.rerank !== 'boolean') throw new ApiError(400, 'VALIDATION_ERROR', '重排选项无效');
  if (input.recap !== undefined && typeof input.recap !== 'boolean') throw new ApiError(400, 'VALIDATION_ERROR', '回顾选项无效');
  if (recap && input.rerank) throw new ApiError(400, 'VALIDATION_ERROR', '顺序回顾不使用语义重排');
  const workKey = text(decodeURIComponent(workIdParam), 'workId', 160);
  const release = acquireRag(userId);
  const abort = new AbortController();
  const requestId = randomUUID();
  const started = Date.now();
  request.signal.addEventListener('abort', () => abort.abort(request.signal.reason), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, value: unknown) => controller.enqueue(encoder.encode(frame(event, value)));
      void (async () => {
        try {
          const result = recap
            ? await retrieveRecap({ userId, workKey, issueWorkKey: issueWorkId, mode: mode as RagMode })
            : await retrieve(question, abort.signal, { userId, workKey, issueWorkKey: issueWorkId, mode: mode as RagMode, rerank: input.rerank as boolean });
          abort.signal.throwIfAborted();
          const sources = result.evidence.map(sourceFor);
          if (!sources.length) {
            send('sources', { requestId, sources: [], scope: { contentVersion: result.scope.contentVersion, coverage: result.scope.coverage, range: result.scope.range, emptyReason: result.scope.emptyReason } });
            send('done', { requestId, status: 'no_answer', message: result.scope.emptyReason === 'no_progress' ? '当前范围没有已保存的阅读进度；可选择“全文”检索。' : '当前范围内没有找到可用证据。', usage: result.usage, timing: { totalMs: Date.now() - started } });
            return;
          }
          const response = await generate(question, result.evidence.map((item, index) => ({ citationId: sources[index].citationId, text: item.text })), abort.signal, recap);
          if (!response.body) throw new ApiError(502, 'UPSTREAM_ERROR', '生成服务未返回内容流');
          send('sources', { requestId, sources, scope: { contentVersion: result.scope.contentVersion, coverage: result.scope.coverage, range: result.scope.range, emptyReason: result.scope.emptyReason }, ...(recap ? { truncated: 'truncated' in result ? result.truncated : false } : {}) });
          const ids = new Set(sources.map((source) => source.citationId));
          let pending = '';
          let answer = '';
          let held = '';
          let usage: unknown = result.usage;
          let sawDone = false;
          let finishReason: string | null = null;
          const emitText = (value: string) => {
            held += value;
            const candidate = held.trim();
            if ('NO_ANSWER'.startsWith(candidate) || (candidate.startsWith('NO_ANSWER') && candidate.slice('NO_ANSWER'.length).trim() === '')) return;
            const output = held;
            held = '';
            answer += output;
            send('delta', { requestId, text: output });
          };
          for await (const message of readSse(response.body, abort.signal)) {
            if (message.data === '[DONE]') { sawDone = true; break; }
            let payload: any;
            try { payload = JSON.parse(message.data); } catch { throw new ApiError(502, 'UPSTREAM_ERROR', '生成服务返回无效事件'); }
            if (payload.error) throw new ApiError(502, 'UPSTREAM_ERROR', '生成服务暂时不可用');
            if (payload.usage) usage = { ...result.usage, generation: payload.usage };
            const delta = payload.choices?.[0]?.delta?.content;
            if (typeof delta === 'string') {
              pending += delta;
              const open = pending.lastIndexOf('[');
              const close = pending.lastIndexOf(']');
              if (open > close) {
                const safeText = pending.slice(0, open);
                if (safeText) {
                  if (!citationMarkersValid(safeText, ids)) throw new ApiError(502, 'UPSTREAM_ERROR', '生成服务返回了无效引用');
                  emitText(safeText);
                }
                pending = pending.slice(open);
              } else if (pending) {
                if (!citationMarkersValid(pending, ids)) throw new ApiError(502, 'UPSTREAM_ERROR', '生成服务返回了无效引用');
                emitText(pending); pending = '';
              }
            }
            if (payload.choices?.[0]?.finish_reason) finishReason = payload.choices[0].finish_reason;
          }
          if (!sawDone || finishReason === 'length') throw new ApiError(502, 'UPSTREAM_ERROR', '生成内容流未完整结束，请重试');
          if (pending) {
            if (!citationMarkersValid(pending, ids)) throw new ApiError(502, 'UPSTREAM_ERROR', '生成服务返回了无效引用');
            emitText(pending);
          }
          if (held.trim() === 'NO_ANSWER' && !answer.trim()) { answer = 'NO_ANSWER'; held = ''; }
          else if (held) {
            const candidate = held.trimStart().trimEnd();
            if ('NO_ANSWER'.startsWith(candidate)) throw new ApiError(502, 'UPSTREAM_ERROR', '生成服务返回了不完整答案');
            if (!citationMarkersValid(held, ids)) throw new ApiError(502, 'UPSTREAM_ERROR', '生成服务返回了无效引用');
            answer += held;
            send('delta', { requestId, text: held });
          }
          const noAnswer = answer.trim() === 'NO_ANSWER';
          if (noAnswer) answer = '';
          else {
            if (!answer.trim()) throw new ApiError(502, 'UPSTREAM_ERROR', '生成服务返回了空答案');
            if (!citationMarkersPresent(answer, ids) || !answer.replace(/\[(cit_[^\]\s]+)\]/g, '').trim()) {
              throw new ApiError(502, 'UPSTREAM_ERROR', '生成服务返回的答案缺少有效引用或正文');
            }
          }
          send('done', { requestId, status: noAnswer ? 'no_answer' : 'completed', ...(noAnswer ? { message: '当前证据不足以回答这个问题。' } : {}), usage, timing: { totalMs: Date.now() - started } });
        } catch (error) {
          if (!abort.signal.aborted) {
            const known = error instanceof ApiError;
            send('error', { requestId, error: { code: known ? error.code : 'UPSTREAM_ERROR', message: known ? error.message : '检索或生成暂时不可用，请稍后重试', retryable: !known } });
          }
        } finally {
          release();
          try { controller.close(); } catch { /* Client disconnected. */ }
        }
      })();
    },
    cancel(reason) { abort.abort(reason); release(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
}

export async function POST(request: Request, { params }: { params: Promise<{ workId: string }> }) {
  return api(async (request) => handle(request, (await params).workId))(request);
}

function citationMarkersValid(text: string, ids: Set<string>) {
  const bracketed = [...text.matchAll(/\[([^\]\r\n]*)\]/g)].map((match) => match[1]);
  if (bracketed.some((marker) => marker.startsWith('cit_') && (!ids.has(marker) || /\s/.test(marker)))) return false;
  return !/\[cit_[^\]\r\n]*$/.test(text);
}

function citationMarkersPresent(text: string, ids: Set<string>) {
  return [...text.matchAll(/\[(cit_[^\]\s]+)\]/g)].some((match) => ids.has(match[1]));
}
