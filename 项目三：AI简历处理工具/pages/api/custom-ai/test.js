import { testCustomAiConnection } from '../../../lib/customAiReport';
import { loadSavedCustomAiConfig, validateCustomAiConfig } from '../../../lib/customAiConfigStore';
import { beginCustomAiRequest, customAiAbortSignal, customAiFail, customAiPublicError, guardCustomAi, validCustomAiBody } from '../../../lib/customAiApi';

export const config = { api: { bodyParser: { sizeLimit: '32kb' } }, maxDuration: 60 };

export default async function handler(req, res) {
  const userId = await guardCustomAi(req, res, ['POST']);
  if (!userId) return;
  const saved = req.body?.source === 'saved';
  const fields = saved ? ['source', 'configVersion', 'model', 'requestId'] : ['config', 'requestId'];
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
    await testCustomAiConnection(checked, { signal: connection.signal });
    if (connection.signal.aborted || res.destroyed) return;
    return res.status(200).json({ ok: true, ...(saved ? { config: metadata, effectiveModel: checked.model } : {}) });
  } catch (error) {
    if (!res.destroyed) return customAiPublicError(res, error);
  } finally {
    connection.cleanup();
    attempt.release();
  }
}
