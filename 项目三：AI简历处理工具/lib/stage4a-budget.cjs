'use strict';

const fs = require('node:fs');
const path = require('node:path');

function denied(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

// Acceptance only. The spent marker is deliberately never removed, even on error.
function claimStage4aBudget(env = process.env) {
  if (env.STAGE4A_ACCEPTANCE !== 'true') return;
  const marker = env.STAGE4A_BUDGET_FILE;
  if (typeof marker !== 'string' || !path.isAbsolute(marker)) denied('ACCEPTANCE_BUDGET_UNAVAILABLE');
  let fd;
  try {
    fd = fs.openSync(marker, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify({ claimedAt: new Date().toISOString(), limit: 1 }));
    fs.fsyncSync(fd);
  } catch (error) {
    denied(error?.code === 'EEXIST' ? 'ACCEPTANCE_BUDGET_SPENT' : 'ACCEPTANCE_BUDGET_UNAVAILABLE');
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { denied('ACCEPTANCE_BUDGET_UNAVAILABLE'); }
    }
  }
}

module.exports = { claimStage4aBudget };
