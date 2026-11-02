import { customAiConfigMetadata, deleteCustomAiConfig, getSavedCustomAiConfig, parseCustomAiPrecondition, saveCustomAiConfig, validateCustomAiConfig } from '../../../lib/customAiConfigStore';
import { customAiFail, customAiPublicError, guardCustomAi, validCustomAiBody } from '../../../lib/customAiApi';

export const config = { api: { bodyParser: { sizeLimit: '32kb' } } };

export default async function handler(req, res) {
  const userId = await guardCustomAi(req, res, ['GET', 'POST', 'PUT', 'DELETE']);
  if (!userId) return;
  try {
    if (req.method === 'GET') {
      const result = await getSavedCustomAiConfig(userId);
      if (result.config) res.setHeader('ETag', `"${result.config.configVersion}"`);
      return res.status(200).json({ ok: true, ...result });
    }
    if (req.method === 'DELETE') {
      const precondition = parseCustomAiPrecondition(req.headers);
      await deleteCustomAiConfig(userId, precondition.version);
      return res.status(200).json({ ok: true, config: null });
    }
    if (!validCustomAiBody(req.body, ['config']) || !req.body.config) return customAiFail(res, 400, 'INVALID_INPUT');
    if (req.method === 'POST') {
      // Temporary validation never needs a master key or reads/writes storage.
      const checked = validateCustomAiConfig(req.body.config);
      return res.status(200).json({ ok: true, config: customAiConfigMetadata(checked) });
    }
    const precondition = parseCustomAiPrecondition(req.headers, { allowCreate: true });
    const saved = await saveCustomAiConfig(userId, req.body.config, precondition);
    res.setHeader('ETag', `"${saved.configVersion}"`);
    return res.status(200).json({ ok: true, config: saved, persistenceAvailable: true });
  } catch (error) { return customAiPublicError(res, error); }
}
