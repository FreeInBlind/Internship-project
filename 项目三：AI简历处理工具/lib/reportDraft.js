import { REPORT_LIMITS, validateReportInput, validateCitations } from './reportSchema';
import { sanitizeMarkdown } from './markdownSafety';

const limits = { confirmedResumeText: 20000, jobTitle: 200, education: 200, optionalJd: 12000, salary: 200 };

function readInput(input, report) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const result = {};
  for (const [field, maximum] of Object.entries(limits)) {
    const value = input[field] ?? '';
    if (typeof value !== 'string' || value.length > maximum) return null;
    if (['confirmedResumeText', 'jobTitle', 'education'].includes(field) && !value.trim()) return null;
    result[field] = value;
  }
  if (!['zh', 'en'].includes(input.reportLanguage) || input.reportLanguage !== report.reportLanguage) return null;
  if (!validateCitations(report, result.confirmedResumeText)) return null;
  result.reportLanguage = input.reportLanguage;
  return result;
}

export function createReportDraft(report, markdown, input, ownerId) {
  if (typeof ownerId !== 'string' || !ownerId) return null;
  return readReportDraft({ report, markdown, input, ownerId }, ownerId);
}

export function readReportDraft(value, ownerId) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || !validateReportInput(value.report).ok || typeof value.markdown !== 'string'
      || value.markdown.length > REPORT_LIMITS.markdown) return null;
    // Old in-memory handoffs remain viewable but cannot be persisted without
    // the confirmed input snapshot. New handoffs belong to exactly one owner.
    const owned = Object.hasOwn(value, 'ownerId');
    if (owned && (typeof ownerId !== 'string' || !ownerId || value.ownerId !== ownerId)) return null;
    const input = owned ? readInput(value.input, value.report) : null;
    if (owned && !input) return null;
    return {
      report: JSON.parse(JSON.stringify(value.report)),
      markdown: sanitizeMarkdown(value.markdown),
      input,
      ownerId: owned ? ownerId : null,
    };
  } catch {
    return null;
  }
}
