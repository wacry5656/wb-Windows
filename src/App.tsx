import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { Subject } from './constants/subjects';
import QuestionDetailPage from './pages/QuestionDetailPage';
import HomePage from './pages/HomePage';
import QuestionListPage from './pages/QuestionListPage';
import ReviewPage from './pages/ReviewPage';
import {
  generateAnalysisUpdates,
  generateDetailedExplanationUpdates,
  generateFollowUpUpdates,
  generateHintUpdates,
} from './services/questionAiService';
import { persistQuestionImage } from './services/questionImageService';
import {
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
} from './services/questionService';
import { getActiveQuestions, normalizeQuestions } from './services/questionModel';
import { markQuestionReviewed } from './services/reviewService';
import { Question } from './types/question';
import { loadQuestions, saveQuestions } from './utils/questionStorage';
import './App.css';

export default function App() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [hasLoadedQuestions, setHasLoadedQuestions] = useState(false);
  const [syncStatusText, setSyncStatusText] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const latestQuestionsRef = useRef<Question[]>([]);

  const persistQuestionsImmediately = useCallback((questionsToSave: Question[]) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = undefined;
    }

    latestQuestionsRef.current = questionsToSave;
    void saveQuestions(questionsToSave).catch((error) => {
      console.error('Failed to immediately save questions:', error);
    });
  }, []);

  const addQuestion = useCallback(
    async (
      title: string,
      image: string,
      category: Subject,
      metadata?: Partial<
        Pick<
          Question,
          'grade' | 'questionType' | 'source' | 'notes' | 'errorCause' | 'tags'
        >
      >
    ) => {
      const imageRef = await persistQuestionImage(image, 'question');
      const newQuestion = createQuestion(title, imageRef, category, metadata);
      setQuestions((currentQuestions) => [newQuestion, ...currentQuestions]);
      return newQuestion;
    },
    []
  );

  const updateQuestionTitle = useCallback((id: string, title: string) => {
    setQuestions((currentQuestions) => updateQuestionTitleById(currentQuestions, id, title));
  }, []);

  const updateQuestionNotes = useCallback((id: string, notes: string) => {
    setQuestions((currentQuestions) => updateQuestionNotesById(currentQuestions, id, notes));
  }, []);

  const clearQuestionFollowUps = useCallback((id: string) => {
    setQuestions((currentQuestions) =>
      replaceQuestionFollowUpChatsById(currentQuestions, id, [])
    );
  }, []);

  const addQuestionNoteImage = useCallback(async (id: string, dataUrl: string) => {
    const imageRef = await persistQuestionImage(dataUrl, 'note');
    setQuestions((currentQuestions) => {
      const question = findQuestionById(currentQuestions, id);
      if (!question) {
        return currentQuestions;
      }

      return replaceQuestionNoteImagesById(currentQuestions, id, [
        ...question.noteImageRefs,
        imageRef,
      ]);
    });
  }, []);

  const deleteQuestionNoteImage = useCallback((id: string, noteImageId: string) => {
    setQuestions((currentQuestions) =>
      removeQuestionNoteImageById(currentQuestions, id, noteImageId)
    );
  }, []);

  const deleteQuestion = useCallback((id: string) => {
    setQuestions((currentQuestions) => {
      const nextQuestions = deleteQuestionById(currentQuestions, id);
      persistQuestionsImmediately(nextQuestions);
      return nextQuestions;
    });
  }, [persistQuestionsImmediately]);

  const reviewQuestion = useCallback((id: string, quality: 0 | 1 | 2 | 3 = 2) => {
    setQuestions((currentQuestions) =>
      currentQuestions.map((question) =>
        question.id === id ? markQuestionReviewed(question, quality) : question
      )
    );
  }, []);

  const generateAiAnalysis = useCallback(async (question: Question) => {
    try {
      const updates = await generateAnalysisUpdates(question);
      setQuestions((currentQuestions) =>
        updateQuestionById(currentQuestions, question.id, updates)
      );
    } catch (error) {
      console.error('Failed to generate AI analysis.', error);
      throw error;
    }
  }, []);

  const generateDetailedExplanation = useCallback(async (question: Question) => {
    try {
      const updates = await generateDetailedExplanationUpdates(question);
      setQuestions((currentQuestions) =>
        updateQuestionById(currentQuestions, question.id, updates)
      );
    } catch (error) {
      console.error('Failed to generate detailed explanation.', error);
      throw error;
    }
  }, []);

  const generateHint = useCallback(async (question: Question) => {
    try {
      const updates = await generateHintUpdates(question);
      setQuestions((currentQuestions) =>
        updateQuestionById(currentQuestions, question.id, updates)
      );
    } catch (error) {
      console.error('Failed to generate hint.', error);
      throw error;
    }
  }, []);

  const sendFollowUp = useCallback(async (question: Question, userMessage: string) => {
    try {
      const result = await generateFollowUpUpdates(question, userMessage);
      setQuestions((currentQuestions) =>
        updateQuestionById(currentQuestions, question.id, result.updates)
      );
      return result.answer;
    } catch (error) {
      console.error('Failed to send follow-up.', error);
      throw error;
    }
  }, []);

  const syncQuestions = useCallback(async () => {
    if (isSyncing) {
      return;
    }

    if (!window.electronAPI?.syncQuestions) {
      setSyncStatusText('\u5f53\u524d\u73af\u5883\u4e0d\u652f\u6301\u540c\u6b65');
      return;
    }

    setIsSyncing(true);
    setSyncStatusText('\u6b63\u5728\u540c\u6b65...');
    try {
      const localQuestions = latestQuestionsRef.current;
      const uploadedCount = localQuestions.length;
      const result = await window.electronAPI.syncQuestions(localQuestions);
      if (!result || !Array.isArray(result.records)) {
        throw new Error('SYNC_INVALID_RECORDS');
      }

      if (uploadedCount > 0 && result.records.length === 0) {
        throw new Error('SYNC_EMPTY_REMOTE');
      }

      const remoteQuestions = normalizeQuestions(result.records).map((question) => ({
        ...question,
        syncStatus: 'synced' as const,
      }));

      if (remoteQuestions.length < result.records.length) {
        console.warn('Sync normalization dropped remote records.', {
          received: result.records.length,
          normalized: remoteQuestions.length,
        });
      }

      if (localQuestions.length > 0 && remoteQuestions.length === 0) {
        throw new Error('SYNC_EMPTY_REMOTE');
      }

      if (localQuestions.length > 0 && remoteQuestions.length < localQuestions.length) {
        console.warn('Sync returned fewer questions than local cache.', {
          local: localQuestions.length,
          remote: remoteQuestions.length,
        });
      }

      setQuestions(remoteQuestions);
      persistQuestionsImmediately(remoteQuestions);
      setSyncStatusText(`\u540c\u6b65\u5b8c\u6210\uff1a${remoteQuestions.length} \u9898`);
    } catch (error) {
      console.error('Failed to sync questions.', error);
      if (error instanceof Error && error.message === 'SYNC_EMPTY_REMOTE') {
        setSyncStatusText('\u540c\u6b65\u5f02\u5e38\uff1a\u670d\u52a1\u7aef\u8fd4\u56de\u7a7a\u6570\u636e');
        return;
      }
      setSyncStatusText('\u540c\u6b65\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5 VPS \u914d\u7f6e');
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, persistQuestionsImmediately]);

  useEffect(() => {
    let isMounted = true;

    loadQuestions().then((savedQuestions) => {
      if (!isMounted) {
        return;
      }

      setQuestions(savedQuestions);
      setHasLoadedQuestions(true);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    latestQuestionsRef.current = questions;
  }, [questions]);

  const debouncedSave = useCallback((questionsToSave: Question[]) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
      latestQuestionsRef.current = questionsToSave;
      saveQuestions(questionsToSave).catch((error) => {
        console.error('Failed to auto-save questions:', error);
      });
    }, 800);
  }, []);

  useEffect(() => {
    if (!hasLoadedQuestions) {
      return;
    }

    debouncedSave(questions);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [debouncedSave, hasLoadedQuestions, questions]);

  useEffect(() => {
    return () => {
      if (!hasLoadedQuestions || !saveTimerRef.current) {
        return;
      }

      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = undefined;
      void saveQuestions(latestQuestionsRef.current).catch((error) => {
        console.error('Failed to flush pending questions on shutdown:', error);
      });
    };
  }, [hasLoadedQuestions]);

  const activeQuestions = useMemo(() => getActiveQuestions(questions), [questions]);
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
            </nav>
            <div className="sync-area">
              <button
                className="sync-button"
                onClick={syncQuestions}
                disabled={isSyncing}
                aria-busy={isSyncing}
              >
                {isSyncing ? '\u6b63\u5728\u540c\u6b65...' : '\u540c\u6b65'}
              </button>
              {syncStatusText && <span className="sync-status">{syncStatusText}</span>}
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
              path="/review"
              element={
                <ReviewPage
                  questions={activeQuestions}
                  onMarkQuestionReviewed={reviewQuestion}
                />
              }
            />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
