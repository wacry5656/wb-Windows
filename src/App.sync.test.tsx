import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

const originalElectronApi = window.electronAPI;

afterEach(() => {
  window.electronAPI = originalElectronApi;
  window.location.hash = '#/';
});

test('an edit committed while sync is in flight is replayed and uploaded', async () => {
  let resolveFirstSync: ((value: { ok: boolean; records: unknown[] }) => void) | undefined;
  const firstSync = new Promise<{ ok: boolean; records: unknown[] }>((resolve) => {
    resolveFirstSync = resolve;
  });
  const syncQuestions = jest
    .fn()
    .mockImplementationOnce(() => firstSync)
    .mockImplementationOnce(async (records) => ({
      ok: true,
      records: records.map((record: Record<string, unknown>) => ({
        ...record,
        syncStatus: 'synced',
      })),
    }));
  const saveQuestions = jest.fn().mockResolvedValue({
    success: true,
    storageFilePath: 'data/questions.json',
  });

  window.electronAPI = {
    loadQuestions: jest.fn().mockResolvedValue([
      {
        id: 'sync-race-question',
        title: 'Before sync',
        questionText: 'text',
        image: '',
        imageRefs: [],
        category: '数学',
        createdAt: '2026-07-16T01:00:00.000Z',
        notes: '',
        reviewCount: 0,
      },
    ]),
    saveQuestions,
    syncQuestions,
    getApiConfigStatus: jest.fn(),
    generateQuestionAnalysis: jest.fn(),
    generateQuestionExplanation: jest.fn(),
    generateQuestionHint: jest.fn(),
    generateFollowUp: jest.fn(),
  };
  window.location.hash = '#/questions/sync-race-question';

  const { container } = render(<App />);
  expect(await screen.findByText('Before sync')).toBeInTheDocument();

  fireEvent.click(container.querySelector('.sync-button') as HTMLButtonElement);
  await waitFor(() => expect(syncQuestions).toHaveBeenCalledTimes(1));

  fireEvent.click(container.querySelector('.btn-text--neutral') as HTMLButtonElement);
  fireEvent.change(container.querySelector('.detail-title-input') as HTMLInputElement, {
    target: { value: 'Edited during sync' },
  });
  fireEvent.click(container.querySelector('.btn-secondary--compact') as HTMLButtonElement);
  expect(await screen.findByText('Edited during sync')).toBeInTheDocument();

  const pushedSnapshot = syncQuestions.mock.calls[0][0];
  await act(async () => {
    resolveFirstSync?.({
      ok: true,
      records: pushedSnapshot.map((record: Record<string, unknown>) => ({
        ...record,
        syncStatus: 'synced',
      })),
    });
    await firstSync;
  });

  await waitFor(() => expect(syncQuestions).toHaveBeenCalledTimes(2));
  expect(await screen.findByText('Edited during sync')).toBeInTheDocument();
  expect(syncQuestions.mock.calls[1][0][0]).toEqual(
    expect.objectContaining({ title: 'Edited during sync' })
  );
});
