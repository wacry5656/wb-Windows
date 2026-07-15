const crypto = require('crypto');

function createImageContentHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function normalizeImageContentHash(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.trim().toLowerCase().replace(/^sha256:/, '');
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : '';
}

function verifyImageContentHash(buffer, declaredHash) {
  const contentHash = createImageContentHash(buffer);
  const hasDeclaredHash = typeof declaredHash === 'string' && Boolean(declaredHash.trim());
  return {
    contentHash,
    matches:
      !hasDeclaredHash || normalizeImageContentHash(declaredHash) === contentHash,
  };
}

module.exports = {
  createImageContentHash,
  normalizeImageContentHash,
  verifyImageContentHash,
};
