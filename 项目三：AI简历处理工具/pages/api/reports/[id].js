import { deleteSavedReport, getActiveSavedReport, reportDTO, updateSavedReport } from '../../../lib/reports';
import { guardReports, readReportBody, reportFail, reportId, reportIfMatch, reportPublicError, sendReport } from '../../../lib/reportsApi';
import { validateReportPatch } from '../../../lib/reportPersistence';

export const config = { api: { bodyParser: false } };
export default async function handler(req, res) {
  const userId = await guardReports(req, res, ['GET', 'PATCH', 'DELETE']);
  if (!userId) return;
  const id = reportId(req.query?.id);
  if (!id) return reportFail(res, 404, 'NOT_FOUND');
  try {
    if (req.method === 'DELETE') {
      if (!await deleteSavedReport({ userId, id })) return reportFail(res, 404, 'NOT_FOUND');
      return res.status(204).end();
    }
    let row;
    if (req.method === 'GET') row = await getActiveSavedReport({ userId, id });
    else {
      const version = reportIfMatch(req);
      const checked = validateReportPatch(await readReportBody(req));
      if (!checked.ok) return reportPublicError(res, checked);
      row = await updateSavedReport({ ...checked.value, userId, id, version });
    }
    if (!row) return reportFail(res, 404, 'NOT_FOUND');
    return sendReport(res, 200, row, reportDTO);
  } catch (error) { return reportPublicError(res, error); }
}
