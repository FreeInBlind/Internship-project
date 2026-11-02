import { analyzeWithCustomAi } from '../../../lib/customAiReport';
import { loadSavedCustomAiConfig, validateCustomAiConfig } from '../../../lib/customAiConfigStore';
import { beginCustomAiRequest, customAiAbortSignal, customAiFail, customAiPublicError, guardCustomAi, validCustomAiBody } from '../../../lib/customAiApi';

export const config = { api: { bodyParser: { sizeLimit: '256kb' } }, maxDuration: 60 };

function containsSecret(value, secret) {
  if (typeof value === 'string') return value.includes(secret);
  if (Array.isArray(value)) return value.some(item => containsSecret(item, secret));
  return value !== null && typeof value === 'object' && Object.values(value).some(item => containsSecret(item, secret));
}

export default async function handler(req, res) {
  const userId = await guardCustomAi(req, res, ['POST']);
  if (!userId) return;
  const saved = req.body?.source === 'saved';
  const fields = saved ? ['source', 'configVersion', 'model', 'input', 'requestId'] : ['config', 'input', 'requestId'];
  if (!validCustomAiBody(req.body, fields) || (!saved && !req.body.config)) return customAiFail(res, 400, 'INVALID_INPUT');
  if (saved && !req.body.configVersion) return customAiFail(res, 428, 'CONFIG_PRECONDITION_REQUIRED');
  let checked;
  let metadata;
  try {
    if (saved) {
      const loaded = await loadSavedCustomAiConfig(userId, req.body.configVersion, req.body.model);
      checked = loaded.config;
      metadata = loaded.metadata;
    } else checked = validateCustomAiConfig(req.body.config);
  } catch (error) { return customAiPublicError(res, error); }
  const attempt = beginCustomAiRequest(userId, req.body.requestId);
  if (attempt.error) return customAiFail(res, attempt.status, attempt.error);
  const connection = customAiAbortSignal(req, res);
  try {
    const report = await analyzeWithCustomAi(req.body.input, { config: checked, signal: connection.signal });
    if (connection.signal.aborted || res.destroyed) return;
    if (containsSecret(report, checked.apiKey)) return customAiFail(res, 502, 'INVALID_REPORT');
    const { reportToMarkdown } = await import('../../../lib/reportSchema');
    return res.status(200).json({ ok: true, report, markdown: reportToMarkdown(report),
      ...(saved ? { config: metadata, effectiveModel: checked.model } : {}) });
  } catch (error) {
    if (!res.destroyed) return customAiPublicError(res, error);
  } finally {
    connection.cleanup();
    attempt.release();
  }
}
