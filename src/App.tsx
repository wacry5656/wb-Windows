import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { Subject } from './constants/subjects';
import EditQuestionPage from './pages/EditQuestionPage';
import QuestionDetailPage from './pages/QuestionDetailPage';
import HomePage from './pages/HomePage';
import QuestionListPage from './pages/QuestionListPage';
import ReviewPage from './pages/ReviewPage';
import TrashPage from './pages/TrashPage';
import {
  generateAnalysisUpdates,
  generateDetailedExplanationUpdates,
  generateFollowUpUpdates,
  generateHintUpdates,
} from './services/questionAiService';
import { persistQuestionImage } from './services/questionImageService';
import {
  applyQuestionUpdates,
  createQuestion,
  deleteQuestionById,
  findQuestionById,
  getVisibleStats,
  removeQuestionNoteImageById,
  replaceQuestionFollowUpChatsById,
  replaceQuestionNoteImagesById,
  updateQuestionNotesById,
  updateQuestionTitleById,
  updateQuestionById,
  restoreQuestionById,
} from './services/questionService';
import { getActiveQuestions, getDeletedQuestions } from './services/questionModel';
import { markQuestionReviewed, postponeReview, revertLastReview } from './services/reviewService';
import {
  normalizeServerSnapshot,
  reconcileServerSnapshot,
} from './services/questionSyncService';
import { Question } from './types/question';
import { loadQuestions, saveQuestions } from './utils/questionStorage';
import './App.css';

