import { createBookmark, listBookmarks } from '@/db/user-reading';
import { api, body, checkWriteOrigin, fields, json, limitWrites, requireUser, text } from '@/lib/api';

export const runtime = 'nodejs';

export const GET = api(async (request) => {
  const userId = await requireUser(request);
  const params = new URL(request.url).searchParams;
  const workId = text(params.get('workId'), 'workId');
  const part = params.has('issueWorkId') ? text(params.get('issueWorkId'), 'issueWorkId') : null;
  const cursor = params.has('after') ? text(params.get('after'), 'after') : null;
  return json(await listBookmarks(userId, workId, part, cursor));
});

export const POST = api(async (request) => {
  const userId = await requireUser(request);
  checkWriteOrigin(request);
  limitWrites(userId);
  const input = await body(request);
  fields(input, ['workId', 'issueWorkId', 'contentVersion', 'blockKey', 'note']);
  const result = await createBookmark(userId, input);
  return json(result, result.created ? 201 : 200);
});
