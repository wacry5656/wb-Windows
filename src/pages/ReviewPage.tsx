import { useEffect, useMemo, useState } from 'react';
import { Question } from '../types/question';
import './ReviewPageV2.css';

interface ReviewPageProps {
  questions: Question[];
  onMarkQuestionReviewed: (id: string) => void;
}

type SortType =
  | 'recent'
  | 'leastReviewed'
  | 'mostReviewed'
  | 'category'
  | 'difficulty';

export default function ReviewPage({
  questions,
  onMarkQuestionReviewed,
}: ReviewPageProps) {
  const [sortBy, setSortBy] = useState<SortType>('leastReviewed');
  const [currentIndex, setCurrentIndex] = useState(0);

  const sortedQuestions = useMemo(() => {
    const sorted = [...questions];
    switch (sortBy) {
      case 'recent':
        return sorted.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      case 'leastReviewed':
        return sorted.sort((a, b) => a.reviewCount - b.reviewCount);
      case 'mostReviewed':
        return sorted.sort((a, b) => b.reviewCount - a.reviewCount);
      case 'category':
        return sorted.sort((a, b) => a.category.localeCompare(b.category));
      case 'difficulty':
        return sorted.sort(
          (a, b) =>
            getDifficultyRank(b.analysis?.difficulty, b.analysis?.difficultyScore) -
            getDifficultyRank(a.analysis?.difficulty, a.analysis?.difficultyScore)
        );
      default:
        return sorted;
    }
  }, [questions, sortBy]);

  useEffect(() => {
    if (currentIndex > sortedQuestions.length - 1) {
      setCurrentIndex(Math.max(sortedQuestions.length - 1, 0));
    }
  }, [currentIndex, sortedQuestions.length]);

  if (questions.length === 0) {
    return (
      <div className="review-page">
        <div className="review-empty">
          <div className="empty-icon">📘</div>
          <p className="empty-text">还没有错题，去添加第一道吧</p>
        </div>
      </div>
    );
  }

  const currentQuestion = sortedQuestions[currentIndex];

  const handleMarkReviewed = () => {
    onMarkQuestionReviewed(currentQuestion.id);
    handleNext();
  };

  const handleNext = () => {
    if (currentIndex < sortedQuestions.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const handleJumpTo = (index: number) => {
    setCurrentIndex(index);
  };

  const formatDate = (date: string) => {
    const d = new Date(date);
    return d.toLocaleDateString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
    });
  };

  return (
    <div className="review-page">
      <div className="review-header">
        <h1 className="review-title">复习模式</h1>
        <p className="review-subtitle">
          第 {currentIndex + 1} / {sortedQuestions.length} 题
        </p>
      </div>

      <div className="review-container">
        <div className="review-left">
          <div className="sort-controls">
            <label className="sort-label">排序</label>
            <select
              className="sort-select"
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value as SortType);
                setCurrentIndex(0);
              }}
            >
              <option value="leastReviewed">待复习优先</option>
              <option value="mostReviewed">复习次数由多到少</option>
              <option value="recent">最近添加</option>
              <option value="category">按学科</option>
              <option value="difficulty">按难度</option>
            </select>
          </div>

          <div className="question-list-review">
            {sortedQuestions.map((q, index) => (
              <div
                key={q.id}
                className={`review-item ${index === currentIndex ? 'active' : ''}`}
                onClick={() => handleJumpTo(index)}
              >
                <span className="item-number">{index + 1}</span>
                <div className="item-info">
                  <div className="item-title">{q.title}</div>
                  <div className="item-meta">
                    <span className="item-category">{q.category}</span>
                    <span className="item-reviewed">复习 {q.reviewCount} 次</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="review-right">
          <div className="review-card">
            <div className="card-progress">
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{
                    width: `${((currentIndex + 1) / sortedQuestions.length) * 100}%`,
                  }}
                ></div>
              </div>
              <span className="progress-text">
                {currentIndex + 1} / {sortedQuestions.length}
              </span>
            </div>

            <div className="card-meta-large">
              <span className="badge badge-category">{currentQuestion.category}</span>
              <span className="badge badge-reviewed">
                复习 {currentQuestion.reviewCount} 次
              </span>
              <span className="badge badge-date">
                {formatDate(currentQuestion.createdAt)}
              </span>
              {currentQuestion.analysis && (
                <span className="badge badge-difficulty">
                  难度 {currentQuestion.analysis.difficulty}
                </span>
              )}
            </div>

            <h2 className="card-title-large">{currentQuestion.title}</h2>

            <div className="card-image-container">
              <img
                src={currentQuestion.image}
                alt={currentQuestion.title}
                className="card-image-large"
              />
            </div>

            {currentQuestion.notes && (
              <div className="card-notes">
                <h3 className="notes-title">笔记</h3>
                <p className="notes-content">{currentQuestion.notes}</p>
              </div>
            )}

            {currentQuestion.analysis && (
              <div className="card-notes card-notes--analysis">
                <h3 className="notes-title">AI 分析摘要</h3>
                <p className="notes-content">{currentQuestion.analysis.studyAdvice}</p>
              </div>
            )}

            <div className="card-actions">
              <button
                className="btn-prev"
                onClick={handlePrevious}
                disabled={currentIndex === 0}
              >
                上一题
              </button>
              <button className="btn-mark" onClick={handleMarkReviewed}>
                完成复习
              </button>
              <button
                className="btn-next"
                onClick={handleNext}
                disabled={currentIndex === sortedQuestions.length - 1}
              >
                下一题
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function getDifficultyRank(difficulty?: string, difficultyScore?: number): number {
  if (typeof difficultyScore === 'number') {
    return difficultyScore;
  }

  switch (difficulty) {
    case '简单':
    case '\u7B80\u5355':
      return 1;
    case '中等':
    case '\u4E2D\u7B49':
      return 2;
    case '困难':
    case '\u56F0\u96BE':
      return 3;
    default:
      return 0;
  }
}
