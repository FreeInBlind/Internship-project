import CredentialsProvider from 'next-auth/providers/credentials';
import { prisma } from './db';
import { normalizeEmail, passwordBytesValid, verifyPassword } from './credentials';
import { consumeRateLimit } from './rate';

export function normalizeSession(session) {
  const user = session?.user;
  if (!session || !user) return null;
  return {
    expires: session.expires ?? null,
    user: {
      id: user.id ?? null,
      name: user.name ?? null,
      email: user.email ?? null,
      image: user.image ?? null
    }
  };
}

export const authOptions = {
  session: { strategy: 'jwt' },
  providers: [CredentialsProvider({
    name: 'Credentials',
    credentials: { email: { type: 'email' }, password: { type: 'password' } },
    async authorize(credentials, req) {
      try {
        const email = normalizeEmail(credentials?.email);
        const password = credentials?.password;
        if (!email || !passwordBytesValid(password)) return null;
        const forwarded = process.env.TRUST_PROXY === '1';
        const ip = forwarded ? req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() : req?.socket?.remoteAddress;
        const source = ip || 'unknown';
        const ipLimit = await consumeRateLimit('login-ip', source, 20, 15 * 60 * 1000);
        const emailLimit = await consumeRateLimit('login-email', email, 8, 15 * 60 * 1000);
        if (!ipLimit.allowed || !emailLimit.allowed) return null;
        const user = await prisma.user.findUnique({ where: { normalizedEmail: email } });
        const valid = await verifyPassword(password, user?.passwordHash || '$2a$12$C6UzMDM.H6dfI/f/IKcEe.yrhG8KrqXJQFqCsL7NqBCZCQk4aXUqG');
        if (!user || !valid) return null;
        return { id: user.id, email: user.normalizedEmail };
      } catch {
        return null;
      }
    }
  })],
  callbacks: {
    async jwt({ token, user }) { if (user) token.userId = user.id; return token; },
    async session({ session, token }) {
      if (session.user && token.userId) session.user.id = token.userId;
      return normalizeSession(session);
    },
    async redirect({ url, baseUrl }) {
      try {
        const target = new URL(url, baseUrl);
        const base = new URL(baseUrl);
        if (target.origin !== base.origin || target.pathname.includes('\\') || target.pathname.startsWith('//')) return baseUrl;
        return target.href;
      } catch { return baseUrl; }
    }
  },
  secret: process.env.NEXTAUTH_SECRET
};