export default function App() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [hasLoadedQuestions, setHasLoadedQuestions] = useState(false);
  const [syncStatusText, setSyncStatusText] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncState, setSyncState] = useState<
    'idle' | 'working' | 'success' | 'warning' | 'error'
  >('idle');
  const [lastSyncAt, setLastSyncAt] = useState<string>();
  const latestQuestionsRef = useRef<Question[]>([]);
  const pendingSaveRef = useRef<Promise<void>>(Promise.resolve());
  const lastQueuedQuestionsRef = useRef<Question[]>();

  const persistQuestionsImmediately = useCallback((questionsToSave: Question[]) => {
    latestQuestionsRef.current = questionsToSave;
    if (lastQueuedQuestionsRef.current === questionsToSave) {
      return pendingSaveRef.current;
    }
    lastQueuedQuestionsRef.current = questionsToSave;
    const saveRequest = pendingSaveRef.current
      .catch(() => undefined)
      .then(() => saveQuestions(questionsToSave));
    pendingSaveRef.current = saveRequest;
    void saveRequest.catch((error) => {
      if (lastQueuedQuestionsRef.current === questionsToSave) {
        lastQueuedQuestionsRef.current = undefined;
      }
      console.error('Failed to immediately save questions:', error);
    });
    return saveRequest;
  }, []);

  const replaceQuestions = useCallback((nextQuestions: Question[]) => {
    latestQuestionsRef.current = nextQuestions;
    setQuestions(nextQuestions);
    return nextQuestions;
  }, []);

  const mutateQuestions = useCallback((updater: (current: Question[]) => Question[]) => {
    const nextQuestions = updater(latestQuestionsRef.current);
    latestQuestionsRef.current = nextQuestions;
    setQuestions(nextQuestions);
    return nextQuestions;
  }, []);

  const addQuestion = useCallback(
    async (
      title: string,
      image: string,
      category: Subject,
      metadata?: Partial<
        Pick<
          Question,
          | 'grade'
          | 'questionType'
          | 'source'
          | 'questionText'
          | 'userAnswer'
          | 'correctAnswer'
          | 'notes'
          | 'errorCause'
          | 'tags'
        >
      >
    ) => {
      const imageRef = await persistQuestionImage(image, 'question');
      const newQuestion = createQuestion(title, imageRef, category, metadata);
      mutateQuestions((currentQuestions) => [newQuestion, ...currentQuestions]);
      return newQuestion;
    },
    [mutateQuestions]
  );

  const updateQuestionTitle = useCallback((id: string, title: string) => {
    mutateQuestions((currentQuestions) =>
      updateQuestionTitleById(currentQuestions, id, title)
    );
  }, [mutateQuestions]);

  const updateQuestionNotes = useCallback((id: string, notes: string) => {
    mutateQuestions((currentQuestions) =>
      updateQuestionNotesById(currentQuestions, id, notes)
    );
  }, [mutateQuestions]);

  const updateQuestionContent = useCallback(
    (
      id: string,
      updates: Partial<
        Pick<
          Question,
          | 'title'
          | 'category'
          | 'grade'
          | 'questionType'
          | 'source'
          | 'questionText'
          | 'userAnswer'
          | 'correctAnswer'
          | 'errorCause'
          | 'tags'
        >
      >
    ) => {
      mutateQuestions((currentQuestions) =>
        currentQuestions.map((question) =>
          question.id === id
            ? applyQuestionUpdates(question, {
                ...updates,
                title: updates.title?.trim() ?? question.title,
                grade: updates.grade?.trim() ?? question.grade,
                questionType: updates.questionType?.trim() ?? question.questionType,
                source: updates.source?.trim() ?? question.source,
                questionText: updates.questionText?.trim() ?? question.questionText,
                userAnswer: updates.userAnswer?.trim() ?? question.userAnswer,
                correctAnswer: updates.correctAnswer?.trim() ?? question.correctAnswer,
                errorCause: updates.errorCause?.trim() ?? question.errorCause,
                tags: updates.tags ?? question.tags,
              })
            : question
        )
      );
    },
    [mutateQuestions]
  );

  const clearQuestionFollowUps = useCallback((id: string) => {
    mutateQuestions((currentQuestions) =>
      replaceQuestionFollowUpChatsById(currentQuestions, id, [])
    );
  }, [mutateQuestions]);

  const addQuestionNoteImage = useCallback(async (id: string, dataUrl: string) => {
    const imageRef = await persistQuestionImage(dataUrl, 'note');
    mutateQuestions((currentQuestions) => {
      const question = findQuestionById(currentQuestions, id);
      if (!question) {
        return currentQuestions;
      }

      return replaceQuestionNoteImagesById(currentQuestions, id, [
        ...question.noteImageRefs,
        imageRef,
      ]);
    });
  }, [mutateQuestions]);

  const deleteQuestionNoteImage = useCallback((id: string, noteImageId: string) => {
    mutateQuestions((currentQuestions) =>
      removeQuestionNoteImageById(currentQuestions, id, noteImageId)
    );
  }, [mutateQuestions]);

  const deleteQuestion = useCallback((id: string) => {
    mutateQuestions((currentQuestions) => {
      const nextQuestions = deleteQuestionById(currentQuestions, id);
      persistQuestionsImmediately(nextQuestions);
      return nextQuestions;
    });
  }, [mutateQuestions, persistQuestionsImmediately]);

  const restoreQuestion = useCallback((id: string) => {
    const nextQuestions = mutateQuestions((currentQuestions) =>
      restoreQuestionById(currentQuestions, id)
    );
    void persistQuestionsImmediately(nextQuestions);
  }, [mutateQuestions, persistQuestionsImmediately]);

  const reviewQuestion = useCallback((id: string, quality: 0 | 1 | 2 | 3 = 2) => {
    mutateQuestions((currentQuestions) =>
      currentQuestions.map((question) =>
        question.id === id ? markQuestionReviewed(question, quality) : question
      )
    );
  }, [mutateQuestions]);

  const postponeQuestion = useCallback((id: string) => {
    mutateQuestions((currentQuestions) =>
      currentQuestions.map((question) =>
        question.id === id ? postponeReview(question) : question
      )
    );
  }, [mutateQuestions]);

  const undoLastReview = useCallback((id: string) => {
    mutateQuestions((currentQuestions) =>
      currentQuestions.map((question) =>
        question.id === id ? revertLastReview(question) : question
      )
    );
  }, [mutateQuestions]);

  const generateAiAnalysis = useCallback(async (question: Question) => {
    try {
      const updates = await generateAnalysisUpdates(question);
      mutateQuestions((currentQuestions) =>
        updateQuestionById(currentQuestions, question.id, updates)
      );
    } catch (error) {
      console.error('Failed to generate AI analysis.', error);
      throw error;
    }
  }, [mutateQuestions]);

  const generateDetailedExplanation = useCallback(async (question: Question) => {
    try {
      const updates = await generateDetailedExplanationUpdates(question);
      mutateQuestions((currentQuestions) =>
        updateQuestionById(currentQuestions, question.id, updates)
      );
    } catch (error) {
      console.error('Failed to generate detailed explanation.', error);
      throw error;
    }
  }, [mutateQuestions]);

  const generateHint = useCallback(async (question: Question) => {
    try {
      const updates = await generateHintUpdates(question);
      mutateQuestions((currentQuestions) =>
        updateQuestionById(currentQuestions, question.id, updates)
      );
    } catch (error) {
      console.error('Failed to generate hint.', error);
      throw error;
    }
  }, [mutateQuestions]);

  const sendFollowUp = useCallback(async (question: Question, userMessage: string) => {
    try {
      const result = await generateFollowUpUpdates(question, userMessage);
      mutateQuestions((currentQuestions) =>
        updateQuestionById(currentQuestions, question.id, result.updates)
      );
      return result.answer;
    } catch (error) {
      console.error('Failed to send follow-up.', error);
      throw error;
    }
  }, [mutateQuestions]);

  const syncQuestions = useCallback(async () => {
    if (isSyncing) {
      return;
    }

    if (!hasLoadedQuestions) {
      setSyncState('working');
      setSyncStatusText('\u6b63\u5728\u8bfb\u53d6\u672c\u5730\u9898\u5e93\uff0c\u8bf7\u7a0d\u5019...');
      return;
    }

    if (!window.electronAPI?.syncQuestions) {
      setSyncStatusText('\u5f53\u524d\u73af\u5883\u4e0d\u652f\u6301\u540c\u6b65');
      return;
    }

    setIsSyncing(true);
    setSyncState('working');
    setSyncStatusText('\u6b63\u5728\u540c\u6b65...');
    try {
      let pushedSnapshot = latestQuestionsRef.current;
      let finalQuestions = pushedSnapshot;
      let pendingLocalChangeCount = 0;

      // One automatic follow-up pass uploads edits made during the first request.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = await window.electronAPI.syncQuestions(pushedSnapshot);
        if (!result || !Array.isArray(result.records)) {
          throw new Error('SYNC_INVALID_RECORDS');
        }

        const remoteQuestions = normalizeServerSnapshot(result.records);
        const reconciled = reconcileServerSnapshot(
          pushedSnapshot,
          remoteQuestions,
          latestQuestionsRef.current
        );
        finalQuestions = reconciled.questions;
        pendingLocalChangeCount = reconciled.pendingLocalChangeCount;
        latestQuestionsRef.current = finalQuestions;
        replaceQuestions(finalQuestions);
        await persistQuestionsImmediately(finalQuestions);

        if (pendingLocalChangeCount === 0) {
          break;
        }
        pushedSnapshot = finalQuestions;
        setSyncStatusText('\u68c0\u6d4b\u5230\u540c\u6b65\u671f\u95f4\u7684\u65b0\u4fee\u6539\uff0c\u6b63\u5728\u8865\u5145\u540c\u6b65...');
      }

      const completedAt = new Date();
      setLastSyncAt(completedAt.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      }));
      setSyncState(pendingLocalChangeCount > 0 ? 'warning' : 'success');
      setSyncStatusText(
        pendingLocalChangeCount > 0
          ? `${pendingLocalChangeCount} \u9879\u65b0\u4fee\u6539\u5df2\u4fdd\u7559\u5728\u672c\u5730\uff0c\u4ecd\u5f85\u4e0b\u6b21\u540c\u6b65`
          : `\u540c\u6b65\u5b8c\u6210\uff1a${finalQuestions.length} \u9898`
      );
    } catch (error) {
      console.error('Failed to sync questions.', error);
      setSyncState('error');
      setSyncStatusText(getSyncErrorText(error));
    } finally {
      setIsSyncing(false);
    }
  }, [hasLoadedQuestions, isSyncing, persistQuestionsImmediately, replaceQuestions]);

  useEffect(() => {
    let isMounted = true;

    loadQuestions().then((savedQuestions) => {
      if (!isMounted) {
        return;
      }

      replaceQuestions(savedQuestions);
      setHasLoadedQuestions(true);
    });

    return () => {
      isMounted = false;
    };
  }, [replaceQuestions]);

  useEffect(() => {
    if (!hasLoadedQuestions) {
      return;
    }

    void persistQuestionsImmediately(questions);
  }, [hasLoadedQuestions, persistQuestionsImmediately, questions]);

  useEffect(() => {
    if (!window.electronAPI?.onBeforeClose) {
      return;
    }
    return window.electronAPI.onBeforeClose(async () => {
      if (!hasLoadedQuestions) {
        return;
      }
      await persistQuestionsImmediately(latestQuestionsRef.current);
      await pendingSaveRef.current;
    });
  }, [hasLoadedQuestions, persistQuestionsImmediately]);

  useEffect(() => {
    if (!window.electronAPI?.onSyncProgress) {
      return;
    }
    return window.electronAPI.onSyncProgress((progress) => {
      setSyncState('working');
      if (progress.phase === 'upload') {
        setSyncStatusText(
          `\u6b63\u5728\u4e0a\u4f20 ${progress.completed}/${progress.total} \u6279`
        );
      } else if (progress.phase === 'download') {
        setSyncStatusText(
          `\u6b63\u5728\u4e0b\u8f7d ${progress.completed} \u9875`
        );
      } else {
        setSyncStatusText('\u6b63\u5728\u51c6\u5907\u540c\u6b65...');
      }
    });
  }, []);

  const activeQuestions = useMemo(() => getActiveQuestions(questions), [questions]);
  const deletedQuestions = useMemo(() => getDeletedQuestions(questions), [questions]);
  const stats = useMemo(() => getVisibleStats(activeQuestions), [activeQuestions]);

  return (
    <HashRouter
      future={{
        v7_relativeSplatPath: true,
        v7_startTransition: true,
      }}
    >
      <div className="app-shell">
        <header className="topbar">
          <div className="topbar__inner">
            <div className="brand">
              <div className="brand__mark">WQ</div>
              <div>
                <div className="brand__title">错题助手</div>
                <div className="brand__subtitle">记录错题，高效复习</div>
              </div>
            </div>

            <nav className="nav">
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  `nav__link ${isActive ? 'nav__link--active' : ''}`
                }
              >
                添加错题
              </NavLink>
              <NavLink
                to="/questions"
                className={({ isActive }) =>
                  `nav__link ${isActive ? 'nav__link--active' : ''}`
                }
              >
                错题本
              </NavLink>
              <NavLink
                to="/review"
                className={({ isActive }) =>
                  `nav__link ${isActive ? 'nav__link--active' : ''}`
                }
              >
                复习
              </NavLink>
              <NavLink
                to="/trash"
                className={({ isActive }) =>
                  `nav__link ${isActive ? 'nav__link--active' : ''}`
                }
              >
                {'\u56de\u6536\u7ad9'}
                {deletedQuestions.length > 0 && (
                  <span className="nav__count">{deletedQuestions.length}</span>
                )}
              </NavLink>
            </nav>
            <div className={`sync-area sync-area--${syncState}`}>
              <button
                className="sync-button"
                onClick={syncQuestions}
                disabled={isSyncing}
                aria-busy={isSyncing}
              >
                <span className="sync-button__dot" aria-hidden="true" />
                {isSyncing ? '\u6b63\u5728\u540c\u6b65' : '\u7acb\u5373\u540c\u6b65'}
              </button>
              {(syncStatusText || lastSyncAt) && (
                <div className="sync-status" role="status" aria-live="polite">
                  <span>{syncStatusText}</span>
                  {lastSyncAt && syncState === 'success' && (
                    <small>{lastSyncAt}</small>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="workspace">
          <section className="overview-panel">
            <div className="overview-panel__copy">
              <p className="eyebrow">学习概览</p>
              <h1>我的学习看板</h1>
              <p>坚持记录，每一次复盘都有收获。</p>
            </div>

            <div className="overview-stats">
              <div className="stat-card">
                <span className="stat-card__label">收录错题</span>
                <strong>{stats.totalCount}</strong>
              </div>
              <div className="stat-card">
                <span className="stat-card__label">AI 已分析</span>
                <strong>{stats.analyzedCount}</strong>
              </div>
              <div className="stat-card">
                <span className="stat-card__label">复习次数</span>
                <strong>{stats.reviewedCount}</strong>
              </div>
              <div className="stat-card">
                <span className="stat-card__label">今日待复习</span>
                <strong>{stats.dueReviewCount}</strong>
              </div>
              <div className="stat-card">
                <span className="stat-card__label">薄弱题目</span>
                <strong>{stats.weakCount}</strong>
              </div>
              <div className="stat-card">
                <span className="stat-card__label">待 AI 分析</span>
                <strong>{stats.pendingAnalysisCount}</strong>
              </div>
              <div className="stat-card">
                <span className="stat-card__label">AI 需更新</span>
                <strong>{stats.staleAiCount}</strong>
              </div>
            </div>
          </section>

          <Routes>
            <Route path="/" element={<HomePage onAddQuestion={addQuestion} />} />
            <Route
              path="/questions"
              element={
                <QuestionListPage
                  questions={activeQuestions}
                  onDeleteQuestion={deleteQuestion}
                />
              }
            />
            <Route
              path="/questions/:id"
              element={
                <QuestionDetailPage
                  questions={activeQuestions}
                  onUpdateQuestionTitle={updateQuestionTitle}
                  onUpdateQuestionNotes={updateQuestionNotes}
                  onClearFollowUps={clearQuestionFollowUps}
                  onAddNoteImage={addQuestionNoteImage}
                  onDeleteNoteImage={deleteQuestionNoteImage}
                  onDeleteQuestion={deleteQuestion}
                  onMarkQuestionReviewed={reviewQuestion}
                  onGenerateAnalysis={generateAiAnalysis}
                  onGenerateDetailedExplanation={generateDetailedExplanation}
                  onGenerateHint={generateHint}
                  onSendFollowUp={sendFollowUp}
                />
              }
            />
            <Route
              path="/questions/:id/edit"
              element={
                <EditQuestionPage
                  questions={activeQuestions}
                  onUpdateQuestionContent={updateQuestionContent}
                />
              }
            />
            <Route
              path="/review"
              element={
                <ReviewPage
                  questions={activeQuestions}
                  onMarkQuestionReviewed={reviewQuestion}
                  onPostponeQuestion={postponeQuestion}
                  onRevertLastReview={undoLastReview}
                />
              }
            />
            <Route
              path="/trash"
              element={
                <TrashPage
                  questions={deletedQuestions}
                  onRestoreQuestion={restoreQuestion}
                />
              }
            />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}

function getSyncErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '');
  const knownCodes = [
    'SYNC_SERVER_UPGRADE_REQUIRED',
    'SYNC_REQUEST_TOO_LARGE',
    'TIMEOUT',
    'SYNC_INVALID_REMOTE_RECORDS',
    'SYNC_DUPLICATE_REMOTE_ID',
    'SYNC_RECORDS_REJECTED',
    'SYNC_UNAUTHORIZED',
  ];
  const code = knownCodes.find((candidate) => message.includes(candidate)) || '';
  switch (code) {
    case 'SYNC_SERVER_UPGRADE_REQUIRED':
      return '\u9519\u9898\u5e93\u8f83\u5927\uff0cVPS \u540c\u6b65\u670d\u52a1\u9700\u5347\u7ea7\u540e\u518d\u540c\u6b65';
    case 'SYNC_REQUEST_TOO_LARGE':
      return '\u5355\u6761\u9898\u76ee\u56fe\u7247\u8fc7\u5927\uff0c\u8bf7\u5220\u51cf\u6216\u538b\u7f29\u540e\u91cd\u8bd5';
    case 'TIMEOUT':
      return '\u540c\u6b65\u8d85\u65f6\uff0c\u672c\u5730\u4fee\u6539\u5df2\u4fdd\u7559\uff0c\u8bf7\u91cd\u8bd5';
    case 'SYNC_INVALID_REMOTE_RECORDS':
    case 'SYNC_DUPLICATE_REMOTE_ID':
    case 'SYNC_RECORDS_REJECTED':
      return '\u670d\u52a1\u7aef\u6570\u636e\u5f02\u5e38\uff0c\u5df2\u963b\u6b62\u8986\u76d6\u672c\u5730\u9898\u5e93';
    case 'SYNC_UNAUTHORIZED':
      return 'VPS \u540c\u6b65\u5bc6\u94a5\u65e0\u6548';
    default:
      return '\u540c\u6b65\u5931\u8d25\uff0c\u672c\u5730\u4fee\u6539\u5df2\u5b89\u5168\u4fdd\u7559';
  }
}
