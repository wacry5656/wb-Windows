import { loadQuestions } from './questionStorage';

const storageKey = 'wrong-question-assistant/questions';

describe('questionStorage', () => {
  const originalElectronApi = window.electronAPI;

  beforeEach(() => {
    window.localStorage.clear();
    window.electronAPI = undefined;
  });

  afterAll(() => {
    window.electronAPI = originalElectronApi;
  });

  test('uses Electron storage as the source of truth even when it is empty', async () => {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify([
        {
          id: 'stale-question',
          title: 'stale',
          image: 'data:image/png;base64,stale',
          category: '数学',
          createdAt: '2026-04-12T00:00:00.000Z',
        },
      ])
    );

    window.electronAPI = {
      loadQuestions: jest.fn().mockResolvedValue([]),
      saveQuestions: jest.fn(),
      getApiConfigStatus: jest.fn(),
      generateQuestionAnalysis: jest.fn(),
      generateQuestionExplanation: jest.fn(),
      generateQuestionHint: jest.fn(),
      generateFollowUp: jest.fn(),
    };

    await expect(loadQuestions()).resolves.toEqual([]);
  });

  test('normalizes malformed analysis fields loaded from storage', async () => {
    window.electronAPI = {
      loadQuestions: jest.fn().mockResolvedValue([
        {
          id: 'question-1',
          title: '函数题',
          image: 'data:image/png;base64,abc',
          category: '未知学科',
          createdAt: '2026-04-12T00:00:00.000Z',
          notes: 123,
          reviewCount: '3',
          analysis: {
            difficulty: '中等',
            studyAdvice: '先整理条件',
            updatedAt: '2026-04-12T00:10:00.000Z',
            source: 'ai',
            commonMistakes: ['  忽略定义域 ', '', 123],
            knowledgePoints: [' 导数判断单调性 ', null],
            cautions: [' 注意分类讨论 ', ''],
            difficultyScore: 9,
          },
        },
      ]),
      saveQuestions: jest.fn(),
      getApiConfigStatus: jest.fn(),
      generateQuestionAnalysis: jest.fn(),
      generateQuestionExplanation: jest.fn(),
      generateQuestionHint: jest.fn(),
      generateFollowUp: jest.fn(),
    };

    await expect(loadQuestions()).resolves.toEqual([
      expect.objectContaining({
        category: '数学',
        notes: '',
        reviewCount: 0,
        analysis: expect.objectContaining({
          commonMistakes: ['忽略定义域'],
          knowledgePoints: ['导数判断单调性'],
          cautions: ['注意分类讨论'],
          difficultyScore: undefined,
        }),
      }),
    ]);
  });
});
