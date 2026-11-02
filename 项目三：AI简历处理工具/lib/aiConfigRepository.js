import { prisma } from './db';

const SELECT = { userId: true, baseUrl: true, model: true, ciphertext: true, nonce: true, tag: true, keyVersion: true, updatedAt: true };

export function aiConfigError(code) {
  return Object.assign(new Error(code), { code });
}

function assertOwner(userId) {
  if (typeof userId !== 'string' || !userId || userId !== userId.trim() || /[\u0000-\u001f\u007f]/.test(userId)) {
    throw aiConfigError('UNAUTHORIZED');
  }
}

// A full previously-read identity, not merely a preflight version check followed
// by an unconditional write. A concurrent update/recreate must affect zero rows.
function snapshotWhere(userId, snapshot) {
  assertOwner(userId);
  if (!snapshot || snapshot.userId !== userId) throw aiConfigError('CONFIG_VERSION_CONFLICT');
  return { userId, baseUrl: snapshot.baseUrl, model: snapshot.model,
    ciphertext: snapshot.ciphertext, nonce: snapshot.nonce, tag: snapshot.tag,
    keyVersion: snapshot.keyVersion, updatedAt: snapshot.updatedAt };
}

export function createAiConfigRepository(db = prisma) {
  return {
    async find(userId) {
      assertOwner(userId);
      try { return await db.aiConfig.findUnique({ where: { userId }, select: SELECT }); }
      catch { throw aiConfigError('AI_CONFIG_STORAGE_UNAVAILABLE'); }
    },
    async create(userId, data) {
      assertOwner(userId);
      try { return await db.aiConfig.create({ data: { ...data, userId }, select: SELECT }); }
      catch (error) {
        throw aiConfigError(error?.code === 'P2002' ? 'CONFIG_VERSION_CONFLICT' : 'AI_CONFIG_STORAGE_UNAVAILABLE');
      }
    },
    async replace(userId, snapshot, data) {
      const where = snapshotWhere(userId, snapshot);
      let result;
      try { result = await db.aiConfig.updateMany({ where, data }); }
      catch { throw aiConfigError('AI_CONFIG_STORAGE_UNAVAILABLE'); }
      if (result.count !== 1) throw aiConfigError('CONFIG_VERSION_CONFLICT');
      // Return exactly the committed snapshot, not a second read that could
      // silently describe somebody else's later mutation.
      return { ...snapshot, ...data, userId };
    },
    async remove(userId, snapshot) {
      const where = snapshotWhere(userId, snapshot);
      let result;
      try { result = await db.aiConfig.deleteMany({ where }); }
      catch { throw aiConfigError('AI_CONFIG_STORAGE_UNAVAILABLE'); }
      if (result.count !== 1) throw aiConfigError('CONFIG_VERSION_CONFLICT');
    },
  };
}

export const aiConfigRepository = createAiConfigRepository();
