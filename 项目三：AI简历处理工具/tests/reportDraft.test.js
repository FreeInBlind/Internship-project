import { describe, expect, it } from 'vitest';
import { createReportDraft, readReportDraft } from '../lib/reportDraft';
import { reportToMarkdown } from '../lib/reportSchema';

const report = { schemaVersion: 1, reportLanguage: 'zh', overview: '虚构经验', strengths: [], issues: [], roleFit: { matches: [], gaps: [], limitations: ['信息不足'] }, rewriteExamples: [] };
const input = { confirmedResumeText: '虚构简历', jobTitle: '工程师', education: '本科', optionalJd: '', salary: '', reportLanguage: 'zh' };

describe('owner-bound in-memory report handoff', () => {
  it('copies only confirmed context and excludes credentials and raw attachments', () => {
    const draft = createReportDraft(report, reportToMarkdown(report), { ...input, apiKey: 'fixture-secret', file: 'raw-file', config: { key: 'hidden' } }, 'owner-a');
    expect(draft).toMatchObject({ ownerId: 'owner-a', input });
    expect(JSON.stringify(draft)).not.toContain('fixture-secret');
    expect(Object.keys(draft.input).sort()).toEqual(Object.keys(input).sort());
    report.strengths.push('临时修改');
    expect(draft.report.strengths).toEqual([]);
    report.strengths.pop();
  });
  it('refuses mismatched or missing owners and invalid context', () => {
    const draft = createReportDraft(report, '', input, 'owner-a');
    expect(readReportDraft(draft, 'owner-b')).toBeNull();
    expect(readReportDraft(draft, null)).toBeNull();
    expect(createReportDraft(report, '', input, null)).toBeNull();
    expect(createReportDraft(report, '', { ...input, jobTitle: '' }, 'owner-a')).toBeNull();
    expect(createReportDraft(report, '', { ...input, reportLanguage: 'en' }, 'owner-a')).toBeNull();
  });
  it('keeps old valid drafts viewable but never invents saving context', () => {
    expect(readReportDraft({ report, markdown: '<b>draft</b>', input, apiKey: 'ignored' }, 'owner-a')).toEqual({ report, markdown: 'draft', input: null, ownerId: null });
  });
});
