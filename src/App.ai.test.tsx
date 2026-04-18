import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

const baseQuestion = {
  id: 'question-ai-1',
  title: '测试题目',
  image: 'data:image/png;base64,abc',
  category: '数学' as const,
  createdAt: '2026-04-12T00:00:00.000Z',
  notes: '',
  reviewCount: 0,
};

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe('AI flows', () => {
  const originalElectronApi = window.electronAPI;

  beforeEach(() => {
    window.localStorage.clear();
    window.location.hash = '#/questions/question-ai-1';
  });

  afterEach(() => {
    window.electronAPI = originalElectronApi;
    jest.restoreAllMocks();
  });

  test('generates analysis, shows loading state, and prevents duplicate requests', async () => {
    const deferred = createDeferred<{
      subject: string;
      knowledge_points: string[];
      common_mistakes: string[];
      difficulty: 1 | 2 | 3 | 4 | 5;
      cautions: string[];
      analysis_summary: string;
    }>();

    window.electronAPI = {
      loadQuestions: jest.fn().mockResolvedValue([baseQuestion]),
      saveQuestions: jest.fn().mockResolvedValue({
        success: true,
        storageFilePath: 'data/questions.json',
      }),
      getApiConfigStatus: jest.fn(),
      generateQuestionAnalysis: jest.fn().mockReturnValue(deferred.promise),
      generateQuestionExplanation: jest.fn(),
      generateQuestionHint: jest.fn(),
      generateFollowUp: jest.fn(),
    };
    const electronApi = window.electronAPI!;

    render(<App />);

    const button = await screen.findByRole('button', { name: '开始分析' });
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => {
      expect(electronApi.generateQuestionAnalysis).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByRole('button', { name: '正在分析...' })).toBeDisabled();

    deferred.resolve({
      subject: '数学',
      knowledge_points: ['导数判断单调性'],
      common_mistakes: ['忽略定义域限制'],
      difficulty: 4,
      cautions: ['先判断参数范围'],
      analysis_summary: '本题重点考查导数与定义域约束的综合应用。',
    });

    await waitFor(() => {
      expect(screen.getByText('导数判断单调性')).toBeInTheDocument();
    });
  });

  test('shows invalid json error for analysis failures', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    window.electronAPI = {
      loadQuestions: jest.fn().mockResolvedValue([baseQuestion]),
      saveQuestions: jest.fn().mockResolvedValue({
        success: true,
        storageFilePath: 'data/questions.json',
      }),
      getApiConfigStatus: jest.fn(),
      generateQuestionAnalysis: jest
        .fn()
        .mockRejectedValue(new Error('INVALID_JSON')),
      generateQuestionExplanation: jest.fn(),
      generateQuestionHint: jest.fn(),
      generateFollowUp: jest.fn(),
    };

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '开始分析' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('AI返回格式异常');
    });

    expect(consoleSpy).toHaveBeenCalled();
  });

  test('generates hint without overriding detailed explanation', async () => {
    const deferred = createDeferred<{ hint: string }>();

    window.electronAPI = {
      loadQuestions: jest.fn().mockResolvedValue([
        {
          ...baseQuestion,
          detailedExplanation: '这里是已有详解',
          detailedExplanationUpdatedAt: '2026-04-12T01:00:00.000Z',
        },
      ]),
      saveQuestions: jest.fn().mockResolvedValue({
        success: true,
        storageFilePath: 'data/questions.json',
      }),
      getApiConfigStatus: jest.fn(),
      generateQuestionAnalysis: jest.fn(),
      generateQuestionExplanation: jest.fn(),
      generateQuestionHint: jest.fn().mockReturnValue(deferred.promise),
      generateFollowUp: jest.fn(),
    };

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '思路指引' }));

    expect(await screen.findByRole('button', { name: '生成中...' })).toBeDisabled();

    deferred.resolve({
      hint: '先判断研究对象，再看题目中的隐藏条件。不要急着列式，先找真正的约束。',
    });

    await waitFor(() => {
      expect(screen.getByText('先判断研究对象，再看题目中的隐藏条件。不要急着列式，先找真正的约束。')).toBeInTheDocument();
    });

    expect(screen.getByText('这里是已有详解')).toBeInTheDocument();
  });

test('shows hint failure message for generic hint errors', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    window.electronAPI = {
      loadQuestions: jest.fn().mockResolvedValue([baseQuestion]),
      saveQuestions: jest.fn().mockResolvedValue({
        success: true,
        storageFilePath: 'data/questions.json',
      }),
      getApiConfigStatus: jest.fn(),
      generateQuestionAnalysis: jest.fn(),
      generateQuestionExplanation: jest.fn(),
      generateQuestionHint: jest
        .fn()
        .mockRejectedValue(new Error('QWEN_HINT_REQUEST_FAILED')),
      generateFollowUp: jest.fn(),
    };

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '思路指引' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('思路指引生成失败，请重试');
    });

  expect(consoleSpy).toHaveBeenCalled();
});

