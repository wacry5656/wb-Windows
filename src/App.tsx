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
import { markQuestionReviewed } from './services/reviewService';
import { Question } from './types/question';
import { loadQuestions, saveQuestions } from './utils/questionStorage';
import './App.css';

export default function App() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [hasLoadedQuestions, setHasLoadedQuestions] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const addQuestion = useCallback(async (title: string, image: string, category: Subject) => {
    const imageRef = await persistQuestionImage(image, 'question');
    const newQuestion = createQuestion(title, imageRef, category);
    setQuestions((currentQuestions) => [newQuestion, ...currentQuestions]);
    return newQuestion;
  }, []);

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
    setQuestions((currentQuestions) => deleteQuestionById(currentQuestions, id));
  }, []);

  const reviewQuestion = useCallback((id: string) => {
    setQuestions((currentQuestions) =>
      currentQuestions.map((question) =>
        question.id === id ? markQuestionReviewed(question) : question
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

  const debouncedSave = useCallback((questionsToSave: Question[]) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
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

  const stats = useMemo(() => getVisibleStats(questions), [questions]);

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
                  questions={questions}
                  onDeleteQuestion={deleteQuestion}
                />
              }
            />
            <Route
              path="/questions/:id"
              element={
                <QuestionDetailPage
                  questions={questions}
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
                  questions={questions}
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
