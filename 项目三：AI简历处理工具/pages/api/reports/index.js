import { createSavedReport, listSavedReports, reportDTO } from '../../../lib/reports';
import { guardReports, readReportBody, reportFail, reportPublicError, sendReport } from '../../../lib/reportsApi';

export const config = { api: { bodyParser: false } };
export default async function handler(req, res) {
  const userId = await guardReports(req, res, ['GET', 'POST']);
  if (!userId) return;
  try {
    if (req.method === 'GET') {
      const query = req.query || {};
      if (Object.keys(query).some(key => !['limit', 'cursor'].includes(key))
          || (query.limit !== undefined && (typeof query.limit !== 'string' || !/^[1-9]\d?$/.test(query.limit)))
          || (query.cursor !== undefined && typeof query.cursor !== 'string')) return reportFail(res, 422, 'INVALID_INPUT');
      const result = await listSavedReports({ userId, limit: query.limit === undefined ? 20 : Number(query.limit), cursor: query.cursor });
      return res.status(200).json({ ok: true, ...result });
    }
    const body = await readReportBody(req);
    // Repository validates the entire body; caller cannot override session owner.
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.hasOwn(body, 'userId')) return reportFail(res, 422, 'INVALID_INPUT');
    const result = await createSavedReport({ ...body, userId });
    return sendReport(res, result.created ? 201 : 200, result.report, reportDTO);
  } catch (error) { return reportPublicError(res, error); }
}
