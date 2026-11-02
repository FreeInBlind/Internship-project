import { prisma } from '../../lib/db';
import { hashPassword, normalizeEmail, isValidEmail, passwordBytesValid } from '../../lib/credentials';
import { hasTrustedOrigin } from '../../lib/origin';
import { consumeRateLimit } from '../../lib/rate';

export const config = { api: { bodyParser: { sizeLimit: '4kb' } } };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' } }); }
  if (!hasTrustedOrigin(req)) return res.status(403).json({ ok: false, error: { code: 'FORBIDDEN', message: 'Request rejected.' } });
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 2 || !Object.prototype.hasOwnProperty.call(body, 'email') || !Object.prototype.hasOwnProperty.call(body, 'password')) return res.status(400).json({ ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid registration details.' } });
  const email = normalizeEmail(body.email);
  const password = body.password;
  if (!isValidEmail(email) || !passwordBytesValid(password)) return res.status(400).json({ ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid registration details.' } });
  try {
    const ip = process.env.TRUST_PROXY === '1' ? req.headers['x-forwarded-for']?.split(',')[0]?.trim() : req.socket?.remoteAddress;
    const sourceLimit = await consumeRateLimit('register-ip', ip || 'unknown', 10, 60 * 60 * 1000);
    const emailLimit = await consumeRateLimit('register-email', email, 3, 60 * 60 * 1000);
    if (!sourceLimit.allowed || !emailLimit.allowed) {
      res.setHeader('Retry-After', Math.max(sourceLimit.retryAfter, emailLimit.retryAfter));
      return res.status(429).json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Too many requests.' } });
    }
    const passwordHash = await hashPassword(password);
    try { await prisma.user.create({ data: { normalizedEmail: email, passwordHash } }); }
    catch (error) { if (error?.code !== 'P2002') throw error; }
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(503).json({ ok: false, error: { code: 'UNAVAILABLE', message: 'Service unavailable.' } });
  }
}
