const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  canonicalizeImages,
  compactTombstonePayload,
  computeRecordUpdatedAtMs,
  decodeCursor,
  deriveReviewCount,
  encodeCursor,
  getTombstoneCompactCutoffMs,
  legacyFollowUpId,
  mergeQuestionPayload,
  normalizeImageRef,
  normalizeReviewEvents,
  normalizeStoragePayload,
  pageByByteTarget,
  storagePayloadNeedsRewrite,
} = require('./server');

function dataUrl(text) {
  return `data:image/png;base64,${Buffer.from(text).toString('base64')}`;
}

function testFieldLevelMerge() {
  const merged = mergeQuestionPayload(
    {
      id: 'q1',
      title: 'Windows new title',
      contentUpdatedAt: 2000,
      notes: 'old notes',
      notesUpdatedAt: 1000,
      updatedAt: 2000,
    },
    {
      id: 'q1',
      title: 'old title',
      contentUpdatedAt: 1000,
      notes: 'Android new notes',
      notesUpdatedAt: 3000,
      updatedAt: 3000,
    }
  );

  assert.equal(merged.title, 'Windows new title');
  assert.equal(merged.notes, 'Android new notes');
  assert.equal(merged.syncStatus, 'synced');
  assert.equal(merged.protocolVersion, 2);
}

function testEqualTimestampMergeIsDeterministic() {
  const left = {
    id: 'q1',
    title: 'alpha',
    contentUpdatedAt: 2000,
    updatedAt: 2000,
  };
  const right = {
    id: 'q1',
    title: 'omega',
    contentUpdatedAt: 2000,
    updatedAt: 2000,
  };
  assert.equal(
    mergeQuestionPayload(left, right).title,
    mergeQuestionPayload(right, left).title
  );
}

function testConcurrentReviewEventsAreBothCounted() {
  const merged = mergeQuestionPayload(
    {
      id: 'q1',
      reviewCount: 1,
      reviewEvents: [
        {
          id: 'windows-review',
          kind: 'review',
          reviewedAt: 2000,
          quality: 2,
          deviceId: 'windows',
        },
      ],
      reviewUpdatedAt: 2000,
      updatedAt: 2000,
    },
    {
      id: 'q1',
      reviewCount: 1,
      reviewEvents: [
        {
          id: 'android-review',
          kind: 'review',
          reviewedAt: 3000,
          quality: 3,
          deviceId: 'android',
        },
      ],
      reviewUpdatedAt: 3000,
      updatedAt: 3000,
    }
  );

  assert.equal(merged.reviewCount, 2);
  assert.deepEqual(
    merged.reviewEvents.map((event) => event.id),
    ['windows-review', 'android-review']
  );
  assert.equal(
    new Date(merged.nextReviewAt).getTime(),
    3000 + 6 * 24 * 60 * 60 * 1000
  );
  assert.equal(new Date(merged.lastReviewedAt).getTime(), 3000);
  assert.equal(merged.masteryLevel, 5);
}

function testLegacyReviewCountDoesNotDoubleAcrossDevices() {
  const left = normalizeReviewEvents({ id: 'q1', reviewCount: 3, updatedAt: 2000 });
  const right = normalizeReviewEvents({ id: 'q1', reviewCount: 3, updatedAt: 3000 });
  assert.deepEqual(
    left.map((event) => event.id),
    ['legacy-review:q1:1', 'legacy-review:q1:2', 'legacy-review:q1:3']
  );
  const merged = mergeQuestionPayload(
    { id: 'q1', reviewCount: 3, updatedAt: 2000 },
    { id: 'q1', reviewCount: 3, updatedAt: 3000 }
  );
  assert.equal(merged.reviewCount, 3);
  assert.equal(right.length, 3);
}

