import { useMemo, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Question } from '../types/question';
import './QuestionListPageV2.css';

interface QuestionListPageProps {
  questions: Question[];
  onDeleteQuestion: (id: string) => void;
}

export default function QuestionListPage({
  questions,
  onDeleteQuestion,
}: QuestionListPageProps) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');
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
    return questions.filter((question) => {
      const matchesCategory = filter === 'all' || question.category === filter;
      const searchableText = [
        question.title,
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
      return matchesCategory && matchesSearch;
    });
  }, [questions, filter, searchTerm]);

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
            placeholder="搜索标题、笔记、标签、来源或 AI 分析..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="filter-box">
          <button
            className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            全部
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              className={`filter-btn ${filter === cat ? 'active' : ''}`}
              onClick={() => setFilter(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
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
