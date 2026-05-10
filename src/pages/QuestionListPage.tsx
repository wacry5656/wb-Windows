import { useMemo, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { isQuestionDueForReview } from '../services/questionModel';
import { isQuestionAiContentStale } from '../services/questionService';
import { Question } from '../types/question';
import './QuestionListPageV2.css';

interface QuestionListPageProps {
  questions: Question[];
  onDeleteQuestion: (id: string) => void;
}

type StatusFilter = 'all' | 'due' | 'weak' | 'unanalyzed' | 'staleAi' | 'noted';
type SortOrder = 'updated' | 'due' | 'mastery' | 'difficulty' | 'created';

export default function QuestionListPage({
  questions,
  onDeleteQuestion,
}: QuestionListPageProps) {
  const navigate = useNavigate();
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('updated');
  const [searchTerm, setSearchTerm] = useState('');
  const [zoomedImage, setZoomedImage] = useState<{
    src: string;
    title: string;
  } | null>(null);

  const categories = useMemo(() => {
    const cats = new Set(questions.map((question) => question.category));
    return Array.from(cats).sort();
  }, [questions]);

  const filteredQuestions = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return questions
      .filter((question) => {
        const matchesCategory =
          categoryFilter === 'all' || question.category === categoryFilter;
        const matchesStatus = matchesQuestionStatus(question, statusFilter);
        const searchableText = [
          question.title,
          question.questionText,
          question.userAnswer,
          question.correctAnswer,
          question.notes,
          question.grade,
          question.questionType,
          question.source,
          question.errorCause,
          ...question.tags,
          ...(question.analysis?.knowledgePoints || []),
          ...(question.analysis?.commonMistakes || []),
          ...(question.analysis?.cautions || []),
          ...(question.analysis?.solutionMethods || []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        const matchesSearch =
          !normalizedSearch || searchableText.includes(normalizedSearch);
        return matchesCategory && matchesStatus && matchesSearch;
      })
      .sort((left, right) => compareQuestions(left, right, sortOrder));
  }, [questions, categoryFilter, statusFilter, searchTerm, sortOrder]);

  const quickCounts = useMemo(
    () => ({
      due: questions.filter((question) => isQuestionDueForReview(question)).length,
      weak: questions.filter((question) => question.masteryLevel <= 2).length,
      unanalyzed: questions.filter((question) => !question.analysis).length,
      staleAi: questions.filter(isQuestionAiContentStale).length,
      noted: questions.filter(
        (question) => question.notes.trim() || question.noteImageRefs.length > 0
      ).length,
    }),
    [questions]
  );

  const handleDeleteClick = (e: MouseEvent, id: string) => {
    e.stopPropagation();
    if (
      window.confirm(
        '确定删除这道错题吗？删除后会从错题本中隐藏，并保留同步所需的删除记录。'
      )
    ) {
      onDeleteQuestion(id);
    }
  };

  const handleZoomClick = (e: MouseEvent, image: string, title: string) => {
    e.stopPropagation();
    setZoomedImage({ src: image, title });
  };

  const closeZoomedImage = () => {
    setZoomedImage(null);
  };

  const handleLightboxContentClick = (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
  };

  const formatDate = (date: string) => {
    const d = new Date(date);
    return d.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  return (
    <div className="question-list-page">
      <div className="list-header">
        <h1 className="list-title">我的错题本</h1>
        <p className="list-subtitle">
          共 {questions.length} 道，当前显示 {filteredQuestions.length} 道
        </p>
      </div>

      <div className="list-controls">
        <div className="search-box">
          <input
            type="text"
            className="search-input"
            placeholder="搜索标题、题干、答案、笔记、标签、来源或 AI 分析..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="filter-box">
          <button
            className={`filter-btn ${categoryFilter === 'all' ? 'active' : ''}`}
            onClick={() => setCategoryFilter('all')}
          >
            全部
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              className={`filter-btn ${categoryFilter === cat ? 'active' : ''}`}
              onClick={() => setCategoryFilter(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="filter-box filter-box--status" aria-label="状态筛选">
          <QuickFilterButton
            label="待复习"
            count={quickCounts.due}
            active={statusFilter === 'due'}
            onClick={() => setStatusFilter((current) => current === 'due' ? 'all' : 'due')}
          />
          <QuickFilterButton
            label="薄弱"
            count={quickCounts.weak}
            active={statusFilter === 'weak'}
            onClick={() => setStatusFilter((current) => current === 'weak' ? 'all' : 'weak')}
          />
          <QuickFilterButton
            label="待分析"
            count={quickCounts.unanalyzed}
            active={statusFilter === 'unanalyzed'}
            onClick={() =>
              setStatusFilter((current) =>
                current === 'unanalyzed' ? 'all' : 'unanalyzed'
              )
            }
          />
          <QuickFilterButton
            label="AI 需更新"
            count={quickCounts.staleAi}
            active={statusFilter === 'staleAi'}
            onClick={() =>
              setStatusFilter((current) => current === 'staleAi' ? 'all' : 'staleAi')
            }
          />
          <QuickFilterButton
            label="有笔记"
            count={quickCounts.noted}
            active={statusFilter === 'noted'}
            onClick={() =>
              setStatusFilter((current) => current === 'noted' ? 'all' : 'noted')
            }
          />
        </div>

        <label className="sort-inline">
          <span>排序</span>
          <select
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value as SortOrder)}
          >
            <option value="updated">最近更新</option>
            <option value="due">待复习优先</option>
            <option value="mastery">薄弱优先</option>
            <option value="difficulty">难度优先</option>
            <option value="created">最近添加</option>
          </select>
        </label>
      </div>

      <div className="list-summary">
        <div>
          <strong>{questions.filter((question) => question.analysis).length}</strong>
          <span>已分析</span>
        </div>
        <div>
          <strong>{questions.filter((question) => question.reviewCount > 0).length}</strong>
          <span>已复习</span>
        </div>
        <div>
          <strong>{questions.filter((question) => question.notes.trim()).length}</strong>
          <span>有笔记</span>
        </div>
      </div>

      {filteredQuestions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📥</div>
          <p className="empty-text">
            {questions.length === 0
              ? '还没有错题，点击「添加错题」开始吧'
              : '未找到匹配的题目，试试其他关键词'}
          </p>
        </div>
      ) : (
        <div className="questions-grid">
          {filteredQuestions.map((question) => (
            <div
              key={question.id}
              className="question-card"
              onClick={() => navigate(`/questions/${question.id}`)}
            >
              <div className="card-image-container">
                <button
                  type="button"
                  className="btn-zoom-image"
                  onClick={(e) => handleZoomClick(e, question.image, question.title)}
                  aria-label={`放大查看 ${question.title}`}
                >
                  查看大图
                </button>
                <img
                  src={question.image}
                  alt={question.title}
                  className="card-image"
                  onClick={(e) => handleZoomClick(e, question.image, question.title)}
                />
              </div>

              <div className="card-content">
                <div className="card-header">
                  <h3 className="card-title">{question.title}</h3>
                  <button
                    className="btn-delete"
                    onClick={(e) => handleDeleteClick(e, question.id)}
                    title="删除错题"
                  >
                    ×
                  </button>
                </div>

                <div className="card-meta">
                  <span className="badge badge-category">{question.category}</span>
                  <span className="badge badge-date">
                    {formatDate(question.createdAt)}
                  </span>
                  {question.grade && <span className="badge">{question.grade}</span>}
                  {question.questionType && (
                    <span className="badge">{question.questionType}</span>
                  )}
                </div>

                {(question.source || question.tags.length > 0 || question.errorCause) && (
                  <div className="card-extra-meta">
                    {question.source && <span>来源：{question.source}</span>}
                    {question.tags.length > 0 && (
                      <span>标签：{question.tags.join('、')}</span>
                    )}
                    {question.errorCause && <span>错因：{question.errorCause}</span>}
                  </div>
                )}

                {question.notes && (
                  <p className="card-notes">{question.notes.substring(0, 100)}</p>
                )}

                <div className="card-analysis">
                  <span
                    className={`analysis-badge ${
                      question.analysis ? 'analysis-badge--ready' : ''
                    }`}
                  >
                    {question.analysis ? question.analysis.difficulty : '待分析'}
                  </span>
                  <span className="analysis-meta">
                    {question.analysis
                      ? `${question.analysis.knowledgePoints.length} 个知识点`
                      : '可生成 AI 分析'}
                  </span>
                </div>

                <div className="card-footer">
                  <span className="review-count">复习 {question.reviewCount} 次</span>
                  <span className="review-count">掌握度 {question.masteryLevel}/5</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {zoomedImage && (
        <div
          className="list-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="错题图片放大查看"
          onClick={closeZoomedImage}
        >
          <div
            className="list-lightbox__content"
            onClick={handleLightboxContentClick}
          >
            <button
              type="button"
              className="list-lightbox__close"
              onClick={closeZoomedImage}
              aria-label="关闭放大查看"
            >
              关闭
            </button>
            <img
              src={zoomedImage.src}
              alt={zoomedImage.title}
              className="list-lightbox__image"
            />
            <p className="list-lightbox__title">{zoomedImage.title}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function QuickFilterButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`filter-btn ${active ? 'active' : ''}`}
      onClick={onClick}
    >
      {label} {count}
    </button>
  );
}

function matchesQuestionStatus(question: Question, filter: StatusFilter): boolean {
  switch (filter) {
    case 'due':
      return isQuestionDueForReview(question);
    case 'weak':
      return question.masteryLevel <= 2;
    case 'unanalyzed':
      return !question.analysis;
    case 'staleAi':
      return isQuestionAiContentStale(question);
    case 'noted':
      return Boolean(question.notes.trim() || question.noteImageRefs.length > 0);
    default:
      return true;
  }
}

function compareQuestions(left: Question, right: Question, sortOrder: SortOrder): number {
  switch (sortOrder) {
    case 'due':
      return getTimestamp(left.nextReviewAt) - getTimestamp(right.nextReviewAt);
    case 'mastery':
      return left.masteryLevel - right.masteryLevel;
    case 'difficulty':
      return getDifficultyRank(right) - getDifficultyRank(left);
    case 'created':
      return getTimestamp(right.createdAt) - getTimestamp(left.createdAt);
    case 'updated':
    default:
      return getTimestamp(right.updatedAt) - getTimestamp(left.updatedAt);
  }
}

function getTimestamp(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getDifficultyRank(question: Question): number {
  if (typeof question.analysis?.difficultyScore === 'number') {
    return question.analysis.difficultyScore;
  }

  switch (question.analysis?.difficulty) {
    case '简单':
      return 1;
    case '中等':
      return 3;
    case '困难':
      return 5;
    default:
      return 0;
  }
}
