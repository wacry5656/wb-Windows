const {
  createImageContentHash,
  normalizeImageContentHash,
  verifyImageContentHash,
} = require('../../public/sync-utils');

describe('sync image integrity helpers', () => {
  test('normalizes the optional sha256 prefix to lowercase hex', () => {
    const hash = createImageContentHash(Buffer.from('image bytes'));
    expect(normalizeImageContentHash(`SHA256:${hash.toUpperCase()}`)).toBe(hash);
  });

  test('rejects changed bytes instead of uploading them under an old hash', () => {
    const declaredHash = createImageContentHash(Buffer.from('known good image'));
    expect(
      verifyImageContentHash(Buffer.from('corrupted image'), declaredHash)
    ).toEqual(
      expect.objectContaining({
        matches: false,
      })
    );
  });
});

export {};