function testReviewRevertCanReduceCount() {
  const events = [
    { id: 'r1', kind: 'review', reviewedAt: 1000, quality: 2 },
    { id: 'r2', kind: 'review', reviewedAt: 2000, quality: 0 },
    {
      id: 'undo-r1',
      kind: 'revert',
      reviewedAt: 3000,
      targetEventId: 'r1',
    },
  ];
  assert.equal(deriveReviewCount(normalizeReviewEvents({ id: 'q1', reviewCount: 0, reviewEvents: events })), 0);

  const merged = mergeQuestionPayload(
    {
      id: 'q1',
      reviewCount: 1,
      reviewEvents: [events[0]],
      reviewUpdatedAt: 1000,
      updatedAt: 1000,
    },
    {
      id: 'q1',
      reviewCount: 0,
      reviewEvents: events,
      reviewUpdatedAt: 3000,
      updatedAt: 3000,
    }
  );
  assert.equal(merged.reviewCount, 0);
}

function testLegacyV1RoundTripAddsOnlyTheCountDelta() {
  const reviewEvents = Array.from({ length: 5 }, (_, index) => ({
    id: `uuid-${index + 1}`,
    kind: 'review',
    reviewedAt: 1000 + index,
    quality: 2,
  }));
  const merged = mergeQuestionPayload(
    {
      id: 'q1',
      reviewCount: 5,
      reviewEvents,
      reviewUpdatedAt: 1004,
      updatedAt: 1004,
    },
    {
      id: 'q1',
      reviewCount: 6,
      lastReviewedAt: 2000,
      reviewUpdatedAt: 2000,
      updatedAt: 2000,
    }
  );
  assert.equal(merged.reviewCount, 6);
  assert.equal(merged.reviewEvents.length, 6);
  assert.equal(merged.reviewEvents.at(-1).id, 'legacy-v1-review:q1:6:1');
}

function testReviewRevertReplaysScheduleDeterministically() {
  const day = 24 * 60 * 60 * 1000;
  const merged = mergeQuestionPayload(
    {
      id: 'q1',
      createdAt: 500,
      reviewEvents: [
        { id: 'r1', kind: 'review', reviewedAt: 1000, quality: 2 },
        { id: 'r2', kind: 'review', reviewedAt: 2000, quality: 2 },
      ],
      reviewCount: 2,
      reviewUpdatedAt: 2000,
      updatedAt: 2000,
    },
    {
      id: 'q1',
      reviewEvents: [
        { id: 'r1', kind: 'review', reviewedAt: 1000, quality: 2 },
        { id: 'r2', kind: 'review', reviewedAt: 2000, quality: 2 },
        {
          id: 'undo-r2',
          kind: 'revert',
          reviewedAt: 3000,
          targetEventId: 'r2',
        },
      ],
      reviewCount: 1,
      reviewUpdatedAt: 3000,
      updatedAt: 3000,
    }
  );
  assert.equal(merged.reviewCount, 1);
  assert.equal(new Date(merged.nextReviewAt).getTime(), 1000 + day);
  assert.equal(new Date(merged.lastReviewedAt).getTime(), 1000);
}

function testPostponeAfterLatestEventKeepsScheduleOverride() {
  const postponedAt = 10 * 24 * 60 * 60 * 1000;
  const merged = mergeQuestionPayload(
    {
      id: 'q1',
      reviewEvents: [
        { id: 'r1', kind: 'review', reviewedAt: 1000, quality: 2 },
      ],
      reviewCount: 1,
      reviewUpdatedAt: 1000,
      nextReviewAt: 1000 + 24 * 60 * 60 * 1000,
      updatedAt: 1000,
    },
    {
      id: 'q1',
      reviewEvents: [
        { id: 'r1', kind: 'review', reviewedAt: 1000, quality: 2 },
      ],
      reviewCount: 1,
      reviewUpdatedAt: 5000,
      nextReviewAt: postponedAt,
      updatedAt: 5000,
    }
  );
  assert.equal(new Date(merged.nextReviewAt).getTime(), postponedAt);
}

