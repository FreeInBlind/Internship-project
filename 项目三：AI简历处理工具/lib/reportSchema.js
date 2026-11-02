const LANGUAGES = new Set(['zh', 'en']);
const MAX = { text: 20000, overview: 4000, item: 2000, items: 20, citations: 50, markdown: 30000 };

export const GROQ_REPORT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    schemaVersion: { type: 'integer', enum: [1] },
    reportLanguage: { type: 'string', enum: ['zh', 'en'] },
    overview: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    issues: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { evidence: { type: 'string' }, problem: { type: 'string' }, suggestion: { type: 'string' } }, required: ['evidence', 'problem', 'suggestion'] } },
    roleFit: { type: 'object', additionalProperties: false, properties: { matches: { type: 'array', items: { type: 'string' } }, gaps: { type: 'array', items: { type: 'string' } }, limitations: { type: 'array', items: { type: 'string' } } }, required: ['matches', 'gaps', 'limitations'] },
    rewriteExamples: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { original: { type: 'string' }, suggested: { type: 'string' }, notes: { type: 'string' } }, required: ['original', 'suggested', 'notes'] } },
  },
  required: ['schemaVersion', 'reportLanguage', 'overview', 'strengths', 'issues', 'roleFit', 'rewriteExamples'],
};

function string(value, max) { return typeof value === 'string' && value.trim() !== '' && value.length <= max ? value : null; }
function list(value, maxItems) { return Array.isArray(value) && value.length <= maxItems && value.every((item) => string(item, MAX.item)) ? value : null; }

export function validateReportInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, code: 'INVALID_REPORT' };
  const allowed = new Set(['schemaVersion', 'reportLanguage', 'overview', 'strengths', 'issues', 'roleFit', 'rewriteExamples']);
  if (Object.keys(input).some((key) => !allowed.has(key))) return { ok: false, code: 'INVALID_REPORT' };
  if (input.schemaVersion !== 1 || !LANGUAGES.has(input.reportLanguage)) return { ok: false, code: 'INVALID_REPORT' };
  if (!string(input.overview, MAX.overview)) return { ok: false, code: 'INVALID_REPORT' };
  if (!list(input.strengths, MAX.items)) return { ok: false, code: 'INVALID_REPORT' };
  if (!Array.isArray(input.issues) || input.issues.length > MAX.items) return { ok: false, code: 'INVALID_REPORT' };
  for (const issue of input.issues) {
    if (!issue || typeof issue !== 'object' || Array.isArray(issue) || Object.keys(issue).some((key) => !['evidence', 'problem', 'suggestion'].includes(key))) return { ok: false, code: 'INVALID_REPORT' };
    if (![issue.evidence, issue.problem, issue.suggestion].every((value) => string(value, MAX.item))) return { ok: false, code: 'INVALID_REPORT' };
  }
  if (!input.roleFit || typeof input.roleFit !== 'object' || Array.isArray(input.roleFit) || Object.keys(input.roleFit).some((key) => !['matches', 'gaps', 'limitations'].includes(key)) || !list(input.roleFit.matches, MAX.items) || !list(input.roleFit.gaps, MAX.items) || !list(input.roleFit.limitations, MAX.items)) return { ok: false, code: 'INVALID_REPORT' };
  if (!Array.isArray(input.rewriteExamples) || input.rewriteExamples.length > MAX.items || input.rewriteExamples.some((item) => !item || typeof item !== 'object' || Object.keys(item).some((key) => !['original', 'suggested', 'notes'].includes(key)) || ![item.original, item.suggested, item.notes].every((value) => string(value, MAX.item)))) return { ok: false, code: 'INVALID_REPORT' };
  return { ok: true, value: input };
}

export function validateCitations(report, resumeText) {
  if (!report || !Array.isArray(report.issues) || !Array.isArray(report.rewriteExamples) || typeof resumeText !== 'string') return false;
  const normalizedResume = resumeText.replace(/\s+/g, ' ').trim();
  const isQuoted = (quote) => typeof quote === 'string' && quote.trim() !== '' && normalizedResume.includes(quote.replace(/\s+/g, ' ').trim());
  return report.issues.every((issue) => issue.evidence === '信息不足' || issue.evidence === 'Insufficient information' || isQuoted(issue.evidence))
    && report.rewriteExamples.every((example) => isQuoted(example.original));
}

export function reportToMarkdown(report) {
  const checked = validateReportInput(report);
  if (!checked.ok) throw new TypeError('Invalid report');
  const t = report.reportLanguage === 'zh' ? { overview: '概览', strengths: '优势', issues: '问题与建议', role: '岗位匹配', rewrites: '改写示例' } : { overview: 'Overview', strengths: 'Strengths', issues: 'Issues and suggestions', role: 'Role fit', rewrites: 'Rewrite examples' };
  const lines = [`## ${t.overview}`, report.overview, `\n## ${t.strengths}`, ...report.strengths.map((item) => `- ${item}`), `\n## ${t.issues}`, ...report.issues.map((item) => `- **${item.problem}**\n  - Evidence: ${item.evidence}\n  - Suggestion: ${item.suggestion}`), `\n## ${t.role}`, `- Matches: ${report.roleFit.matches.join('; ')}`, `- Gaps: ${report.roleFit.gaps.join('; ')}`, `- Limitations: ${report.roleFit.limitations.join('; ')}`, `\n## ${t.rewrites}`];
  for (const item of report.rewriteExamples) lines.push(`- Original: ${item.original}\n  Suggested: ${item.suggested}\n  Notes: ${item.notes}`);
  return lines.join('\n').slice(0, MAX.markdown);
}

export const REPORT_LIMITS = MAX;
