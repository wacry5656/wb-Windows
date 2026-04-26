const assert = require('assert/strict');
const { mergeQuestionPayload, computeRecordUpdatedAtMs } = require('./server');

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
}

function testReviewMerge() {
  const merged = mergeQuestionPayload(
    {
      id: 'q1',
      reviewCount: 3,
      reviewUpdatedAt: 2000,
      masteryLevel: 4,
      updatedAt: 2000,
    },
    {
      id: 'q1',
      reviewCount: 1,
      reviewUpdatedAt: 3000,
      masteryLevel: 2,
      updatedAt: 3000,
    }
  );

  assert.equal(merged.reviewCount, 3);
  assert.equal(merged.masteryLevel, 2);
}

function testAiMerge() {
  const merged = mergeQuestionPayload(
    {
      id: 'q1',
      detailedExplanation: 'old explanation',
      explanationContentUpdatedAt: 1000,
      updatedAt: 1000,
    },
    {
      id: 'q1',
      detailedExplanation: 'new explanation',
      explanationContentUpdatedAt: 4000,
      updatedAt: 4000,
    }
  );

  assert.equal(merged.detailedExplanation, 'new explanation');
}

function testFollowUpMerge() {
  const merged = mergeQuestionPayload(
    {
      id: 'q1',
      followUpChats: [
        { id: 'a', role: 'user', content: 'left', createdAt: 1000 },
      ],
      followUpContentUpdatedAt: 1000,
      updatedAt: 1000,
    },
    {
      id: 'q1',
      followUpChats: [
        { id: 'b', role: 'assistant', content: 'right', createdAt: 2000 },
      ],
      followUpContentUpdatedAt: 2000,
      updatedAt: 2000,
    }
  );

  assert.deepEqual(
    merged.followUpChats.map((chat) => chat.id),
    ['a', 'b']
  );
}

function testDeleteMerge() {
  const merged = mergeQuestionPayload(
    {
      id: 'q1',
      deleted: false,
      updatedAt: 2000,
    },
    {
      id: 'q1',
      deleted: true,
      deletedAt: 3000,
      updatedAt: 1000,
    }
  );

  assert.equal(merged.deleted, true);
  assert.equal(new Date(merged.deletedAt).getTime(), 3000);
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
  assert.notEqual(computeRecordUpdatedAtMs(merged), Date.parse(nextReviewAt));
  assert.equal(computeRecordUpdatedAtMs(merged), Date.parse(updatedAt));
}

function testNotesMergeIgnoresNewerUpdatedAtWhenNotesTimestampIsOlder() {
  const merged = mergeQuestionPayload(
    {
      id: 'q1',
      notes: 'new notes',
      notesUpdatedAt: 3000,
      updatedAt: 3000,
    },
    {
      id: 'q1',
      notes: 'old notes',
      notesUpdatedAt: 1000,
      updatedAt: 4000,
    }
  );

  assert.equal(merged.notes, 'new notes');
  assert.equal(new Date(merged.updatedAt).getTime(), 4000);
}

function testConservativeDeletePreventsImplicitRestore() {
  const merged = mergeQuestionPayload(
    {
      id: 'q1',
      deleted: true,
      deletedAt: 2000,
      updatedAt: 2000,
    },
    {
      id: 'q1',
      deleted: false,
      updatedAt: 5000,
    }
  );

  assert.equal(merged.deleted, true);
  assert.equal(new Date(merged.deletedAt).getTime(), 2000);
}

function testDeletedAtFallsBackToUpdatedAt() {
  const merged = mergeQuestionPayload(
    {
      id: 'q1',
      deleted: true,
      updatedAt: 2500,
    },
    {
      id: 'q1',
      deleted: false,
      updatedAt: 5000,
    }
  );

  assert.equal(merged.deleted, true);
  assert.equal(new Date(merged.deletedAt).getTime(), 2500);
}

function testUpdatedAtMs() {
  const merged = mergeQuestionPayload(
    {
      id: 'q1',
      contentUpdatedAt: 1000,
      notesUpdatedAt: 2000,
    },
    {
      id: 'q1',
      hintContentUpdatedAt: 5000,
    }
  );

  assert.equal(computeRecordUpdatedAtMs(merged), 5000);
}

testFieldLevelMerge();
testReviewMerge();
testAiMerge();
testFollowUpMerge();
testDeleteMerge();
testNextReviewAtDoesNotPolluteUpdatedAt();
testNotesMergeIgnoresNewerUpdatedAtWhenNotesTimestampIsOlder();
testConservativeDeletePreventsImplicitRestore();
testDeletedAtFallsBackToUpdatedAt();
testUpdatedAtMs();

console.log('merge tests passed');
