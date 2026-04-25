import {
  generateQuestionAnalysisRequest,
  generateQuestionHintRequest,
} from './qwenClient';

describe('qwenClient', () => {
  const originalElectronApi = window.electronAPI;
  const originalFetch = global.fetch;

  beforeEach(() => {
    window.electronAPI = undefined;
    global.fetch = jest.fn() as typeof fetch;
  });

  afterEach(() => {
    window.electronAPI = originalElectronApi;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('requires Electron AI bridge instead of browser fallback', async () => {
    await expect(
      generateQuestionAnalysisRequest({
        image: 'data:image/png;base64,abc',
      })
    ).rejects.toThrow('ELECTRON_AI_REQUIRED');

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('delegates AI requests to preload when Electron API is available', async () => {
    const generateQuestionHint = jest.fn().mockResolvedValue({
      hint: '先看约束条件。',
    });

    window.electronAPI = {
      loadQuestions: jest.fn(),
      saveQuestions: jest.fn(),
      getApiConfigStatus: jest.fn(),
      generateQuestionAnalysis: jest.fn(),
      generateQuestionExplanation: jest.fn(),
      generateQuestionHint,
      generateFollowUp: jest.fn(),
    };

    await expect(
      generateQuestionHintRequest({
        image: 'data:image/png;base64,abc',
        title: '测试题目',
        subject: '数学',
      })
    ).resolves.toEqual({
      hint: '先看约束条件。',
    });

    expect(generateQuestionHint).toHaveBeenCalledWith({
      image: 'data:image/png;base64,abc',
      title: '测试题目',
      subject: '数学',
      questionText: '',
      userAnswer: '',
      correctAnswer: '',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
