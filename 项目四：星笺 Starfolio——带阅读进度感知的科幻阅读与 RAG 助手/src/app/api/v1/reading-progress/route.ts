import { listProgress, saveProgress } from '@/db/user-reading';
import { api, body, checkWriteOrigin, fields, json, limitWrites, requireUser, text } from '@/lib/api';

export const runtime = 'nodejs';

export const GET = api(async (request) => {
  const userId = await requireUser(request);
  const params = new URL(request.url).searchParams;
  const workId = text(params.get('workId'), 'workId');
  const part = params.has('issueWorkId') ? text(params.get('issueWorkId'), 'issueWorkId') : null;
  return json({ items: await listProgress(userId, workId, part) });
});

export const PUT = api(async (request) => {
  const userId = await requireUser(request);
  checkWriteOrigin(request);
  limitWrites(userId);
  const input = await body(request);
  fields(input, ['workId', 'issueWorkId', 'contentVersion', 'blockKey', 'advanceRead', 'expectedUpdatedAt', 'readThroughBlockKey']);
  return json({ progress: await saveProgress(userId, input) });
});
