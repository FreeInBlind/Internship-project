export function hasTrustedOrigin(req) {
  const allowed = process.env.NEXTAUTH_URL;
  const origin = req.headers.origin;
  if (!allowed || !origin) return false;
  try {
    const expected = new URL(allowed);
    const actual = new URL(origin);
    return expected.origin === actual.origin;
  } catch { return false; }
}