function testAiAndFollowUpMerge() {
  const merged = mergeQuestionPayload(
    {
      id: 'q1',
      detailedExplanation: 'old explanation',
      explanationContentUpdatedAt: 1000,
      followUpChats: [
        { id: 'a', role: 'user', content: 'left', createdAt: 1000 },
      ],
      updatedAt: 1000,
    },
    {
      id: 'q1',
      detailedExplanation: 'new explanation',
      explanationContentUpdatedAt: 4000,
      followUpChats: [
        { id: 'b', role: 'assistant', content: 'right', createdAt: 2000 },
      ],
      updatedAt: 4000,
    }
  );
  assert.equal(merged.detailedExplanation, 'new explanation');
  assert.deepEqual(
    merged.followUpChats.map((chat) => chat.id),
    ['a', 'b']
  );
}

function testLegacyFollowUpIdsConvergeWithoutDuplicates() {
  const legacyChat = {
    role: 'user',
    content: '同一条旧追问',
    createdAt: '2026-01-02T03:04:05.000Z',
  };
  const oldWindowsChat = {
    ...legacyChat,
    id: 'legacy-chat-deadbeefdeadbeefdeadbeefdeadbeef',
  };

  const bothMissing = mergeQuestionPayload(
    { id: 'q1', followUpChats: [legacyChat] },
    { id: 'q1', followUpChats: [{ ...legacyChat }] }
  );
  assert.equal(bothMissing.followUpChats.length, 1);

  const mixed = mergeQuestionPayload(
    { id: 'q1', followUpChats: [legacyChat] },
    { id: 'q1', followUpChats: [oldWindowsChat] }
  );
  const swapped = mergeQuestionPayload(
    { id: 'q1', followUpChats: [oldWindowsChat] },
    { id: 'q1', followUpChats: [legacyChat] }
  );
  assert.equal(mixed.followUpChats.length, 1);
  assert.deepEqual(mixed.followUpChats, swapped.followUpChats);
  assert.match(mixed.followUpChats[0].id, /^legacy-followup-[a-f0-9]{64}$/);
}

function testLegacyFollowUpIdMatchesCrossPlatformVector() {
  assert.equal(
    legacyFollowUpId(
      'question-跨端-01',
      {
        role: '用户',
        content: '这道题为什么要先移项？',
        createdAt: 1712345678901,
      },
      3,
      0
    ),
    'legacy-followup-9419bc3bb888bc3cb57ddc49dc74bb8e6db72e5d4819bf5500efbbcf383b68fc'
  );
}

function testNormalActivityNeverRestoresDeletion() {
  const merged = mergeQuestionPayload(
    {
      id: 'q1',
      deleted: true,
      deletedAt: 3000,
      updatedAt: 3000,
    },
    {
      id: 'q1',
      deleted: false,
      notes: 'edited much later',
      notesUpdatedAt: 9000,
      reviewUpdatedAt: 10000,
      followUpContentUpdatedAt: 11000,
      updatedAt: 11000,
    }
  );
  assert.equal(merged.deleted, true);
  assert.equal(new Date(merged.deletedAt).getTime(), 3000);
}

function testOnlyExplicitNewerRestoreWins() {
  const restored = mergeQuestionPayload(
    {
      id: 'q1',
      deleted: true,
      deletedAt: 3000,
      updatedAt: 3000,
    },
    {
      id: 'q1',
      deleted: false,
      restoredAt: 5000,
      updatedAt: 5000,
    }
  );
  assert.equal(restored.deleted, false);
  assert.equal(new Date(restored.deletedAt).getTime(), 3000);
  assert.equal(new Date(restored.restoredAt).getTime(), 5000);

  const deletedAgain = mergeQuestionPayload(restored, {
    id: 'q1',
    deleted: true,
    deletedAt: 7000,
    updatedAt: 7000,
  });
  assert.equal(deletedAgain.deleted, true);
  assert.equal(new Date(deletedAgain.deletedAt).getTime(), 7000);
}

