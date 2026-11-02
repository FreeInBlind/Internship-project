import { describe, expect, it } from 'vitest';
import { REPORT_PERSISTENCE_LIMITS, jsonByteLength, validateReportPatch, validateSaveReportInput } from '../lib/reportPersistence';
const report = () => ({ schemaVersion: 1, reportLanguage: 'en', overview: 'Summary', strengths: [], issues: [{ evidence: 'resume evidence', problem: 'problem', suggestion: 'suggestion' }], roleFit: { matches: [], gaps: [], limitations: [] }, rewriteExamples: [{ original: 'resume evidence', suggested: 'suggested', notes: 'notes' }] });
const input = extra => ({ saveId: 'D2719F81-2F77-4A55-9A23-EFC2D2CB99A1', title: ' Report ', confirmedResumeText: 'resume evidence', jobTitle: 'Developer', education: 'Degree', reportLanguage: 'en', editedMarkdown: '# Body', ...extra });

describe('browser-safe saved report validation', () => {
  it('normalizes UUID/title, null optionals, and safe Markdown without changing confirmed text', () => {
    const checked = validateSaveReportInput(input({ confirmedResumeText: '  resume evidence\n', editedMarkdown: '<script>bad</script> ![remote](https://example.test/p.png) [bad](javascript:alert)' }));
    expect(checked.ok).toBe(true);
    expect(checked.value.saveId).toBe('d2719f81-2f77-4a55-9a23-efc2d2cb99a1');
    expect(checked.value.title).toBe('Report');
    expect(checked.value.confirmedResumeText).toBe('  resume evidence\n');
    expect(checked.value.optionalJd).toBeNull();
    expect(checked.value.salary).toBeNull();
    expect(checked.value.reportJson).toBeNull();
    expect(checked.value.editedMarkdown).not.toMatch(/<script>|javascript:|!\[/);
  });
  it('rejects forged owner/time/credentials/attachments and unknown fields', () => {
    for (const key of ['userId', 'createdAt', 'updatedAt', 'expiresAt', 'apiKey', 'config', 'attachment', 'version']) expect(validateSaveReportInput(input({ [key]: 'forged' }))).toEqual({ ok: false, code: 'INVALID_INPUT' });
    for (const body of [null, [], 'text', {}, input({ saveId: 'not-uuid' }), input({ reportLanguage: 'fr' }), input({ title: ' ' }), input({ education: '' })]) expect(validateSaveReportInput(body).ok).toBe(false);
  });
  it('requires valid snapshots in the same language with citations from confirmed text', () => {
    expect(validateSaveReportInput(input({ reportJson: report() })).ok).toBe(true);
    expect(validateSaveReportInput(input({ reportJson: { ...report(), reportLanguage: 'zh' } }))).toEqual({ ok: false, code: 'INVALID_REPORT' });
    expect(validateSaveReportInput(input({ reportJson: { ...report(), secret: 'unknown' } }))).toEqual({ ok: false, code: 'INVALID_REPORT' });
    const fabricated = report(); fabricated.issues[0].evidence = 'not in resume';
    expect(validateSaveReportInput(input({ reportJson: fabricated }))).toEqual({ ok: false, code: 'INVALID_REPORT' });
    const rewritten = report(); rewritten.rewriteExamples[0].original = 'made up';
    expect(validateSaveReportInput(input({ reportJson: rewritten }))).toEqual({ ok: false, code: 'INVALID_REPORT' });
  });
  it('enforces every field cap and bounded UTF-8 snapshot/request sizes before sanitizing', () => {
    for (const key of ['title', 'confirmedResumeText', 'jobTitle', 'education', 'optionalJd', 'salary', 'editedMarkdown']) {
      const limit = REPORT_PERSISTENCE_LIMITS[key];
      expect(validateSaveReportInput(input({ [key]: 'a'.repeat(limit) })).ok).toBe(true);
      expect(validateSaveReportInput(input({ [key]: 'a'.repeat(limit + 1) }))).toEqual({ ok: false, code: 'INPUT_TOO_LARGE' });
    }
    expect(validateSaveReportInput(input({ reportJson: { oversized: '中'.repeat(45000) } }))).toEqual({ ok: false, code: 'INPUT_TOO_LARGE' });
    expect(validateSaveReportInput(input({ editedMarkdown: 'x'.repeat(513 * 1024) }))).toEqual({ ok: false, code: 'INPUT_TOO_LARGE' });
    expect(jsonByteLength({ text: '中' })).toBeGreaterThan(JSON.stringify({ text: '中' }).length);
    const cycle = {}; cycle.self = cycle;
    expect(jsonByteLength(cycle)).toBe(Infinity);
  });
  it('PATCH only permits title and Markdown, preserves missing fields, and forbids empty changes', () => {
    expect(validateReportPatch({ title: ' new ' })).toEqual({ ok: true, value: { title: 'new' } });
    expect(validateReportPatch({ editedMarkdown: '' })).toEqual({ ok: true, value: { editedMarkdown: '' } });
    for (const body of [{}, [], null, { title: ' ' }, { expiresAt: 'later' }, { reportJson: report() }, { title: 'x', userId: 'other' }]) expect(validateReportPatch(body).ok).toBe(false);
    expect(validateReportPatch({ editedMarkdown: 'x'.repeat(30001) })).toEqual({ ok: false, code: 'INPUT_TOO_LARGE' });
  });
});
