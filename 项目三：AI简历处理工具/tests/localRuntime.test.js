import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { launchOptions } = require('../scripts/run-next.cjs');
const nextConfig = require('../next.config.js');
const { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } = require('next/constants');

describe('local and deployment runtime configuration', () => {
  it('uses loopback port 3010 and a matching auth origin for local development', () => {
    const options = launchOptions('dev', { NEXTAUTH_URL: 'https://previous.example' });
    expect(options.args).toEqual(['dev', '--hostname', '127.0.0.1', '--port', '3010']);
    expect(options.env.NEXTAUTH_URL).toBe('http://127.0.0.1:3010');
  });

  it('preserves a deployment public origin independently of the internal port', () => {
    const options = launchOptions('start', { NEXTAUTH_URL: 'https://resume.example', PORT: '8080', APP_HOST: '0.0.0.0' });
    expect(options.args).toEqual(['start', '--hostname', '0.0.0.0', '--port', '8080']);
    expect(options.env.NEXTAUTH_URL).toBe('https://resume.example');
  });

  it.each(['', 'http://resume.example', 'https://user:secret@resume.example', 'https://resume.example/path', 'https://resume.example?token=x'])('rejects a missing or unsafe production origin', (origin) => {
    expect(() => launchOptions('start', { NEXTAUTH_URL: origin })).toThrow();
  });

  it.each(['abc', '0', '65536', '-1', '3010extra'])('rejects an invalid listening port before spawning', (port) => {
    expect(() => launchOptions('dev', { PORT: port })).toThrow('INVALID_PORT');
  });

  it('keeps local auth consistent when an explicit port is chosen', () => {
    expect(launchOptions('dev', { PORT: '3012' }).env.NEXTAUTH_URL).toBe('http://127.0.0.1:3012');
  });

  it('cannot open the official acceptance gate through an ordinary launch', () => {
    const options = launchOptions('dev', { STAGE4A_ACCEPTANCE: 'true', NEXT_PUBLIC_STAGE4A_ACCEPTANCE: 'true', GROQ_UPSTREAM_ENABLED: 'true', GROQ_QUOTA_MIGRATION_ENABLED: 'true' });
    for (const name of ['STAGE4A_ACCEPTANCE', 'NEXT_PUBLIC_STAGE4A_ACCEPTANCE', 'GROQ_UPSTREAM_ENABLED', 'GROQ_QUOTA_MIGRATION_ENABLED']) expect(options.env[name]).toBe('false');
  });

  it('separates development output from production output', () => {
    expect(nextConfig(PHASE_DEVELOPMENT_SERVER).distDir).toBe('.next-local');
    expect(nextConfig(PHASE_PRODUCTION_BUILD).distDir).toBe('.next');
  });
});
