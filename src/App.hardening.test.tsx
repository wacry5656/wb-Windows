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

test('active questions remain visible in list and review routes', async () => {
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
  ]);

  window.localStorage.setItem(storageKey, payload);
  window.location.hash = '#/questions';

  const firstRender = render(<App />);
  expect((await screen.findAllByText('可见题目')).length).toBeGreaterThan(0);
  firstRender.unmount();

  window.localStorage.setItem(storageKey, payload);
  window.location.hash = '#/review';

  render(<App />);
  expect((await screen.findAllByText('可见题目')).length).toBeGreaterThan(0);
});

test('removed questions cannot be opened through the detail route', async () => {
  window.localStorage.setItem(
    storageKey,
    JSON.stringify([
      {
        id: 'visible-question',
        title: '可见题目',
        image: 'data:image/png;base64,abc',
        category: '数学',
        createdAt: '2026-04-11T10:00:00.000Z',
        notes: '',
        reviewCount: 0,
      },
    ])
  );
  window.location.hash = '#/questions/deleted-question';

  render(<App />);

  expect(await screen.findByText('题目未找到')).toBeInTheDocument();
});

test('deleting a question saves a tombstone and hides it from the UI', async () => {
  jest.spyOn(window, 'confirm').mockReturnValue(true);

  const saveQuestions = jest.fn().mockResolvedValue({
    success: true,
    storageFilePath: 'data/questions.json',
    cleanedImagePaths: ['data/images/orphan-note.png'],
  });

  window.electronAPI = {
    loadQuestions: jest.fn().mockResolvedValue([
      {
        id: 'question-1',
        title: '待删除题目',
        image: 'file:///data/images/question-1.png',
        imageRefs: [
          {
            id: 'img-question-1',
            storage: 'file',
            kind: 'question',
            uri: 'file:///data/images/question-1.png',
            createdAt: '2026-04-12T00:00:00.000Z',
            mimeType: 'image/png',
          },
        ],
        noteImages: ['file:///data/images/note-1.png'],
        noteImageRefs: [
          {
            id: 'img-note-1',
            storage: 'file',
            kind: 'note',
            uri: 'file:///data/images/note-1.png',
            createdAt: '2026-04-12T00:00:00.000Z',
            mimeType: 'image/png',
          },
        ],
        category: '数学',
        createdAt: '2026-04-12T00:00:00.000Z',
        notes: '',
        reviewCount: 0,
      },
      {
        id: 'question-2',
        title: '保留题目',
        image: 'file:///data/images/question-2.png',
        imageRefs: [
          {
            id: 'img-question-2',
            storage: 'file',
            kind: 'question',
            uri: 'file:///data/images/question-2.png',
            createdAt: '2026-04-12T00:00:00.000Z',
            mimeType: 'image/png',
          },
        ],
        noteImageRefs: [],
        category: '数学',
        createdAt: '2026-04-12T00:00:00.000Z',
        notes: '',
        reviewCount: 0,
      },
    ]),
    saveQuestions,
    getApiConfigStatus: jest.fn(),
    generateQuestionAnalysis: jest.fn(),
    generateQuestionExplanation: jest.fn(),
    generateQuestionHint: jest.fn(),
    generateFollowUp: jest.fn(),
  };

  window.location.hash = '#/questions/question-1';
  render(<App />);

  fireEvent.click(await screen.findByRole('button', { name: '删除' }));

  await waitFor(() => {
    expect(saveQuestions).toHaveBeenCalled();
  });

  const savedQuestions = saveQuestions.mock.calls[saveQuestions.mock.calls.length - 1]?.[0];
  expect(savedQuestions).toHaveLength(2);
  expect(savedQuestions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'question-1',
        title: '待删除题目',
        deleted: true,
        deletedAt: expect.any(String),
        syncStatus: 'modified',
      }),
      expect.objectContaining({
        id: 'question-2',
        title: '保留题目',
        deleted: false,
      }),
    ])
  );
  expect(screen.queryByText('待删除题目')).not.toBeInTheDocument();
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
    name: '保存错题',
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
