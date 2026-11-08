import { getReadingRange, type ReadingRangeMode } from '@/db/user-reading';
import { ApiError, api, json, requireUser, text } from '@/lib/api';

export const runtime = 'nodejs';

export const GET = api(async (request) => {
  const userId = await requireUser(request);
  const params = new URL(request.url).searchParams;
  const allowed = new Set(['workId', 'issueWorkId', 'mode']);
  if ([...params.keys()].some((key) => !allowed.has(key))
    || ['workId', 'issueWorkId', 'mode'].some((key) => params.getAll(key).length !== 1)) {
    throw new ApiError(400, 'VALIDATION_ERROR', '查询参数无效');
  }
  const workKey = text(params.get('workId'), 'workId');
  const issueWorkKey = text(params.get('issueWorkId'), 'issueWorkId');
  const mode = text(params.get('mode'), 'mode');
  if (!['before_current', 'read', 'full'].includes(mode)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'mode 无效');
  }
  return json(await getReadingRange(userId, workKey, issueWorkKey, mode as ReadingRangeMode));
});
