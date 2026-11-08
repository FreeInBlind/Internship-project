import 'server-only';

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { getDb } from '@/db';
import { account, session, user, verification } from '@/db/schema';

export function getAuthOrigin() {
  const value = process.env.BETTER_AUTH_URL;
  if (!value) throw new Error('BETTER_AUTH_URL is required.');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('BETTER_AUTH_URL must be an origin without a path or credentials.');
  }
  return url.origin;
}

function createAuth() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters.');
  return betterAuth({
    appName: '星笺 Starfolio',
    baseURL: getAuthOrigin(),
    secret,
    database: drizzleAdapter(getDb(), {
      provider: 'pg',
      schema: { user, session, account, verification },
      transaction: true,
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    session: { cookieCache: { enabled: false } },
    // Local single-process baseline; use shared storage before multi-instance deployment.
    rateLimit: { enabled: true, storage: 'memory', window: 60, max: 100 },
    plugins: [nextCookies()],
  });
}

let auth: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  auth ??= createAuth();
  return auth;
}
