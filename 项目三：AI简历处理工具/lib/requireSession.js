import { getServerSession } from 'next-auth/next';
import { authOptions, normalizeSession } from './auth';

function safeCallback(value) {
  return typeof value === 'string' && /^\/(?:upload|history|settings|feedback\/[^/?#]+)(?:\?[^#]*)?$/.test(value) && !value.includes('\\') ? value : '/upload';
}

export async function requireSession(context) {
  context.res.setHeader('Cache-Control', 'private, no-store');
  const session = normalizeSession(await getServerSession(context.req, context.res, authOptions));
  if (!session || !session.user || !session.user.id) {
    return { redirect: { destination: `/login?callbackUrl=${encodeURIComponent(safeCallback(context.resolvedUrl || '/upload'))}`, permanent: false } };
  }
  return { props: { session } };
}

export async function privatePlaceholder(req, res, message) {
  res.setHeader('Cache-Control', 'private, no-store');
  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user || !session.user.id) return res.status(401).json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } });
  return res.status(501).json({ ok: false, error: { code: 'NOT_IMPLEMENTED', message } });
}
