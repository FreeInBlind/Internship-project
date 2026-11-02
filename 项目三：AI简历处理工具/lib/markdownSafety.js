const SAFE_LINK = /^(https?:|mailto:|#)/i;
export function sanitizeMarkdown(value) {
  if (typeof value !== 'string') return '';
  return value.slice(0, 30000).replace(/<[^>]*>/g, '').replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) => SAFE_LINK.test(href.trim()) ? `[${text}](${href.trim()})` : text);
}
