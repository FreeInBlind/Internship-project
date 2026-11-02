import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../lib/auth';
import { hasTrustedOrigin } from '../../lib/origin';
import { validateText } from '../../lib/extraction';

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };

function error(res, status, code, message) {
  return res.status(status).json({ ok: false, error: { code, message } });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return error(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
  }
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) return error(res, 401, 'UNAUTHORIZED', 'Authentication required.');
  if (!hasTrustedOrigin(req)) return error(res, 403, 'FORBIDDEN', 'Request rejected.');

  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return error(res, 400, 'INVALID_INPUT', 'Invalid extraction request.');
  const allowedFields = new Set(['text', 'fileName', 'fileType', 'pageCount', 'ocrUsed']);
  if (Object.keys(body).some((key) => !allowedFields.has(key))) return error(res, 400, 'INVALID_INPUT', 'Invalid extraction request.');
  const result = validateText(body.text);
  if (!result.ok) {
    const status = result.code === 'TEXT_TOO_LARGE' ? 413 : result.code === 'EMPTY_TEXT' ? 422 : 400;
    return error(res, status, result.code, result.code === 'EMPTY_TEXT' ? 'No resume text could be extracted.' : 'Invalid resume text.');
  }
  const fileName = typeof body.fileName === 'string' ? body.fileName.slice(0, 255) : null;
  const fileType = typeof body.fileType === 'string' ? body.fileType.slice(0, 32) : 'text';
  const pageCount = body.pageCount == null ? null : Number.isInteger(body.pageCount) && body.pageCount > 0 && body.pageCount <= 5 ? body.pageCount : null;
  return res.status(200).json({
    ok: true,
    extraction: { text: result.text, fileName, fileType, pageCount, ocrUsed: body.ocrUsed === true },
  });
}
