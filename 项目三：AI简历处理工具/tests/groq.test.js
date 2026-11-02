import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeWithGroq, GROQ_ENDPOINT, GroqError, readGroqConfig } from '../lib/groq';

const input = { text: 'Worked on the billing service.', jobTitle: 'Engineer', education: '不便提供', optionalJd: '', salary: '', reportLanguage: 'zh' };
const report = { schemaVersion: 1, reportLanguage: 'zh', overview: '有相关经历。', strengths: ['参与账单服务开发'], issues: [{ evidence: 'Worked on the billing service.', problem: '缺少结果', suggestion: '补充已提供的结果' }], roleFit: { matches: ['工程经验'], gaps: ['信息不足'], limitations: ['未提供职位描述'] }, rewriteExamples: [{ original: 'Worked on the billing service.', suggested: '参与账单服务开发。', notes: '未加入新事实' }] };
const env = { GROQ_API_KEY: 'secret-test-value', GROQ_MODEL: 'openai/gpt-oss-120b', GROQ_UPSTREAM_ENABLED: 'true', GROQ_QUOTA_MIGRATION_ENABLED: 'true' };
function response(content, finishReason = 'stop', status = 200) {
  return { ok: status === 200, status, headers: { get: () => null }, text: async () => JSON.stringify({ choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(content) } }] }) };
}
const tempDirectories = [];
function acceptanceEnv() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stage4a-groq-'));
  tempDirectories.push(directory);
  return { ...env, STAGE4A_ACCEPTANCE: 'true', STAGE4A_BUDGET_FILE: path.join(directory, 'budget.marker') };
}
afterEach(() => { vi.restoreAllMocks(); for (const directory of tempDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

describe('Groq provider', () => {
  it('persists the acceptance claim before fetch and refuses a second fetch', async () => {
    const guarded = acceptanceEnv();
    const fetchImpl = vi.fn(async () => {
      expect(fs.existsSync(guarded.STAGE4A_BUDGET_FILE)).toBe(true);
      return response(report);
    });
    await expect(analyzeWithGroq(input, { env: guarded, fetchImpl })).resolves.toEqual(report);
    await expect(analyzeWithGroq(input, { env: guarded, fetchImpl })).rejects.toMatchObject({ code: 'ACCEPTANCE_BUDGET_SPENT' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each(['network', 'timeout', 'auth', 'invalid-json', 'invalid-report'])('does not refund the acceptance budget after %s', async kind => {
    const guarded = acceptanceEnv();
    const fetchImpl = vi.fn(async () => {
      if (kind === 'network') throw new Error('fixture-key and resume must not escape');
      if (kind === 'timeout') throw Object.assign(new Error('fixture-key'), { name: 'AbortError' });
      if (kind === 'auth') return response(report, 'stop', 401);
      if (kind === 'invalid-json') return { ok: true, status: 200, headers: { get: () => null }, text: async () => 'not-json' };
      return response({ ...report, reportLanguage: 'en' });
    });
    await expect(analyzeWithGroq(input, { env: guarded, fetchImpl })).rejects.toBeInstanceOf(GroqError);
    expect(fs.existsSync(guarded.STAGE4A_BUDGET_FILE)).toBe(true);
    await expect(analyzeWithGroq(input, { env: guarded, fetchImpl })).rejects.toMatchObject({ code: 'ACCEPTANCE_BUDGET_SPENT' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('refuses fetch if the budget cannot be persisted, with a sanitized error', async () => {
    const guarded = { ...acceptanceEnv(), STAGE4A_BUDGET_FILE: 'relative-fixture-secret.marker' };
    const fetchImpl = vi.fn();
    await expect(analyzeWithGroq(input, { env: guarded, fetchImpl })).rejects.toMatchObject({ code: 'ACCEPTANCE_BUDGET_UNAVAILABLE', message: 'ACCEPTANCE_BUDGET_UNAVAILABLE' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('requires explicit server configuration, including migration enablement', () => {
    expect(() => readGroqConfig({ ...env, GROQ_MODEL: '​openai/gpt-oss-120b' })).toThrowError(GroqError);
    expect(() => readGroqConfig({ ...env, GROQ_QUOTA_MIGRATION_ENABLED: 'false' })).toThrowError(GroqError);
  });

  it('uses the fixed endpoint, strict schema, and validates the response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(report));
    await expect(analyzeWithGroq(input, { env, fetchImpl })).resolves.toEqual(report);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][0]).toBe(GROQ_ENDPOINT);
    const request = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(request.model).toBe('openai/gpt-oss-120b');
    expect(request.response_format.json_schema.strict).toBe(true);
    expect(request.stream).toBe(false);
    expect(request.tools).toBeUndefined();
    expect(request.messages[1].content).toContain('billing service');
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer secret-test-value');
  });

  it('bounds streamed response bodies and keeps the timeout active while reading', async () => {
    const large = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(128 * 1024 + 1)); controller.close(); } });
    const oversized = { ok: true, status: 200, headers: { get: () => null }, body: large, text: async () => 'unused' };
    await expect(analyzeWithGroq(input, { env, fetchImpl: vi.fn().mockResolvedValue(oversized) })).rejects.toMatchObject({ code: 'INVALID_UPSTREAM_RESPONSE' });

    const stalled = new ReadableStream({ pull() { return new Promise(() => {}); } });
    const slowResponse = { ok: true, status: 200, headers: { get: () => null }, body: stalled, text: async () => 'unused' };
    await expect(analyzeWithGroq(input, { env, timeoutMs: 5, fetchImpl: vi.fn().mockResolvedValue(slowResponse) })).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' });
  });

  it('rejects invalid citations, truncation, provider auth and timeout with sanitized codes', async () => {
    const bad = { ...report, rewriteExamples: [{ ...report.rewriteExamples[0], original: 'invented quote' }] };
    await expect(analyzeWithGroq(input, { env, fetchImpl: vi.fn().mockResolvedValue(response(bad)) })).rejects.toMatchObject({ code: 'INVALID_REPORT' });
    await expect(analyzeWithGroq(input, { env, fetchImpl: vi.fn().mockResolvedValue(response(report, 'length')) })).rejects.toMatchObject({ code: 'UPSTREAM_TRUNCATED' });
    await expect(analyzeWithGroq(input, { env, fetchImpl: vi.fn().mockResolvedValue(response(report, 'stop', 401)) })).rejects.toMatchObject({ code: 'UPSTREAM_AUTH' });
    await expect(analyzeWithGroq(input, { env, fetchImpl: vi.fn().mockRejectedValue(Object.assign(new Error('secret and resume'), { name: 'AbortError' })) })).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' });
  });
});
