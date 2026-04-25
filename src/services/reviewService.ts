import { Question, ReviewQuality } from '../types/question';
import { calculateNextReviewAt } from './questionModel';
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
  const nextReviewCount = quality === 0 ? question.reviewCount : question.reviewCount + 1;
  const nextReviewAt = calculateNextReviewAt(timestamp, nextReviewCount);
  const nextMasteryLevel = getNextMasteryLevel(question.masteryLevel, quality);

  return applyQuestionUpdates(
    question,
    {
      reviewCount: nextReviewCount,
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
