import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

const storageKey = 'wrong-question-assistant/questions';
const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;
const originalElectronApi = window.electronAPI;

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = '#/';
  URL.createObjectURL = jest.fn(() => 'blob:test-preview');
  URL.revokeObjectURL = jest.fn();
});

afterEach(() => {
  URL.createObjectURL = originalCreateObjectUrl;
  URL.revokeObjectURL = originalRevokeObjectUrl;
  window.electronAPI = originalElectronApi;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('renders the home workspace', async () => {
  render(<App />);

  await waitFor(() => {
    expect(
      screen.getByRole('heading', { level: 1, name: '我的学习看板' })
    ).toBeInTheDocument();
  });

  expect(
    screen.getByRole('heading', { level: 3, name: '添加错题' })
  ).toBeInTheDocument();
});

test('opens a saved question directly from the detail route', async () => {
  window.localStorage.setItem(
    storageKey,
    JSON.stringify([
      {
        id: 'question-1',
        title: '二次函数综合题',
        image: 'data:image/png;base64,abc',
        category: '数学',
        createdAt: '2026-04-11T10:00:00.000Z',
        notes: '先判断顶点位置，再代入范围条件。',
        reviewCount: 2,
        analysis: {
          difficulty: '中等',
          commonMistakes: ['只看图像趋势，没有回到题干条件。'],
          knowledgePoints: ['二次函数', '最值判断'],
          studyAdvice: '先列出已知条件，再判断开口方向与对称轴。',
          updatedAt: '2026-04-11T10:10:00.000Z',
          source: 'demo',
        },
      },
    ])
  );
  window.location.hash = '#/questions/question-1';

  render(<App />);

  await waitFor(() => {
    expect(screen.getByText('二次函数综合题')).toBeInTheDocument();
  });

  expect(
    screen.getByRole('heading', { level: 2, name: 'AI 分析' })
  ).toBeInTheDocument();
  expect(screen.getByText('最值判断')).toBeInTheDocument();

  const previewImage = screen.getByAltText('二次函数综合题');
  const previewButton = previewImage.closest('button');

  expect(previewButton).not.toBeNull();

  fireEvent.click(previewButton as HTMLButtonElement);

  await waitFor(() => {
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

test('supports editing a saved question title and syncs it back to the list', async () => {
  window.localStorage.setItem(
    storageKey,
    JSON.stringify([
      {
        id: 'question-title-1',
        title: '原始标题',
        image: 'data:image/png;base64,abc',
        category: '物理',
        createdAt: '2026-04-11T10:00:00.000Z',
        notes: '',
        reviewCount: 0,
      },
    ])
  );
  window.location.hash = '#/questions/question-title-1';

  render(<App />);

  expect(await screen.findByText('原始标题')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '编辑标题' }));
  fireEvent.change(screen.getByPlaceholderText('输入题目标题'), {
    target: { value: '  更新后的标题  ' },
  });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));

  await waitFor(() => {
    expect(screen.getByText('更新后的标题')).toBeInTheDocument();
  });

  fireEvent.click(screen.getByRole('button', { name: '← 返回错题本' }));

  await waitFor(() => {
    expect(screen.getByText('更新后的标题')).toBeInTheDocument();
  });
});

test('validates the title when editing a saved question', async () => {
  window.localStorage.setItem(
    storageKey,
    JSON.stringify([
      {
        id: 'question-title-2',
        title: '需要校验的标题',
        image: 'data:image/png;base64,abc',
        category: '数学',
        createdAt: '2026-04-11T10:00:00.000Z',
        notes: '',
        reviewCount: 0,
      },
    ])
  );
  window.location.hash = '#/questions/question-title-2';

  render(<App />);

  fireEvent.click(await screen.findByRole('button', { name: '编辑标题' }));
  fireEvent.change(screen.getByPlaceholderText('输入题目标题'), {
    target: { value: '   ' },
  });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));

  expect(await screen.findByText('标题不能为空')).toBeInTheDocument();
});

test('uploads an image on the home page and creates a new question', async () => {
  render(<App />);

  await waitFor(() => {
    expect(
      screen.getByRole('heading', { level: 3, name: '添加错题' })
    ).toBeInTheDocument();
  });

  const titleInput = screen.getByLabelText('题目标题');
  const fileInput = screen.getByLabelText('题目图片');
  const submitButton = screen.getByRole('button', {
    name: '保存错题',
  });
  const file = new File(['image-content'], 'test-question.png', {
    type: 'image/png',
  });

  fireEvent.change(titleInput, { target: { value: '测试题目' } });
  fireEvent.change(fileInput, { target: { files: [file] } });
  fireEvent.click(submitButton);

  await waitFor(() => {
    expect(screen.getByText('测试题目')).toBeInTheDocument();
  });
});

test('validates required fields before saving a question', async () => {
  const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});

  render(<App />);

  await waitFor(() => {
    expect(
      screen.getByRole('heading', { level: 3, name: '添加错题' })
    ).toBeInTheDocument();
  });

  fireEvent.click(screen.getByRole('button', { name: '保存错题' }));
  expect(alertSpy).toHaveBeenCalledWith('请输入标题');

  fireEvent.change(screen.getByLabelText('题目标题'), {
    target: { value: '只填标题不上图' },
  });
  fireEvent.click(screen.getByRole('button', { name: '保存错题' }));

  expect(alertSpy).toHaveBeenLastCalledWith('请上传图片');
});
