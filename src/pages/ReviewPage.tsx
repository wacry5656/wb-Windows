import { useEffect, useMemo, useState } from 'react';
import { Question, ReviewQuality } from '../types/question';
import { isQuestionDueForReview } from '../services/questionModel';
import './ReviewPageV2.css';

interface ReviewPageProps {
  questions: Question[];
  onMarkQuestionReviewed: (id: string, quality?: ReviewQuality) => void;
  onPostponeQuestion: (id: string) => void;
}

type SortType =
  | 'recent'
  | 'leastReviewed'
  | 'mostReviewed'
  | 'category'
  | 'difficulty'
  | 'weakness';

export default function ReviewPage({
  questions,
  onMarkQuestionReviewed,
  onPostponeQuestion,
}: ReviewPageProps) {
  const [sortBy, setSortBy] = useState<SortType>('leastReviewed');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAllQuestions, setShowAllQuestions] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);

  // 计算待复习题目
  const reviewQuestions = useMemo(() => {
    if (showAllQuestions) return questions;
    return questions.filter((q) => isQuestionDueForReview(q));
  }, [questions, showAllQuestions]);

  const dueReviewCount = useMemo(
    () => questions.filter((q) => isQuestionDueForReview(q)).length,
    [questions]
  );

  // 安全排序：防止 NaN 导致排序异常
  const sortedQuestions = useMemo(() => {
    const list = [...reviewQuestions];
    const safeNum = (n: number) => (Number.isFinite(n) ? n : 0);

    const getNextTime = (q: Question): number => {
      if (!q.nextReviewAt) return 0;
      const t = new Date(q.nextReviewAt).getTime();
      return safeNum(t);
    };

    const getDiff = (q: Question): number => {
      if (typeof q.analysis?.difficultyScore === 'number' && Number.isFinite(q.analysis.difficultyScore)) {
        return q.analysis.difficultyScore;
      }
      switch (q.analysis?.difficulty) {
        case '简单':
          return 1;
        case '中等':
          return 2;
        case '困难':
          return 3;
        default:
          return 0;
      }
    };

    switch (sortBy) {
      case 'recent':
        return list.sort((a, b) => safeNum(new Date(b.createdAt).getTime()) - safeNum(new Date(a.createdAt).getTime()));
      case 'leastReviewed':
        return list.sort((a, b) => {
          const cmp = safeNum(getNextTime(a)) - safeNum(getNextTime(b));
          if (cmp !== 0) return cmp;
          return safeNum(a.reviewCount) - safeNum(b.reviewCount);
        });
      case 'mostReviewed':
        return list.sort((a, b) => safeNum(b.reviewCount) - safeNum(a.reviewCount));
      case 'category':
        return list.sort((a, b) => a.category.localeCompare(b.category));
      case 'difficulty':
        return list.sort((a, b) => safeNum(getDiff(b)) - safeNum(getDiff(a)));
      case 'weakness':
        return list.sort((a, b) => safeNum(a.masteryLevel) - safeNum(b.masteryLevel));
      default:
        return list;
    }
  }, [reviewQuestions, sortBy]);

  // 确保 currentIndex 始终有效
  const safeIndex = Math.min(currentIndex, Math.max(0, sortedQuestions.length - 1));
  const currentQuestion = sortedQuestions[safeIndex];

  // 当 sortedQuestions 长度变化时，修正索引
  useEffect(() => {
    if (currentIndex >= sortedQuestions.length && sortedQuestions.length > 0) {
      setCurrentIndex(sortedQuestions.length - 1);
    }
    setShowAnswer(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedQuestions.length]);

  // 切换题目时隐藏答案
  useEffect(() => {
    setShowAnswer(false);
  }, [safeIndex]);

  // 空状态
  if (!Array.isArray(questions) || questions.length === 0) {
    return (
      <div className="review-page">
        <div className="review-empty">
          <div className="empty-icon">📘</div>
          <p className="empty-text">还没有错题，去添加第一道吧</p>
        </div>
      </div>
    );
  }

  if (sortedQuestions.length === 0) {
    return (
      <div className="review-page">
        <div className="review-header">
          <h1 className="review-title">复习模式</h1>
          <p className="review-subtitle">今日没有需要复习的题目</p>
        </div>
        <div className="review-empty">
          <div className="empty-icon">📘</div>
          <p className="empty-text">到期题目已清空，也可以切换到全部题目回顾。</p>
          <button
            type="button"
            className="btn-mark"
            onClick={() => {
              setShowAllQuestions(true);
              setCurrentIndex(0);
            }}
          >
            查看全部题目
          </button>
        </div>
      </div>
    );
  }

  // 安全检查：如果 currentQuestion 仍然不存在，显示加载中
  if (!currentQuestion) {
    return (
      <div className="review-page">
        <div className="review-empty">
          <div className="empty-icon">⏳</div>
          <p className="empty-text">加载中...</p>
        </div>
      </div>
    );
  }

  const handleMarkReviewed = (quality: ReviewQuality) => {
    onMarkQuestionReviewed(currentQuestion.id, quality);
    if (safeIndex < sortedQuestions.length - 1) {
      setCurrentIndex(safeIndex + 1);
    }
  };

  const handlePostpone = () => {
    onPostponeQuestion(currentQuestion.id);
    if (safeIndex < sortedQuestions.length - 1) {
      setCurrentIndex(safeIndex + 1);
    }
  };

  const handleNext = () => {
    if (safeIndex < sortedQuestions.length - 1) {
      setCurrentIndex(safeIndex + 1);
    }
  };

  const handlePrevious = () => {
    if (safeIndex > 0) {
      setCurrentIndex(safeIndex - 1);
    }
  };

  const handleJumpTo = (index: number) => {
    if (index >= 0 && index < sortedQuestions.length) {
      setCurrentIndex(index);
    }
  };

  const formatDate = (date: string) => {
    try {
      return new Date(date).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <div className="review-page">
      {/* 顶部标题栏 */}
      <div className="review-header">
        <div className="review-header-left">
          <h1 className="review-title">复习模式</h1>
          <p className="review-subtitle">
            今日待复习 <strong>{dueReviewCount}</strong> 题 · 当前第{' '}
            <strong>{safeIndex + 1}</strong> / {sortedQuestions.length} 题
          </p>
        </div>
        <div className="review-header-right">
          <div className="progress-ring">
            <svg viewBox="0 0 36 36" className="progress-ring-svg">
              <path
                className="progress-ring-bg"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <path
                className="progress-ring-fill"
                strokeDasharray={`${((safeIndex + 1) / sortedQuestions.length) * 100}, 100`}
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
            <span className="progress-ring-text">{Math.round(((safeIndex + 1) / sortedQuestions.length) * 100)}%</span>
          </div>
        </div>
      </div>

      <div className="review-container">
        {/* 左侧导航栏 */}
        <aside className="review-sidebar">
          <div className="sidebar-controls">
            <label className="sidebar-label">排序方式</label>
            <select
              className="sidebar-select"
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value as SortType);
                setCurrentIndex(0);
              }}
            >
              <option value="leastReviewed">待复习优先</option>
              <option value="weakness">薄弱优先</option>
              <option value="mostReviewed">复习次数多→少</option>
              <option value="recent">最近添加</option>
              <option value="category">按学科</option>
              <option value="difficulty">按难度</option>
            </select>
            <label className="sidebar-toggle">
              <input
                type="checkbox"
                checked={showAllQuestions}
                onChange={(e) => {
                  setShowAllQuestions(e.target.checked);
                  setCurrentIndex(0);
                }}
              />
              <span>显示全部题目</span>
            </label>
          </div>

          <div className="sidebar-list">
            {sortedQuestions.map((q, idx) => (
              <button
                key={q.id}
                className={`sidebar-item ${idx === safeIndex ? 'active' : ''}`}
                onClick={() => handleJumpTo(idx)}
              >
                <span className="sidebar-num">{idx + 1}</span>
                <div className="sidebar-info">
                  <span className="sidebar-title">{q.title}</span>
                  <span className="sidebar-meta">
                    {q.category} · 复习{q.reviewCount}次 · 掌握{q.masteryLevel}/5
                  </span>
                </div>
                {isQuestionDueForReview(q) && <span className="sidebar-due" />}
              </button>
            ))}
          </div>
        </aside>

        {/* 右侧主卡片 */}
        <main className="review-main">
          <div className="review-card">
            {/* 题目信息头部 */}
            <div className="card-header">
              <div className="card-badges">
                <span className="badge badge-category">{currentQuestion.category}</span>
                {currentQuestion.grade && (
                  <span className="badge badge-grade">{currentQuestion.grade}</span>
                )}
                {currentQuestion.questionType && (
                  <span className="badge badge-type">{currentQuestion.questionType}</span>
                )}
                {currentQuestion.analysis && (
                  <span className="badge badge-difficulty">
                    难度 {currentQuestion.analysis.difficulty}
                  </span>
                )}
              </div>
              <div className="card-date">
                <span>{formatDate(currentQuestion.createdAt)}</span>
                <span>· 复习 {currentQuestion.reviewCount} 次</span>
                <span>· 掌握度 {currentQuestion.masteryLevel}/5</span>
              </div>
            </div>

            {/* 标题 */}
            <h2 className="card-title">{currentQuestion.title}</h2>

            {/* 来源/标签/错因 */}
            {(currentQuestion.source || currentQuestion.tags.length > 0 || currentQuestion.errorCause) && (
              <div className="card-tags-row">
                {currentQuestion.source && <span>📚 {currentQuestion.source}</span>}
                {currentQuestion.tags.length > 0 && (
                  <span>🏷️ {currentQuestion.tags.join(' · ')}</span>
                )}
                {currentQuestion.errorCause && (
                  <span className="tag-error">❌ {currentQuestion.errorCause}</span>
                )}
              </div>
            )}

            {/* 题目图片 */}
            <div className="card-image-wrap">
              <img
                src={currentQuestion.image}
                alt={currentQuestion.title}
                className="card-image"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>

            {/* 题目内容 */}
            {currentQuestion.questionText && (
              <div className="card-section">
                <h3 className="section-label">📝 题目内容</h3>
                <p className="section-body">{currentQuestion.questionText}</p>
              </div>
            )}

            {/* 答案区域 */}
            {!showAnswer ? (
              <button
                type="button"
                className="btn-reveal"
                onClick={() => setShowAnswer(true)}
              >
                <span className="reveal-icon">👁</span>
                显示答案与解析
              </button>
            ) : (
              <div className="answer-panel">
                {currentQuestion.userAnswer && (
                  <div className="answer-block answer-block--wrong">
                    <div className="answer-header">
                      <span className="answer-icon">✗</span>
                      <span className="answer-label">我的答案</span>
                    </div>
                    <p className="answer-body">{currentQuestion.userAnswer}</p>
                  </div>
                )}

                {currentQuestion.correctAnswer && (
                  <div className="answer-block answer-block--correct">
                    <div className="answer-header">
                      <span className="answer-icon">✓</span>
                      <span className="answer-label">正确答案</span>
                    </div>
                    <p className="answer-body">{currentQuestion.correctAnswer}</p>
                  </div>
                )}

                {currentQuestion.notes && (
                  <div className="answer-block answer-block--notes">
                    <div className="answer-header">
                      <span className="answer-icon">📝</span>
                      <span className="answer-label">我的笔记</span>
                    </div>
                    <p className="answer-body">{currentQuestion.notes}</p>
                  </div>
                )}

                {currentQuestion.analysis && (
                  <div className="answer-block answer-block--analysis">
                    <div className="answer-header">
                      <span className="answer-icon">🤖</span>
                      <span className="answer-label">AI 分析</span>
                    </div>
                    <div className="analysis-grid">
                      <div className="analysis-item">
                        <span className="analysis-key">难度</span>
                        <span className="analysis-val">
                          {currentQuestion.analysis.difficulty}
                          {currentQuestion.analysis.difficultyScore &&
                            ` (${currentQuestion.analysis.difficultyScore}/5)`}
                        </span>
                      </div>
                      {currentQuestion.analysis.knowledgePoints.length > 0 && (
                        <div className="analysis-item analysis-item--full">
                          <span className="analysis-key">知识点</span>
                          <div className="analysis-tags">
                            {currentQuestion.analysis.knowledgePoints.map((p) => (
                              <span key={p} className="analysis-tag">{p}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {currentQuestion.analysis.commonMistakes.length > 0 && (
                        <div className="analysis-item analysis-item--full">
                          <span className="analysis-key">易错点</span>
                          <ul className="analysis-list">
                            {currentQuestion.analysis.commonMistakes.map((m) => (
                              <li key={m}>{m}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {currentQuestion.analysis.solutionMethods &&
                        currentQuestion.analysis.solutionMethods.length > 0 && (
                        <div className="analysis-item analysis-item--full">
                          <span className="analysis-key">推荐方法</span>
                          <ul className="analysis-list">
                            {currentQuestion.analysis.solutionMethods.map((m) => (
                              <li key={m}>{m}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {currentQuestion.analysis.cautions &&
                        currentQuestion.analysis.cautions.length > 0 && (
                        <div className="analysis-item analysis-item--full">
                          <span className="analysis-key">注意事项</span>
                          <ul className="analysis-list">
                            {currentQuestion.analysis.cautions.map((c) => (
                              <li key={c}>{c}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  className="btn-hide"
                  onClick={() => setShowAnswer(false)}
                >
                  <span className="reveal-icon">🙈</span>
                  隐藏答案
                </button>
              </div>
            )}

            {/* 底部导航 */}
            <div className="card-nav">
              <button
                className="nav-btn nav-btn--secondary"
                onClick={handlePrevious}
                disabled={safeIndex === 0}
              >
                ← 上一题
              </button>
              <button
                className="nav-btn nav-btn--secondary"
                onClick={handleNext}
                disabled={safeIndex === sortedQuestions.length - 1}
              >
                下一题 →
              </button>
            </div>

            {/* 掌握度评分 */}
            <div className="rating-panel">
              <p className="rating-title">这道题掌握得怎么样？</p>
              <div className="rating-buttons">
                <button className="rating-btn rating-btn--0" onClick={() => handleMarkReviewed(0)}>
                  <span className="rating-emoji">😵</span>
                  <span className="rating-text">完全不会</span>
                </button>
                <button className="rating-btn rating-btn--1" onClick={() => handleMarkReviewed(1)}>
                  <span className="rating-emoji">😕</span>
                  <span className="rating-text">有点模糊</span>
                </button>
                <button className="rating-btn rating-btn--2" onClick={() => handleMarkReviewed(2)}>
                  <span className="rating-emoji">🙂</span>
                  <span className="rating-text">基本会了</span>
                </button>
                <button className="rating-btn rating-btn--3" onClick={() => handleMarkReviewed(3)}>
                  <span className="rating-emoji">😎</span>
                  <span className="rating-text">非常熟练</span>
                </button>
              </div>
            </div>

            {/* 推迟复习 */}
            <div className="postpone-row">
              <button type="button" className="btn-postpone" onClick={handlePostpone}>
                ⏰ 暂时跳过，24小时后再复习
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
