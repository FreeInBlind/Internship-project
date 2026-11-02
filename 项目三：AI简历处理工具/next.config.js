const { PHASE_DEVELOPMENT_SERVER } = require('next/constants');

module.exports = (phase) => ({
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-local' : '.next',
  experimental: { cpus: 2 },
});
