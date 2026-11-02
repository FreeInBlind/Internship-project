import { describe, expect, it } from 'vitest';
import { reportToMarkdown, validateCitations, validateReportInput } from '../lib/reportSchema';

const report = { schemaVersion: 1, reportLanguage: 'zh', overview: '概览', strengths: ['沟通'], issues: [{ evidence: '负责团队管理', problem: '描述缺少结果', suggestion: '补充量化结果' }], roleFit: { matches: [], gaps: ['缺少数据'], limitations: ['信息不足'] }, rewriteExamples: [{ original: '负责团队管理', suggested: '管理5人团队', notes: '需确认事实' }] };
describe('report schema', () => {
  it('validates structure, language, exact evidence, and deterministic Markdown', () => {
    expect(validateReportInput(report).ok).toBe(true);
    expect(validateCitations(report, '曾负责团队管理工作。')).toBe(true);
    expect(validateCitations(report, '完全不同的事实')).toBe(false);
    expect(validateCitations({ ...report, rewriteExamples: [{ ...report.rewriteExamples[0], original: 'not in resume' }] }, '曾负责团队管理工作。')).toBe(false);
    expect(validateCitations(report, '曾负责团队管理\n工作。')).toBe(true);
    expect(reportToMarkdown(report)).toContain('## 概览');
    expect(validateReportInput({ ...report, reportLanguage: 'fr' }).ok).toBe(false);
  });
  it('rejects unknown fields and oversized collections', () => {
    expect(validateReportInput({ ...report, score: 99 }).ok).toBe(false);
    expect(validateReportInput({ ...report, strengths: Array(21).fill('x') }).ok).toBe(false);
  });
});
