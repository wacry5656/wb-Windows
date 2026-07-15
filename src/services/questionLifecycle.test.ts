import {
  createFileImageRef,
  getActiveQuestions,
  getImageRefDisplaySrc,
  isQuestionDueForReview,
  normalizeQuestions,
} from './questionModel';
import { markQuestionReviewed, revertLastReview } from './reviewService';
import {
  createQuestion,
  deleteQuestionById,
  restoreQuestionById,
  updateQuestionById,
} from './questionService';

describe('question lifecycle services', () => {
  test('createQuestion seeds sync and review metadata', () => {
    const question = createQuestion(
      '测试题目',
      'data:image/png;base64,abc',
      '数学',
      { now: '2026-04-17T00:00:00.000Z' }
    );

    expect(question).toEqual(
      expect.objectContaining({
        updatedAt: '2026-04-17T00:00:00.000Z',
        deleted: false,
        syncStatus: 'pending',
        reviewStatus: 'new',
        reviewCount: 0,
        nextReviewAt: '2026-04-18T00:00:00.000Z',
        notesUpdatedAt: undefined,
        noteImagesUpdatedAt: undefined,
        reviewUpdatedAt: undefined,
      })
    );
    expect(question.imageRefs).toHaveLength(1);
    expect(question.image).toBe('data:image/png;base64,abc');
    expect(isQuestionDueForReview(question, '2026-04-17T23:59:59.000Z')).toBe(false);
    expect(isQuestionDueForReview(question, '2026-04-18T00:00:00.000Z')).toBe(true);
  });

  test('normalizeQuestions migrates legacy records into new metadata shape', () => {
    const [question] = normalizeQuestions([
      {
        id: 'legacy-1',
        title: '旧题目',
        image: 'data:image/png;base64,legacy',
        noteImages: ['data:image/png;base64,note-1'],
        category: '数学',
        createdAt: '2026-04-10T00:00:00.000Z',
        notes: '',
        reviewCount: 2,
      },
    ]);

    expect(question).toEqual(
      expect.objectContaining({
        updatedAt: '2026-04-10T00:00:00.000Z',
        deleted: false,
        syncStatus: 'pending',
        reviewStatus: 'reviewing',
        reviewCount: 2,
      })
    );
    expect(question.imageRefs).toHaveLength(1);
    expect(question.noteImageRefs).toHaveLength(1);
    expect(question.nextReviewAt).toBeDefined();
  });

  test('normalizeQuestions backfills follow-up message ids for legacy records', () => {
    const legacyQuestions = [
      {
        id: 'legacy-chat-1',
        title: '旧追问',
        questionText: '旧题目内容',
        category: '数学',
        createdAt: '2026-04-10T00:00:00.000Z',
        followUpChats: [
          {
            role: 'user',
            content: '为什么这里要分类讨论？',
            createdAt: '2026-04-10T01:00:00.000Z',
          },
          {
            role: 'user',
            content: '为什么这里要分类讨论？',
            createdAt: '2026-04-10T01:00:00.000Z',
          },
        ],
      },
    ];
    const firstNormalization = normalizeQuestions(legacyQuestions);
    const secondNormalization = normalizeQuestions(legacyQuestions);
    const normalizedAgain = normalizeQuestions(firstNormalization);
    const [question] = firstNormalization;

    expect(secondNormalization).toEqual(firstNormalization);
    expect(normalizedAgain).toEqual(firstNormalization);
    expect(question.followUpChats).toHaveLength(2);
    expect(question.followUpChats?.[0]).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^legacy-followup-[a-f0-9]{64}$/),
        role: 'user',
        content: '为什么这里要分类讨论？',
        createdAt: '2026-04-10T01:00:00.000Z',
      })
    );
    expect(question.followUpChats?.[1].id).not.toBe(question.followUpChats?.[0].id);
  });

  test('deleteQuestionById keeps a sync tombstone and hides the record from active lists', () => {
    const question = createQuestion(
      '测试题目',
      'data:image/png;base64,abc',
      '数学',
      { now: '2026-04-17T00:00:00.000Z' }
    );

    const nextQuestions = deleteQuestionById([question], question.id);

    expect(nextQuestions).toHaveLength(1);
    expect(nextQuestions[0]).toEqual(
      expect.objectContaining({
        id: question.id,
        deleted: true,
        deletedAt: expect.any(String),
        syncStatus: 'modified',
      })
    );
    expect(getActiveQuestions(nextQuestions)).toEqual([]);
  });

  test('markQuestionReviewed updates schedule fields together and marks sync as modified', () => {
    const question = createQuestion(
      '测试题目',
      'data:image/png;base64,abc',
      '数学',
      { now: '2026-04-17T00:00:00.000Z' }
    );

    const reviewedQuestion = markQuestionReviewed(question, {
      now: '2026-04-18T08:00:00.000Z',
    });

    expect(reviewedQuestion).toEqual(
      expect.objectContaining({
        reviewCount: 1,
        lastReviewedAt: '2026-04-18T08:00:00.000Z',
        reviewStatus: 'reviewing',
        reviewUpdatedAt: '2026-04-18T08:00:00.000Z',
        updatedAt: '2026-04-18T08:00:00.000Z',
        syncStatus: 'modified',
      })
    );
    expect(reviewedQuestion.nextReviewAt).toBe('2026-04-19T08:00:00.000Z');
    expect(reviewedQuestion.reviewEvents).toEqual([
      expect.objectContaining({
        kind: 'review',
        quality: 2,
        reviewedAt: '2026-04-18T08:00:00.000Z',
      }),
    ]);
  });

  test('review events support an explicit rollback without max-count lock-in', () => {
    const question = createQuestion(
      'rollback',
      '',
      '数学',
      { questionText: '1 + 1 = ?', now: '2026-04-17T00:00:00.000Z' }
    );
    const first = markQuestionReviewed(question, 2, {
      now: '2026-04-18T00:00:00.000Z',
    });
    const second = markQuestionReviewed(first, 3, {
      now: '2026-04-19T00:00:00.000Z',
    });
    const reverted = revertLastReview(second, {
      now: '2026-04-19T00:01:00.000Z',
    });

    expect(second.reviewCount).toBe(2);
    expect(reverted.reviewCount).toBe(1);
    expect(reverted.reviewEvents[reverted.reviewEvents.length - 1]).toEqual(
      expect.objectContaining({
        kind: 'revert',
        targetEventId: second.reviewEvents[1].id,
      })
    );
  });

  test('reverting the only successful review restores the createdAt plus one-day schedule', () => {
    const question = createQuestion(
      'single rollback',
      '',
      '数学',
      { questionText: '1 + 1 = ?', now: '2026-04-17T00:00:00.000Z' }
    );
    const reviewed = markQuestionReviewed(question, 2, {
      now: '2026-04-18T08:00:00.000Z',
    });
    const reverted = revertLastReview(reviewed, {
      now: '2026-04-19T08:00:00.000Z',
    });

    expect(reverted.reviewCount).toBe(0);
    expect(reverted.nextReviewAt).toBe('2026-04-18T00:00:00.000Z');
  });

  test('legacy review counts become deterministic cross-device events', () => {
    const [question] = normalizeQuestions([
      {
        id: 'legacy-review-question',
        title: 'legacy',
        questionText: 'text',
        category: '数学',
        createdAt: '2026-04-10T00:00:00.000Z',
        reviewCount: 2,
        lastReviewedAt: '2026-04-12T00:00:00.000Z',
      },
    ]);

    expect(question.reviewEvents.map((event) => event.id)).toEqual([
      'legacy-review:legacy-review-question:1',
      'legacy-review:legacy-review-question:2',
    ]);
  });

  test('restore writes an explicit restoredAt later than the tombstone', () => {
    const question = createQuestion('restore', '', '数学', {
      questionText: 'text',
      now: '2026-04-17T00:00:00.000Z',
    });
    const deleted = deleteQuestionById([question], question.id, {
      now: '2026-04-18T00:00:00.000Z',
    });
    const restored = restoreQuestionById(deleted, question.id, {
      now: '2026-04-20T00:00:00.000Z',
    });

    expect(restored[0]).toEqual(
      expect.objectContaining({
        deleted: false,
        restoredAt: '2026-04-20T00:00:00.000Z',
        syncStatus: 'modified',
      })
    );
    expect(restored[0].deletedAt).toBeDefined();
  });

  test('restore stays newer than a tombstone from a clock-ahead device', () => {
    const question = createQuestion('clock skew', '', '数学', {
      questionText: 'text',
      now: '2026-04-17T00:00:00.000Z',
    });
    const deleted = deleteQuestionById([question], question.id, {
      now: '2027-01-01T00:00:00.000Z',
    });
    const restored = restoreQuestionById(deleted, question.id, {
      now: '2026-04-20T00:00:00.000Z',
    });

    expect(restored[0].restoredAt).toBe('2027-01-01T00:00:00.001Z');
    expect(restored[0].updatedAt).toBe('2027-01-01T00:00:00.001Z');
  });

  test('normalization preserves active title-only records instead of silently dropping them', () => {
    const questions = normalizeQuestions([
      {
        id: 'title-only',
        title: 'title only',
        category: '数学',
        createdAt: '2026-04-17T00:00:00.000Z',
      },
    ]);

    expect(questions).toHaveLength(1);
    expect(questions[0].image).toBe('');
    expect(questions[0].questionText).toBe('');
  });

  test('updateQuestionById refreshes updatedAt and marks sync as modified for content mutations', () => {
    const question = createQuestion(
      '测试题目',
      'data:image/png;base64,abc',
      '数学',
      { now: '2026-04-17T00:00:00.000Z' }
    );

    const [updatedQuestion] = updateQuestionById(
      [question],
      question.id,
      {
        notes: '新的备注',
        followUpChats: [
          {
            id: 'chat-user-1',
            role: 'user',
            content: '这一步为什么可以这样变形？',
            createdAt: '2026-04-18T09:00:00.000Z',
          },
        ],
      },
      { now: '2026-04-18T09:00:00.000Z' }
    );

    expect(updatedQuestion.updatedAt).toBe('2026-04-18T09:00:00.000Z');
    expect(updatedQuestion.notesUpdatedAt).toBe('2026-04-18T09:00:00.000Z');
    expect(updatedQuestion.syncStatus).toBe('modified');
    expect(updatedQuestion.followUpChats?.[0].id).toBe('chat-user-1');
  });

  test('updateQuestionById keeps image refs aligned with legacy noteImages updates', () => {
    const question = createQuestion(
      '测试题目',
      'data:image/png;base64,abc',
      '数学',
      { now: '2026-04-17T00:00:00.000Z' }
    );

    const [updatedQuestion] = updateQuestionById([question], question.id, {
      noteImages: ['data:image/png;base64,note-1', 'data:image/png;base64,note-2'],
    });

    expect(updatedQuestion.noteImageRefs).toHaveLength(2);
    expect(updatedQuestion.noteImages).toEqual([
      'data:image/png;base64,note-1',
      'data:image/png;base64,note-2',
    ]);
    expect(updatedQuestion.noteImagesUpdatedAt).toBeDefined();
    expect(updatedQuestion.syncStatus).toBe('modified');
  });

  test('file-based image refs remain displayable and legacy image fields still normalize', () => {
    const fileRef = createFileImageRef(
      'file:///tmp/question-image.png',
      'question',
      '2026-04-17T00:00:00.000Z',
      'img-question-1',
      'image/png'
    );

    expect(getImageRefDisplaySrc(fileRef)).toBe('file:///tmp/question-image.png');

    const [question] = normalizeQuestions([
      {
        id: 'file-image-1',
        title: '文件图片题目',
        imageRefs: [fileRef],
        category: '数学',
        createdAt: '2026-04-17T00:00:00.000Z',
      },
    ]);

    expect(question.image).toBe('file:///tmp/question-image.png');
    expect(question.imageRefs[0]).toEqual(
      expect.objectContaining({
        storage: 'file',
        uri: 'file:///tmp/question-image.png',
      })
    );
  });
});
