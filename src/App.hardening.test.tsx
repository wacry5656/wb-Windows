import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

const storageKey = 'wrong-question-assistant/questions';
const originalElectronApi = window.electronAPI;
const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = '#/';
  URL.createObjectURL = jest.fn(() => 'blob:test-preview');
  URL.revokeObjectURL = jest.fn();
});

afterEach(() => {
  window.electronAPI = originalElectronApi;
  URL.createObjectURL = originalCreateObjectUrl;
  URL.revokeObjectURL = originalRevokeObjectUrl;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('soft-deleted questions stay out of list and review routes', async () => {
  const payload = JSON.stringify([
    {
      id: 'visible-question',
      title: '可见题目',
      image: 'data:image/png;base64,abc',
      category: '数学',
      createdAt: '2026-04-11T10:00:00.000Z',
      notes: '',
      reviewCount: 1,
    },
    {
      id: 'deleted-question',
      title: '已删除题目',
      image: 'data:image/png;base64,deleted',
      category: '数学',
      createdAt: '2026-04-11T11:00:00.000Z',
      notes: '',
      reviewCount: 0,
      deleted: true,
      deletedAt: '2026-04-12T00:00:00.000Z',
    },
  ]);

  window.localStorage.setItem(storageKey, payload);
  window.location.hash = '#/questions';

  const firstRender = render(<App />);
  expect((await screen.findAllByText('可见题目')).length).toBeGreaterThan(0);
  expect(screen.queryByText('已删除题目')).not.toBeInTheDocument();
  firstRender.unmount();

  window.localStorage.setItem(storageKey, payload);
  window.location.hash = '#/review';

  render(<App />);
  expect((await screen.findAllByText('可见题目')).length).toBeGreaterThan(0);
  expect(screen.queryByText('已删除题目')).not.toBeInTheDocument();
});

test('deleted questions cannot be opened through the detail route', async () => {
  window.localStorage.setItem(
    storageKey,
    JSON.stringify([
      {
        id: 'deleted-question',
        title: '已删除题目',
        image: 'data:image/png;base64,deleted',
        category: '数学',
        createdAt: '2026-04-11T11:00:00.000Z',
        notes: '',
        reviewCount: 0,
        deleted: true,
        deletedAt: '2026-04-12T00:00:00.000Z',
      },
    ])
  );
  window.location.hash = '#/questions/deleted-question';

  render(<App />);

  expect(await screen.findByText(/题目未找到|棰樼洰鏈壘鍒/)).toBeInTheDocument();
  expect(screen.queryByText('已删除题目')).not.toBeInTheDocument();
});

test('new image writes prefer file-based refs when Electron image persistence is available', async () => {
  jest.useFakeTimers();

  const persistImage = jest.fn().mockResolvedValue({
    id: 'img-question-1',
    storage: 'file' as const,
    kind: 'question' as const,
    uri: 'file:///data/images/question-1.png',
    createdAt: '2026-04-12T00:00:00.000Z',
    mimeType: 'image/png',
  });
  const saveQuestions = jest.fn().mockResolvedValue({
    success: true,
    storageFilePath: 'data/questions.json',
  });

  window.electronAPI = {
    loadQuestions: jest.fn().mockResolvedValue([]),
    saveQuestions,
    getApiConfigStatus: jest.fn(),
    generateQuestionAnalysis: jest.fn(),
    generateQuestionExplanation: jest.fn(),
    generateQuestionHint: jest.fn(),
    generateFollowUp: jest.fn(),
    persistImage,
  };

  const { container } = render(<App />);

  const titleInput = container.querySelector('input[type="text"]') as HTMLInputElement;
  const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
  const submitButton = screen.getByRole('button', {
    name: /保存错题|淇濆瓨閿欓/,
  });
  const file = new File(['image-content'], 'test-question.png', {
    type: 'image/png',
  });

  fireEvent.change(titleInput, { target: { value: '文件图题目' } });
  fireEvent.change(fileInput, { target: { files: [file] } });
  fireEvent.click(submitButton);

  await waitFor(() => {
    expect(persistImage).toHaveBeenCalledTimes(1);
  });

  act(() => {
    jest.advanceTimersByTime(1000);
  });

  await waitFor(() => {
    expect(saveQuestions).toHaveBeenCalled();
  });

  const savedQuestions = saveQuestions.mock.calls[saveQuestions.mock.calls.length - 1]?.[0];
  expect(savedQuestions[0]).toEqual(
    expect.objectContaining({
      image: 'file:///data/images/question-1.png',
    })
  );
  expect(savedQuestions[0].imageRefs[0]).toEqual(
    expect.objectContaining({
      storage: 'file',
      uri: 'file:///data/images/question-1.png',
    })
  );
});
