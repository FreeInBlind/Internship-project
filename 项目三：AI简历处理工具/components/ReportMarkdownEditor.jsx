import React from 'react';
import { sanitizeMarkdown } from '../lib/markdownSafety';
import { REPORT_LIMITS } from '../lib/reportSchema';

// This renderer creates React elements only. Unsupported Markdown remains text;
// there is no HTML parser, resource loader, or raw-HTML escape hatch.
function safeHref(value) {
  const href = value.trim();
  if (/[\u0000- \u007f]/.test(href)) return null;
  if (href.startsWith('#')) return href;
  if (!/^(https?:|mailto:)/i.test(href)) return null;
  try {
    const url = new URL(href);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? href : null;
  } catch { return null; }
}

function inline(text, depth = 0) {
  if (depth > 8) return text;
  const pattern = /(`[^`\n]+`|!\[[^\]\n]*\]\([^\n]*?\)|\[[^\]\n]+\]\([^\s\n)]*\)|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g;
  const nodes = [];
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > offset) nodes.push(text.slice(offset, match.index));
    const token = match[0];
    const key = match.index;
    if (token.startsWith('`')) nodes.push(<code key={key} className="rounded bg-ink/5 px-1 font-mono">{token.slice(1, -1)}</code>);
    else if (token.startsWith('![')) nodes.push(token);
    else if (token.startsWith('[')) {
      const parts = /^\[([^\]]+)\]\((.*)\)$/.exec(token);
      const href = safeHref(parts[2]);
      nodes.push(href ? <a key={key} href={href} rel="noopener noreferrer" className="underline">{inline(parts[1], depth + 1)}</a> : parts[1]);
    } else if (token.startsWith('**') || token.startsWith('__')) nodes.push(<strong key={key}>{inline(token.slice(2, -2), depth + 1)}</strong>);
    else nodes.push(<em key={key}>{inline(token.slice(1, -1), depth + 1)}</em>);
    offset = match.index + token.length;
  }
  if (offset < text.length) nodes.push(text.slice(offset));
  return nodes;
}

export function ReportMarkdownPreview({ markdown }) {
  const lines = sanitizeMarkdown(markdown).split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length;) {
    const start = i;
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    if (/^```/.test(line)) {
      const code = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i += 1;
      blocks.push(<pre key={start} className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-ink/5 p-3"><code>{code.join('\n')}</code></pre>);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push(React.createElement(`h${heading[1].length}`, { key: start, className: 'font-bold' }, inline(heading[2])));
      i += 1;
      continue;
    }
    const list = /^\s*(?:([-+*])|\d+\.)\s+(.+)$/.exec(line);
    if (list) {
      const ordered = !list[1];
      const items = [];
      while (i < lines.length) {
        const item = /^\s*(?:([-+*])|\d+\.)\s+(.+)$/.exec(lines[i]);
        if (!item || Boolean(item[1]) === ordered) break;
        items.push(<li key={i}>{inline(item[2])}</li>);
        i += 1;
      }
      blocks.push(React.createElement(ordered ? 'ol' : 'ul', { key: start, className: `${ordered ? 'list-decimal' : 'list-disc'} space-y-1 pl-6` }, items));
      continue;
    }
    const paragraph = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*([-+*]|\d+\.)\s)/.test(lines[i])) paragraph.push(lines[i++]);
    blocks.push(<p key={start} className="whitespace-pre-wrap">{inline(paragraph.join('\n'))}</p>);
  }
  return <div className="space-y-3 [overflow-wrap:anywhere]">{blocks}</div>;
}

export default function ReportMarkdownEditor({ value, onChange, disabled = false, language = 'zh', reportLanguage = 'zh', memoryHint, dirty = false }) {
  const zh = language === 'zh';
  return <section className="space-y-3">
    <h2 id="markdown-editor-heading" className="text-2xl font-bold"><label htmlFor="report-markdown">{zh ? '编辑 Markdown' : 'Edit Markdown'}</label></h2>
    <p id="markdown-editor-hint" className="text-sm leading-6 text-ink/65">{zh ? '只编辑分析报告，不是生成新简历。Markdown 修改不会同步到上方的原始结构化报告。预览不渲染 HTML、图片或嵌入资源。' : 'Edit the analysis report, not a new resume. Markdown edits do not change the original structured report above. The preview does not render HTML, images, or embedded resources.'}</p>
    <textarea id="report-markdown" disabled={disabled} aria-describedby="markdown-editor-hint markdown-editor-limit markdown-memory-hint" lang={reportLanguage === 'zh' ? 'zh-CN' : 'en'} className="min-h-64 w-full min-w-0 max-w-full resize-y rounded-lg border border-ink/20 p-4 font-mono text-sm [overflow-wrap:anywhere] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-60" maxLength={REPORT_LIMITS.markdown} value={value} onChange={(event) => onChange(sanitizeMarkdown(event.target.value).slice(0, REPORT_LIMITS.markdown))} />
    <p id="markdown-editor-limit" className="text-sm text-ink/65">{zh ? '字符上限' : 'Character limit'}: {value.length} / {REPORT_LIMITS.markdown}</p>
    <p id="markdown-memory-hint" className="text-sm leading-6 text-ink/65">{memoryHint}</p>
    {dirty && <p role="status" className="text-sm text-ink/65">{zh ? 'Markdown 有修改，尚未保存。' : 'Markdown has unsaved changes.'}</p>}
    <section aria-label={zh ? 'Markdown 安全预览' : 'Safe Markdown preview'} lang={reportLanguage === 'zh' ? 'zh-CN' : 'en'} className="rounded-lg border border-ink/15 p-4"><ReportMarkdownPreview markdown={value} /></section>
  </section>;
}
