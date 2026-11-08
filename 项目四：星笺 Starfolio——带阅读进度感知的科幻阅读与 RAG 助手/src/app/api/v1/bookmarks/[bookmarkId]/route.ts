import { deleteBookmark, note, updateBookmark } from '@/db/user-reading';
import { api, body, checkWriteOrigin, fields, json, limitWrites, requireUser } from '@/lib/api';

type Context = { params: Promise<{ bookmarkId: string }> };
export const runtime = 'nodejs';

export async function PATCH(request: Request, context: Context) {
  return api(async (req) => {
    const userId = await requireUser(req);
    checkWriteOrigin(req);
    limitWrites(userId);
    const input = await body(req);
    fields(input, ['note']);
    const { bookmarkId } = await context.params;
    return json({ bookmark: await updateBookmark(userId, bookmarkId, note(input.note)) });
  })(request);
}

export async function DELETE(request: Request, context: Context) {
  return api(async (req) => {
    const userId = await requireUser(req);
    checkWriteOrigin(req);
    limitWrites(userId);
    const { bookmarkId } = await context.params;
    await deleteBookmark(userId, bookmarkId);
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  })(request);
}
