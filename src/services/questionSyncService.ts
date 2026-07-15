import { Question } from '../types/question';
import { normalizeQuestions } from './questionModel';

export interface ReconciledSnapshot {
  questions: Question[];
  pendingLocalChangeCount: number;
}

/**
 * Treats a completed pull as an authoritative snapshot while replaying edits
 * committed after the matching push started. This avoids both stale local rows
 * surviving a server purge and in-flight local edits being overwritten.
 */
export function reconcileServerSnapshot(
  pushedSnapshot: Question[],
  remoteSnapshot: Question[],
  currentLocal: Question[]
): ReconciledSnapshot {
  const pushedById = new Map(pushedSnapshot.map((question) => [question.id, question]));
  const remoteById = new Map(remoteSnapshot.map((question) => [question.id, question]));
  const remoteOrder = remoteSnapshot.map((question) => question.id);
  let pendingLocalChangeCount = 0;

  for (const localQuestion of currentLocal) {
    const pushedQuestion = pushedById.get(localQuestion.id);
    if (pushedQuestion && areQuestionsEquivalent(pushedQuestion, localQuestion)) {
      continue;
    }

    const remoteQuestion = remoteById.get(localQuestion.id);
    if (
      pushedQuestion &&
      !remoteQuestion &&
      !isExplicitRestoreAfterMissingRecord(pushedQuestion, localQuestion)
    ) {
      // A record missing from a complete snapshot is an authoritative delete
      // (notably after a legacy server has purged its tombstone). Replaying an
      // ordinary edit or another local tombstone would recreate the row.
      continue;
    }
    if (
      remoteQuestion?.deleted === true &&
      localQuestion.deleted !== true &&
      !isExplicitRestoreAfterRemoteDeletion(
        pushedQuestion,
        localQuestion,
        remoteQuestion
      )
    ) {
      // Deletion is an independent, dominant state. Notes, review, AI, and
      // ordinary content edits made in flight must never revive a tombstone.
      continue;
    }

    pendingLocalChangeCount += 1;
    remoteById.set(localQuestion.id, {
      ...localQuestion,
      syncStatus: localQuestion.syncStatus === 'pending' ? 'pending' : 'modified',
    });
    if (!remoteOrder.includes(localQuestion.id)) {
      remoteOrder.unshift(localQuestion.id);
    }
  }

  return {
    questions: remoteOrder
      .map((id) => remoteById.get(id))
      .filter((question): question is Question => Boolean(question)),
    pendingLocalChangeCount,
  };
}

export function normalizeServerSnapshot(records: unknown[]): Question[] {
  const normalized = normalizeQuestions(records);
  if (normalized.length !== records.length) {
    throw new Error('SYNC_INVALID_REMOTE_RECORDS');
  }

  const seenIds = new Set<string>();
  for (const question of normalized) {
    if (seenIds.has(question.id)) {
      throw new Error('SYNC_DUPLICATE_REMOTE_ID');
    }
    seenIds.add(question.id);
  }

  return normalized.map((question) => ({
    ...question,
    syncStatus: 'synced' as const,
  }));
}

function areQuestionsEquivalent(left: Question, right: Question): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isExplicitRestoreAfterMissingRecord(
  pushedQuestion: Question,
  localQuestion: Question
): boolean {
  if (pushedQuestion.deleted !== true || localQuestion.deleted === true) {
    return false;
  }
  const localRestoredAt = toMillis(localQuestion.restoredAt);
  return (
    localRestoredAt > toMillis(pushedQuestion.restoredAt) &&
    localRestoredAt > toMillis(pushedQuestion.deletedAt || pushedQuestion.updatedAt)
  );
}

function isExplicitRestoreAfterRemoteDeletion(
  pushedQuestion: Question | undefined,
  localQuestion: Question,
  remoteQuestion: Question
): boolean {
  const localRestoredAt = toMillis(localQuestion.restoredAt);
  const pushedRestoredAt = toMillis(pushedQuestion?.restoredAt);
  const remoteDeletedAt = toMillis(
    remoteQuestion.deletedAt || remoteQuestion.updatedAt
  );

  return (
    localRestoredAt > 0 &&
    localRestoredAt > pushedRestoredAt &&
    localRestoredAt > remoteDeletedAt
  );
}

function toMillis(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}
