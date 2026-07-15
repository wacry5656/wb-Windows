import { Question, ReviewQuality } from '../types/question';
import { calculateNextReviewAt } from './questionModel';
import { getEffectiveReviewCount, getEffectiveReviewEvents } from './questionModel';
import { applyQuestionUpdates } from './questionService';

interface ReviewOptions {
  now?: string;
}

export function markQuestionReviewed(
  question: Question,
  qualityOrOptions: ReviewQuality | ReviewOptions = 2,
  options: ReviewOptions = {}
): Question {
  const quality =
    typeof qualityOrOptions === 'number' ? qualityOrOptions : 2;
  const mutationOptions =
    typeof qualityOrOptions === 'number' ? options : qualityOrOptions;
  const timestamp = mutationOptions.now || new Date().toISOString();
  const reviewEvent = {
    id: createReviewEventId('review'),
    kind: 'review' as const,
    reviewedAt: timestamp,
    quality,
  };
  const reviewEvents = [...question.reviewEvents, reviewEvent];
  const nextReviewCount = getEffectiveReviewCount(reviewEvents);
  const nextReviewAt = calculateNextReviewAt(timestamp, nextReviewCount);
  const nextMasteryLevel = getNextMasteryLevel(question.masteryLevel, quality);

  return applyQuestionUpdates(
    question,
    {
      reviewCount: nextReviewCount,
      reviewEvents,
      lastReviewedAt: timestamp,
      nextReviewAt:
        quality === 0
          ? new Date(new Date(timestamp).getTime() + 10 * 60 * 1000).toISOString()
          : quality === 1
            ? new Date(new Date(timestamp).getTime() + 24 * 60 * 60 * 1000).toISOString()
            : quality === 3
              ? extendReviewDate(nextReviewAt, timestamp)
              : nextReviewAt,
      reviewStatus: 'reviewing',
      masteryLevel: nextMasteryLevel,
      reviewUpdatedAt: timestamp,
    },
    { now: timestamp }
  );
}

export function revertLastReview(
  question: Question,
  options: ReviewOptions = {}
): Question {
  const timestamp = options.now || new Date().toISOString();
  const effectiveReviews = getEffectiveReviewEvents(question.reviewEvents)
    .filter((event) => event.quality === 1 || event.quality === 2 || event.quality === 3)
    .sort((left, right) => right.reviewedAt.localeCompare(left.reviewedAt));
  const target = effectiveReviews[0];
  if (!target) {
    return question;
  }

  const reviewEvents = [
    ...question.reviewEvents,
    {
      id: createReviewEventId('revert'),
      kind: 'revert' as const,
      reviewedAt: timestamp,
      targetEventId: target.id,
    },
  ];
  const remainingReviews = getEffectiveReviewEvents(reviewEvents);
  const derived = deriveReviewState(remainingReviews, question.createdAt);

  return applyQuestionUpdates(
    question,
    {
      reviewEvents,
      reviewCount: derived.reviewCount,
      lastReviewedAt: derived.lastReviewedAt,
      nextReviewAt: derived.nextReviewAt,
      reviewStatus: remainingReviews.length > 0 ? 'reviewing' : 'new',
      masteryLevel: derived.masteryLevel,
      reviewUpdatedAt: timestamp,
    },
    { now: timestamp }
  );
}

export function postponeReview(
  question: Question,
  options: ReviewOptions = {}
): Question {
  const timestamp = options.now || new Date().toISOString();
  const postponedAt = new Date(new Date(timestamp).getTime() + 24 * 60 * 60 * 1000).toISOString();

  return applyQuestionUpdates(
    question,
    {
      nextReviewAt: postponedAt,
      reviewUpdatedAt: timestamp,
    },
    { now: timestamp }
  );
}

function getNextMasteryLevel(current: number, quality: ReviewQuality): number {
  switch (quality) {
    case 0:
      return 0;
    case 1:
      return Math.max(current, 1);
    case 2:
      return Math.max(current, 3);
    case 3:
      return 5;
  }
}

function extendReviewDate(nextReviewAt: string, baseDate: string): string {
  const next = new Date(nextReviewAt).getTime();
  const base = new Date(baseDate).getTime();
  if (!Number.isFinite(next) || !Number.isFinite(base) || next <= base) {
    return nextReviewAt;
  }

  return new Date(base + (next - base) * 2).toISOString();
}

function deriveReviewState(events: Question['reviewEvents'], createdAt: string) {
  let reviewCount = 0;
  let masteryLevel = 0;
  let lastReviewedAt: string | undefined;
  let nextReviewAt = calculateNextReviewAt(createdAt, 0);

  const ordered = [...events].sort((left, right) =>
    left.reviewedAt === right.reviewedAt
      ? left.id.localeCompare(right.id)
      : left.reviewedAt.localeCompare(right.reviewedAt)
  );
  for (const event of ordered) {
    if (event.kind !== 'review') {
      continue;
    }
    const quality = event.quality ?? 0;
    lastReviewedAt = event.reviewedAt;
    masteryLevel = getNextMasteryLevel(masteryLevel, quality);
    if (quality > 0) {
      reviewCount += 1;
    }
    const standardNext = calculateNextReviewAt(event.reviewedAt, reviewCount);
    nextReviewAt =
      quality === 0
        ? new Date(new Date(event.reviewedAt).getTime() + 10 * 60 * 1000).toISOString()
        : quality === 1
          ? new Date(new Date(event.reviewedAt).getTime() + 24 * 60 * 60 * 1000).toISOString()
          : quality === 3
            ? extendReviewDate(standardNext, event.reviewedAt)
            : standardNext;
  }

  return { reviewCount, masteryLevel, lastReviewedAt, nextReviewAt };
}

function createReviewEventId(kind: 'review' | 'revert'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${kind}-${crypto.randomUUID()}`;
  }
  return `${kind}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