test('regenerating hint does not clear follow-up chats', async () => {
  const deferred = createDeferred<{ hint: string }>();

  window.electronAPI = {
    loadQuestions: jest.fn().mockResolvedValue([
      {
        ...baseQuestion,
        detailedExplanation: '已有详解',
        detailedExplanationUpdatedAt: '2026-04-12T01:00:00.000Z',
        hint: '旧提示',
        hintUpdatedAt: '2026-04-12T01:30:00.000Z',
        followUpChats: [
          {
            id: 'chat-user-1',
            role: 'user',
            content: '这里为什么要分类讨论？',
            createdAt: '2026-04-12T02:00:00.000Z',
          },
          {
            id: 'chat-assistant-1',
            role: 'assistant',
            content: '因为参数范围不同会影响结论。',
            createdAt: '2026-04-12T02:00:10.000Z',
          },
        ],
      },
    ]),
    saveQuestions: jest.fn().mockResolvedValue({
      success: true,
      storageFilePath: 'data/questions.json',
    }),
    getApiConfigStatus: jest.fn(),
    generateQuestionAnalysis: jest.fn(),
    generateQuestionExplanation: jest.fn(),
    generateQuestionHint: jest.fn().mockReturnValue(deferred.promise),
    generateFollowUp: jest.fn(),
  };

  render(<App />);

  expect(await screen.findByText('这里为什么要分类讨论？')).toBeInTheDocument();

  fireEvent.click(await screen.findByRole('button', { name: '重新指引' }));

  deferred.resolve({
    hint: '先看参数范围，再判断需要分几种情况。',
  });

  await waitFor(() => {
    expect(screen.getByText('先看参数范围，再判断需要分几种情况。')).toBeInTheDocument();
  });

  expect(screen.getByText('这里为什么要分类讨论？')).toBeInTheDocument();
  expect(screen.getByText('因为参数范围不同会影响结论。')).toBeInTheDocument();
});

test('shows explanation loading state and cleans markdown from explanation output', async () => {
    const deferred = createDeferred<{ explanation: string }>();

    window.electronAPI = {
      loadQuestions: jest.fn().mockResolvedValue([baseQuestion]),
      saveQuestions: jest.fn().mockResolvedValue({
        success: true,
        storageFilePath: 'data/questions.json',
      }),
      getApiConfigStatus: jest.fn(),
      generateQuestionAnalysis: jest.fn(),
      generateQuestionExplanation: jest.fn().mockReturnValue(deferred.promise),
      generateQuestionHint: jest.fn(),
      generateFollowUp: jest.fn(),
    };

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '生成讲解' }));

    expect(await screen.findByRole('button', { name: '正在生成...' })).toBeDisabled();

    deferred.resolve({
      explanation: [
        '你好：',
        '',
        '### 题型判断',
        '**函数综合题**',
        '',
        '1. 先看定义域',
        '* 2. 再判断单调性',
      ].join('\n'),
    });

    await waitFor(() => {
      expect(screen.getByText('题型判断')).toBeInTheDocument();
    });

    expect(screen.getByText('函数综合题')).toBeInTheDocument();
  expect(screen.getByText('1. 先看定义域')).toBeInTheDocument();
  expect(screen.getByText('2. 再判断单调性')).toBeInTheDocument();
  expect(screen.queryByText('### 题型判断')).not.toBeInTheDocument();
});

test('regenerating explanation does not clear follow-up chats', async () => {
  const deferred = createDeferred<{ explanation: string }>();

  window.electronAPI = {
    loadQuestions: jest.fn().mockResolvedValue([
      {
        ...baseQuestion,
        detailedExplanation: '旧详解',
        detailedExplanationUpdatedAt: '2026-04-12T01:00:00.000Z',
        followUpChats: [
          {
            id: 'chat-user-1',
            role: 'user',
            content: '这一步能不能换一种做法？',
            createdAt: '2026-04-12T02:00:00.000Z',
          },
          {
            id: 'chat-assistant-1',
            role: 'assistant',
            content: '可以，但本题先按最直接的方法处理更稳。',
            createdAt: '2026-04-12T02:00:10.000Z',
          },
        ],
      },
    ]),
    saveQuestions: jest.fn().mockResolvedValue({
      success: true,
      storageFilePath: 'data/questions.json',
    }),
    getApiConfigStatus: jest.fn(),
    generateQuestionAnalysis: jest.fn(),
    generateQuestionExplanation: jest.fn().mockReturnValue(deferred.promise),
    generateQuestionHint: jest.fn(),
    generateFollowUp: jest.fn(),
  };

  render(<App />);

  expect(await screen.findByText('这一步能不能换一种做法？')).toBeInTheDocument();

  fireEvent.click(await screen.findByRole('button', { name: '重新生成' }));

  deferred.resolve({
    explanation: '新的详解内容',
  });

  await waitFor(() => {
    expect(screen.getByText('新的详解内容')).toBeInTheDocument();
  });

  expect(screen.getByText('这一步能不能换一种做法？')).toBeInTheDocument();
  expect(screen.getByText('可以，但本题先按最直接的方法处理更稳。')).toBeInTheDocument();
});

  test('shows explanation failure message for generic explanation errors', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    window.electronAPI = {
      loadQuestions: jest.fn().mockResolvedValue([baseQuestion]),
      saveQuestions: jest.fn().mockResolvedValue({
        success: true,
        storageFilePath: 'data/questions.json',
      }),
      getApiConfigStatus: jest.fn(),
      generateQuestionAnalysis: jest.fn(),
      generateQuestionExplanation: jest
        .fn()
        .mockRejectedValue(new Error('QWEN_EXPLANATION_REQUEST_FAILED')),
      generateQuestionHint: jest.fn(),
      generateFollowUp: jest.fn(),
    };

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '生成讲解' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('详解生成失败，请重试');
    });

    expect(consoleSpy).toHaveBeenCalled();
  });
});
