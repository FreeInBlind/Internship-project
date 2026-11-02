export const MAX_FILE_BYTES = 3 * 1024 * 1024;
export const MAX_TEXT_LENGTH = 200000;
export const SUPPORTED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'pdf', 'docx', 'md', 'txt'];

export function extensionOf(name) {
  if (typeof name !== 'string') return '';
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

export function validateText(text) {
  if (typeof text !== 'string') return { ok: false, code: 'INVALID_TEXT' };
  if (!text.trim()) return { ok: false, code: 'EMPTY_TEXT' };
  if (text.length > MAX_TEXT_LENGTH) return { ok: false, code: 'TEXT_TOO_LARGE' };
  return { ok: true, text };
}

export function decodeUtf8Text(buffer) {
  if (Object.prototype.toString.call(buffer) !== '[object ArrayBuffer]') return { ok: false, code: 'INVALID_FILE' };
  try {
    const value = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '');
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) return { ok: false, code: 'BINARY_TEXT' };
    return { ok: true, text: value };
  } catch {
    return { ok: false, code: 'INVALID_ENCODING' };
  }
}

export function validateUploadMetadata({ fileName, fileSize, extension }) {
  const ext = extension || extensionOf(fileName);
  if (!SUPPORTED_EXTENSIONS.includes(ext)) return { ok: false, status: 400, code: 'UNSUPPORTED_TYPE' };
  if (!Number.isInteger(fileSize) || fileSize < 0) return { ok: false, status: 400, code: 'INVALID_FILE' };
  if (fileSize > MAX_FILE_BYTES) return { ok: false, status: 413, code: 'FILE_TOO_LARGE' };
  return { ok: true, extension: ext };
}
