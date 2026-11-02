import { timingSafeEqual } from 'node:crypto';
import { cleanupExpiredReports } from '../../../lib/reports';
import { reportFail, reportHeaders } from '../../../lib/reportsApi';

export const config = { api: { bodyParser: false } };
export default async function handler(req, res) {
  reportHeaders(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return reportFail(res, 405, 'METHOD_NOT_ALLOWED');
  }
  const secret = process.env.CRON_SECRET;
  if (typeof secret !== 'string' || !secret.trim()) return reportFail(res, 503, 'SERVICE_UNAVAILABLE');
  const header = req.headers?.authorization;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = typeof header === 'string' ? Buffer.from(header) : Buffer.alloc(0);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return reportFail(res, 401, 'UNAUTHORIZED');
  try {
    const deleted = await cleanupExpiredReports();
    return res.status(200).json({ ok: true, deleted });
  } catch { return reportFail(res, 503, 'SERVICE_UNAVAILABLE'); }
}
