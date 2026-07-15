import {
  applyQuestionUpdates,
  createQuestion,
  deleteQuestionById,
  restoreQuestionById,
} from './questionService';
import {
  normalizeServerSnapshot,
  reconcileServerSnapshot,
} from './questionSyncService';

function makeQuestion(id: string, title: string, now: string) {
  return {
    ...createQuestion(title, '', '数学', {
      questionText: 'text',
      now,
    }),
    id,
  };
}

describe('question sync reconciliation', () => {
  test('replays a local edit made while the request was in flight', () => {
    const pushed = makeQuestion('q1', 'before', '2026-07-16T01:00:00.000Z');
    const current = applyQuestionUpdates(
      pushed,
      { notes: 'edited during sync' },
      { now: '2026-07-16T01:01:00.000Z' }
    );
    const remote = {
      ...pushed,
      syncStatus: 'synced' as const,
    };

    const reconciled = reconcileServerSnapshot([pushed], [remote], [current]);

    expect(reconciled.pendingLocalChangeCount).toBe(1);
    expect(reconciled.questions[0].notes).toBe('edited during sync');
    expect(reconciled.questions[0].syncStatus).toBe('modified');
  });

  test('keeps a question and its file ref when it is created during sync', () => {
    const created = {
      ...makeQuestion('new', 'new question', '2026-07-16T01:01:00.000Z'),
      image: 'file:///data/images/new.png',
      imageRefs: [
        {
          id: 'img-new',
          storage: 'file' as const,
          kind: 'question' as const,
          uri: 'file:///data/images/new.png',
          createdAt: '2026-07-16T01:01:00.000Z',
        },
      ],
    };

    const reconciled = reconcileServerSnapshot([], [], [created]);
    expect(reconciled.questions).toEqual([created]);
  });

  test('remote tombstone wins over an in-flight ordinary edit or AI activity', () => {
    const pushed = {
      ...makeQuestion('deleted-remotely', 'before', '2026-07-16T01:00:00.000Z'),
      // A restore marker already present before the request is not a new restore intent.
      restoredAt: '2026-07-16T00:30:00.000Z',
    };
    const current = applyQuestionUpdates(
      pushed,
      {
        notes: 'ordinary local activity',
        detailedExplanation: 'new AI output',
      },
      { now: '2026-07-16T01:03:00.000Z' }
    );
    const remoteTombstone = {
      ...pushed,
      deleted: true,
      deletedAt: '2026-07-16T01:02:00.000Z',
      updatedAt: '2026-07-16T01:02:00.000Z',
      syncStatus: 'synced' as const,
    };

    const reconciled = reconcileServerSnapshot(
      [pushed],
      [remoteTombstone],
      [current]
    );

    expect(reconciled.pendingLocalChangeCount).toBe(0);
    expect(reconciled.questions[0]).toEqual(remoteTombstone);
    expect(reconciled.questions[0].deleted).toBe(true);
  });

  test('an explicit local restore newer than the remote tombstone is replayed', () => {
    const active = makeQuestion('explicit-restore', 'restore me', '2026-07-16T01:00:00.000Z');
    const [pushedTombstone] = deleteQuestionById([active], active.id, {
      now: '2026-07-16T01:01:00.000Z',
    });
    const [currentRestored] = restoreQuestionById(
      [pushedTombstone],
      pushedTombstone.id,
      { now: '2026-07-16T01:03:00.000Z' }
    );
    const remoteTombstone = {
      ...pushedTombstone,
      deletedAt: '2026-07-16T01:02:00.000Z',
      updatedAt: '2026-07-16T01:02:00.000Z',
      syncStatus: 'synced' as const,
    };

    const reconciled = reconcileServerSnapshot(
      [pushedTombstone],
      [remoteTombstone],
      [currentRestored]
    );

    expect(reconciled.pendingLocalChangeCount).toBe(1);
    expect(reconciled.questions[0].deleted).toBe(false);
    expect(reconciled.questions[0].restoredAt).toBe('2026-07-16T01:03:00.000Z');
  });

  test('an explicit local deletion made in flight is replayed over an active remote row', () => {
    const pushed = makeQuestion('deleted-locally', 'before', '2026-07-16T01:00:00.000Z');
    const [currentDeleted] = deleteQuestionById([pushed], pushed.id, {
      now: '2026-07-16T01:03:00.000Z',
    });
    const remote = {
      ...pushed,
      title: 'remote edit',
      contentUpdatedAt: '2026-07-16T01:02:00.000Z',
      updatedAt: '2026-07-16T01:02:00.000Z',
      syncStatus: 'synced' as const,
    };

    const reconciled = reconcileServerSnapshot([pushed], [remote], [currentDeleted]);

    expect(reconciled.pendingLocalChangeCount).toBe(1);
    expect(reconciled.questions[0].deleted).toBe(true);
  });

  test('removes unchanged local rows absent from a complete remote snapshot', () => {
    const pushed = makeQuestion('purged', 'purged', '2026-07-16T01:00:00.000Z');
    const reconciled = reconcileServerSnapshot([pushed], [], [pushed]);
    expect(reconciled.questions).toEqual([]);
    expect(reconciled.pendingLocalChangeCount).toBe(0);
  });

  test('does not revive a remotely absent row after an in-flight local edit', () => {
    const pushed = makeQuestion('legacy-purged', 'before', '2026-07-16T01:00:00.000Z');
    const current = applyQuestionUpdates(
      pushed,
      { notes: 'edited after push' },
      { now: '2026-07-16T01:03:00.000Z' }
    );

    const reconciled = reconcileServerSnapshot([pushed], [], [current]);

    expect(reconciled.questions).toEqual([]);
    expect(reconciled.pendingLocalChangeCount).toBe(0);
  });

  test('does not recreate a remotely absent row just to upload another tombstone', () => {
    const pushed = makeQuestion('already-purged', 'before', '2026-07-16T01:00:00.000Z');
    const [currentDeleted] = deleteQuestionById([pushed], pushed.id, {
      now: '2026-07-16T01:03:00.000Z',
    });

    const reconciled = reconcileServerSnapshot([pushed], [], [currentDeleted]);

    expect(reconciled.questions).toEqual([]);
    expect(reconciled.pendingLocalChangeCount).toBe(0);
  });

  test('replays an explicit restore of a pushed tombstone even after remote purge', () => {
    const active = makeQuestion('purged-restore', 'restore me', '2026-07-16T01:00:00.000Z');
    const [pushedTombstone] = deleteQuestionById([active], active.id, {
      now: '2026-07-16T01:01:00.000Z',
    });
    const [currentRestored] = restoreQuestionById(
      [pushedTombstone],
      pushedTombstone.id,
      { now: '2026-07-16T01:03:00.000Z' }
    );

    const reconciled = reconcileServerSnapshot(
      [pushedTombstone],
      [],
      [currentRestored]
    );

    expect(reconciled.pendingLocalChangeCount).toBe(1);
    expect(reconciled.questions).toHaveLength(1);
    expect(reconciled.questions[0]).toEqual(
      expect.objectContaining({ deleted: false, id: 'purged-restore' })
    );
  });

  test('accepts an empty snapshot and rejects malformed or duplicate records', () => {
    expect(normalizeServerSnapshot([])).toEqual([]);
    expect(() => normalizeServerSnapshot([{ id: 'bad' }])).toThrow(
      'SYNC_INVALID_REMOTE_RECORDS'
    );

    const record = makeQuestion('duplicate', 'duplicate', '2026-07-16T01:00:00.000Z');
    expect(() => normalizeServerSnapshot([record, record])).toThrow(
      'SYNC_DUPLICATE_REMOTE_ID'
    );
  });
});
