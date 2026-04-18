import { Question } from '../types/question';
import { calculateNextReviewAt } from './questionModel';
import { applyQuestionUpdates } from './questionService';

interface ReviewOptions {
  now?: string;
}

export function markQuestionReviewed(
  question: Question,
  options: ReviewOptions = {}
): Question {
  const timestamp = options.now || new Date().toISOString();
  const nextReviewCount = question.reviewCount + 1;

  return applyQuestionUpdates(
    question,
    {
      reviewCount: nextReviewCount,
      lastReviewedAt: timestamp,
      nextReviewAt: calculateNextReviewAt(timestamp, nextReviewCount),
      reviewStatus: 'reviewing',
    },
    { now: timestamp }
  );
}