function testStaleAliveCopyDoesNotRestore() {
  const merged = mergeQuestionPayload(
    { id: 'q1', deleted: true, deletedAt: 3000, updatedAt: 3000 },
    { id: 'q1', deleted: false, updatedAt: 1000 }
  );
  assert.equal(merged.deleted, true);
}

function testCanonicalImagesAreStoredOnceAndIdsCannotCollide() {
  const first = canonicalizeImages({
    id: 'q1',
    image: dataUrl('first'),
    imageRefs: [
      { id: 'same-id', storage: 'inline', dataUrl: dataUrl('first') },
    ],
    imageRefsComplete: true,
    imageRefsUpdatedAt: 1000,
  });
  const second = canonicalizeImages({
    id: 'q2',
    imageRefs: [
      { id: 'same-id', storage: 'inline', dataUrl: dataUrl('second') },
    ],
    imageRefsComplete: true,
    imageRefsUpdatedAt: 1000,
  });

  assert.equal(first.image, undefined);
  assert.equal(first.imageRefs.length, 1);
  assert.notEqual(first.imageRefs[0].id, second.imageRefs[0].id);
  const expectedHash = crypto.createHash('sha256').update(Buffer.from('first')).digest('hex');
  assert.equal(first.imageRefs[0].contentHash, expectedHash);
  assert.match(first.imageRefs[0].contentHash, /^[a-f0-9]{64}$/);
}

function testImageHashUsesDecodedBytesAndRejectsMismatch() {
  const bytes = Buffer.from('same raw bytes');
  const expectedHash = crypto.createHash('sha256').update(bytes).digest('hex');
  const valid = normalizeImageRef({
    id: 'client-id',
    storage: 'inline',
    dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
    contentHash: `sha256:${expectedHash.toUpperCase()}`,
  });
  assert.equal(valid.contentHash, expectedHash);
  assert.equal(valid.status, undefined);
  assert.equal(valid.id, `img-${expectedHash.slice(0, 32)}`);

  const wrongHash = '0'.repeat(64);
  const mismatch = normalizeImageRef({
    id: 'client-id',
    storage: 'inline',
    dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
    contentHash: wrongHash,
  });
  assert.equal(mismatch.contentHash, wrongHash);
  assert.equal(mismatch.status, 'unavailable');
  assert.equal(mismatch.dataUrl, undefined);
}

function testUnreadableOrMissingImageNeverErasesGoodServerImage() {
  const existing = {
    id: 'q1',
    imageRefs: [
      { id: 'good', storage: 'inline', dataUrl: dataUrl('good') },
    ],
    imageRefsComplete: true,
    imageRefsUpdatedAt: 1000,
    contentUpdatedAt: 1000,
    updatedAt: 1000,
  };
  const unreadable = mergeQuestionPayload(existing, {
    id: 'q1',
    imageRefs: [{ id: 'good', storage: 'file', uri: 'file:///missing.png' }],
    imageRefsComplete: false,
    imageRefsUpdatedAt: 5000,
    contentUpdatedAt: 5000,
    updatedAt: 5000,
  });
  assert.equal(unreadable.imageRefs.length, 1);
  assert.equal(unreadable.imageRefs[0].dataUrl, dataUrl('good'));

  const accidentalEmpty = mergeQuestionPayload(existing, {
    id: 'q1',
    imageRefs: [],
    contentUpdatedAt: 6000,
    updatedAt: 6000,
  });
  assert.equal(accidentalEmpty.imageRefs.length, 1);
}

