import {
  createFileImageRef,
  getActiveQuestions,
  getImageRefDisplaySrc,
  normalizeQuestions,
} from './questionModel';
import { markQuestionReviewed } from './reviewService';
import { createQuestion, deleteQuestionById, updateQuestionById } from './questionService';

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
      })
    );
    expect(question.imageRefs).toHaveLength(1);
    expect(question.image).toBe('data:image/png;base64,abc');
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
    const [question] = normalizeQuestions([
      {
        id: 'legacy-chat-1',
        title: '旧追问',
        image: 'data:image/png;base64,legacy',
        category: '数学',
        createdAt: '2026-04-10T00:00:00.000Z',
        followUpChats: [
          {
            role: 'user',
            content: '为什么这里要分类讨论？',
            createdAt: '2026-04-10T01:00:00.000Z',
          },
        ],
      },
    ]);

    expect(question.followUpChats).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        role: 'user',
        content: '为什么这里要分类讨论？',
        createdAt: '2026-04-10T01:00:00.000Z',
      }),
    ]);
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
        updatedAt: '2026-04-18T08:00:00.000Z',
        syncStatus: 'modified',
      })
    );
    expect(reviewedQuestion.nextReviewAt).toBe('2026-04-19T08:00:00.000Z');
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
