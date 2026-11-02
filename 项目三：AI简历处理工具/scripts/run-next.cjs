'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

function launchOptions(command, env = process.env) {
  if (!['dev', 'start'].includes(command)) throw new Error('INVALID_COMMAND');
  const rawPort = env.PORT || '3010';
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) throw new Error('INVALID_PORT');
  const port = String(Number(rawPort));
  const local = command === 'dev';
  const host = local ? '127.0.0.1' : env.APP_HOST || '127.0.0.1';
  if (!host || /[\s/\\]/.test(host)) throw new Error('INVALID_HOST');
  if (!local) {
    let origin;
    try { origin = new URL(env.NEXTAUTH_URL); } catch { throw new Error('NEXTAUTH_URL_REQUIRED'); }
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error('INVALID_NEXTAUTH_URL');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) && origin.protocol !== 'https:') throw new Error('HTTPS_REQUIRED');
  }
  return {
    args: [command, '--hostname', host, '--port', port],
    env: {
      ...env,
      ...(local ? { NEXTAUTH_URL: `http://127.0.0.1:${port}` } : {}),
      // Live official analysis remains exclusive to the existing acceptance launcher.
      NEXT_PUBLIC_STAGE4A_ACCEPTANCE: 'false', STAGE4A_ACCEPTANCE: 'false',
      GROQ_UPSTREAM_ENABLED: 'false', GROQ_QUOTA_MIGRATION_ENABLED: 'false',
    },
  };
}

function main() {
  try {
    if (process.argv.length !== 3) throw new Error('INVALID_ARGUMENTS');
    const root = path.resolve(__dirname, '..');
    const options = launchOptions(process.argv[2]);
    const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), ...options.args], {
      cwd: root, env: options.env, stdio: 'inherit', windowsHide: true,
    });
    child.once('error', () => { console.error('APP_START_FAILED'); process.exitCode = 1; });
    child.once('exit', (code) => { process.exitCode = code ?? 1; });
  } catch (error) {
    const known = new Set(['INVALID_COMMAND', 'INVALID_PORT', 'INVALID_HOST', 'NEXTAUTH_URL_REQUIRED', 'INVALID_NEXTAUTH_URL', 'HTTPS_REQUIRED', 'INVALID_ARGUMENTS']);
    console.error(known.has(error.message) ? error.message : 'APP_START_FAILED');
    process.exitCode = 1;
  }
}

module.exports = { launchOptions };
if (require.main === module) main();