function testExplicitCompleteImageClearRequiresNewGroupTimestamp() {
  const existing = {
    id: 'q1',
    imageRefs: [
      { id: 'good', storage: 'inline', dataUrl: dataUrl('good') },
    ],
    imageRefsComplete: true,
    imageRefsUpdatedAt: 5000,
    updatedAt: 5000,
  };
  const staleClear = mergeQuestionPayload(existing, {
    id: 'q1',
    imageRefs: [],
    imageRefsComplete: true,
    imageRefsUpdatedAt: 4000,
    updatedAt: 6000,
  });
  assert.equal(staleClear.imageRefs.length, 1);

  const clear = mergeQuestionPayload(existing, {
    id: 'q1',
    imageRefs: [],
    imageRefsComplete: true,
    imageRefsUpdatedAt: 7000,
    updatedAt: 7000,
  });
  assert.deepEqual(clear.imageRefs, []);
}

function testStalePartialImageCannotResurrectRemovedImage() {
  const merged = mergeQuestionPayload(
    {
      id: 'q1',
      imageRefs: [],
      imageRefsComplete: true,
      imageRefsUpdatedAt: 5000,
      updatedAt: 5000,
    },
    {
      id: 'q1',
      imageRefs: [{ id: 'removed', dataUrl: dataUrl('removed') }],
      imageRefsComplete: false,
      imageRefsUpdatedAt: 1000,
      updatedAt: 1000,
    }
  );
  assert.deepEqual(merged.imageRefs, []);
}

function testNextReviewAtDoesNotPolluteUpdatedAt() {
  const updatedAt = '2026-01-01T00:00:00.000Z';
  const nextReviewAt = '2027-01-01T00:00:00.000Z';
  const merged = mergeQuestionPayload(
    {},
    {
      id: 'q1',
      updatedAt,
      reviewUpdatedAt: updatedAt,
      nextReviewAt,
    }
  );
  assert.equal(merged.updatedAt, updatedAt);
  assert.equal(computeRecordUpdatedAtMs(merged), Date.parse(updatedAt));
}

function testCompactedTombstoneKeepsPermanentDeleteMarker() {
  const compacted = compactTombstonePayload({
    id: 'q1',
    title: 'large payload',
    imageRefs: [{ dataUrl: dataUrl('large') }],
    deleted: true,
    deletedAt: 3000,
    updatedAt: 3000,
  });
  assert.deepEqual(compacted, {
    id: 'q1',
    title: 'large payload',
    category: '其他',
    createdAt: '1970-01-01T00:00:03.000Z',
    deleted: true,
    syncStatus: 'synced',
    protocolVersion: 2,
    tombstoneCompacted: true,
    updatedAt: '1970-01-01T00:00:03.000Z',
    deletedAt: '1970-01-01T00:00:03.000Z',
  });
}

function testCompactedTombstoneCannotBeReinflatedByOfflineCopy() {
  const compacted = compactTombstonePayload({
    id: 'q1',
    title: 'original',
    category: '数学',
    createdAt: 1000,
    updatedAt: 3000,
    deleted: true,
    deletedAt: 3000,
  });
  const merged = mergeQuestionPayload(compacted, {
    id: 'q1',
    title: 'stale full copy',
    category: '数学',
    createdAt: 1000,
    updatedAt: 2000,
    deleted: false,
    notes: 'large stale notes',
    detailedExplanation: 'large stale AI result',
    imageRefs: [{ id: 'stale', dataUrl: dataUrl('stale') }],
  });
  assert.equal(merged.deleted, true);
  assert.equal(merged.tombstoneCompacted, true);
  assert.equal(merged.notes, undefined);
  assert.equal(merged.detailedExplanation, undefined);
  assert.equal(merged.imageRefs, undefined);
  assert.equal(merged.title, 'original');
  assert.equal(typeof merged.category, 'string');
  assert.equal(typeof merged.createdAt, 'string');
  assert.deepEqual(
    normalizeStoragePayload(merged),
    normalizeStoragePayload(compacted)
  );
}

function testCursorRoundTripAndBytePaging() {
  const cursor = encodeCursor('42', '题目/abc');
  assert.deepEqual(decodeCursor(cursor), {
    generation: '42',
    afterId: '题目/abc',
  });
  assert.throws(() => decodeCursor('not-a-cursor'), /INVALID_CURSOR/);

  const rows = [
    { id: 'a', payload: { id: 'a', title: 'a'.repeat(200) } },
    { id: 'b', payload: { id: 'b', title: 'b'.repeat(200) } },
  ];
  const page = pageByByteTarget(rows, 300, 2000);
  assert.equal(page.length, 1);
}

function testSchemaMigratesWithoutDeletingTombstones() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  assert.match(schema, /CREATE SEQUENCE IF NOT EXISTS question_records_revision_seq/i);
  assert.match(schema, /ADD COLUMN IF NOT EXISTS revision/i);
  assert.doesNotMatch(schema, /DELETE\s+FROM\s+question_records/i);
}

function testTombstoneCompactionIsLosslessByDefault() {
  const compactDays = process.env.TOMBSTONE_COMPACT_AFTER_DAYS;
  const legacyDays = process.env.TOMBSTONE_RETENTION_DAYS;
  delete process.env.TOMBSTONE_COMPACT_AFTER_DAYS;
  delete process.env.TOMBSTONE_RETENTION_DAYS;
  try {
    assert.equal(getTombstoneCompactCutoffMs(), 0);
  } finally {
    if (compactDays === undefined) {
      delete process.env.TOMBSTONE_COMPACT_AFTER_DAYS;
    } else {
      process.env.TOMBSTONE_COMPACT_AFTER_DAYS = compactDays;
    }
    if (legacyDays === undefined) {
      delete process.env.TOMBSTONE_RETENTION_DAYS;
    } else {
      process.env.TOMBSTONE_RETENTION_DAYS = legacyDays;
    }
  }
}

function testLegacyDuplicatedImagesForceCanonicalStorageRewrite() {
  const image = dataUrl('one stored image');
  const legacyPayload = {
    id: 'legacy-double-image',
    title: 'legacy',
    category: '数学',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    image,
    imageRefs: [
      {
        id: 'legacy-image',
        kind: 'question',
        storage: 'inline',
        dataUrl: image,
      },
    ],
  };
  const canonical = normalizeStoragePayload(legacyPayload);

  assert.equal(canonical.image, undefined);
  assert.equal(canonical.imageRefs.length, 1);
  assert.equal(storagePayloadNeedsRewrite(legacyPayload, canonical), true);
  assert.equal(storagePayloadNeedsRewrite(canonical, canonical), false);
}

testFieldLevelMerge();
testEqualTimestampMergeIsDeterministic();
testConcurrentReviewEventsAreBothCounted();
testLegacyReviewCountDoesNotDoubleAcrossDevices();
testReviewRevertCanReduceCount();
testLegacyV1RoundTripAddsOnlyTheCountDelta();
testReviewRevertReplaysScheduleDeterministically();
testPostponeAfterLatestEventKeepsScheduleOverride();
testAiAndFollowUpMerge();
testLegacyFollowUpIdsConvergeWithoutDuplicates();
testLegacyFollowUpIdMatchesCrossPlatformVector();
testNormalActivityNeverRestoresDeletion();
testOnlyExplicitNewerRestoreWins();
testStaleAliveCopyDoesNotRestore();
testCanonicalImagesAreStoredOnceAndIdsCannotCollide();
testImageHashUsesDecodedBytesAndRejectsMismatch();
testUnreadableOrMissingImageNeverErasesGoodServerImage();
testExplicitCompleteImageClearRequiresNewGroupTimestamp();
testStalePartialImageCannotResurrectRemovedImage();
testNextReviewAtDoesNotPolluteUpdatedAt();
testCompactedTombstoneKeepsPermanentDeleteMarker();
testCompactedTombstoneCannotBeReinflatedByOfflineCopy();
testCursorRoundTripAndBytePaging();
testSchemaMigratesWithoutDeletingTombstones();
testTombstoneCompactionIsLosslessByDefault();
testLegacyDuplicatedImagesForceCanonicalStorageRewrite();

console.log('merge tests passed');
