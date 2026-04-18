import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Question } from '../types/question';
import './QuestionDetailPageV2.css';

const DEFAULT_AI_TIMEOUT_MS = 60000;
const DETAILED_EXPLANATION_TIMEOUT_MS = 180000;

interface QuestionDetailPageProps {
  questions: Question[];
  onUpdateQuestionTitle: (id: string, title: string) => void;
  onUpdateQuestionNotes: (id: string, notes: string) => void;
  onClearFollowUps: (id: string) => void;
  onAddNoteImage: (id: string, dataUrl: string) => Promise<void>;
  onDeleteNoteImage: (id: string, noteImageId: string) => void;
  onDeleteQuestion: (id: string) => void;
  onMarkQuestionReviewed: (id: string) => void;
  onGenerateAnalysis: (question: Question) => Promise<void>;
  onGenerateDetailedExplanation: (question: Question) => Promise<void>;
  onGenerateHint: (question: Question) => Promise<void>;
  onSendFollowUp: (question: Question, message: string) => Promise<string>;
}

export default function QuestionDetailPage({
  questions,
  onUpdateQuestionTitle,
  onUpdateQuestionNotes,
  onClearFollowUps,
  onAddNoteImage,
  onDeleteNoteImage,
  onDeleteQuestion,
  onMarkQuestionReviewed,
  onGenerateAnalysis,
  onGenerateDetailedExplanation,
  onGenerateHint,
  onSendFollowUp,
}: QuestionDetailPageProps) {
  const navigate = useNavigate();
  const { id } = useParams();
  const question = questions.find((item) => item.id === id) ?? null;

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(question?.title || '');
  const [titleError, setTitleError] = useState<string | null>(null);

  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notes, setNotes] = useState(question?.notes || '');

  const [isImagePreviewOpen, setIsImagePreviewOpen] = useState(false);
  const [previewNoteImage, setPreviewNoteImage] = useState<string | null>(null);

  const [isGeneratingAnalysis, setIsGeneratingAnalysis] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const [isGeneratingHint, setIsGeneratingHint] = useState(false);
  const [hintError, setHintError] = useState<string | null>(null);

  const [isGeneratingDetailedExplanation, setIsGeneratingDetailedExplanation] =
    useState(false);
  const [detailedExplanationError, setDetailedExplanationError] = useState<
    string | null
  >(null);

  const [followUpInput, setFollowUpInput] = useState('');
  const [isSendingFollowUp, setIsSendingFollowUp] = useState(false);
  const [followUpError, setFollowUpError] = useState<string | null>(null);

  const followUpEndRef = useRef<HTMLDivElement>(null);
  const noteImageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTitleDraft(question?.title || '');
    setTitleError(null);
    setIsEditingTitle(false);
    setNotes(question?.notes || '');
    setIsEditingNotes(false);
  }, [question?.id, question?.title, question?.notes]);

  useEffect(() => {
    setAnalysisError(null);
    setIsGeneratingAnalysis(false);
    setHintError(null);
    setIsGeneratingHint(false);
    setDetailedExplanationError(null);
    setIsGeneratingDetailedExplanation(false);
    setFollowUpInput('');
    setFollowUpError(null);
    setIsSendingFollowUp(false);
  }, [question?.id]);

  if (!question) {
    return (
      <div className="detail-empty">
        <h2>题目未找到</h2>
        <p>这道题可能已被删除，请返回错题本查看。</p>
        <button
          className="btn-back btn-back--inline"
          onClick={() => navigate('/questions')}
        >
          返回错题本
        </button>
      </div>
    );
  }

  const handleSaveTitle = () => {
    const nextTitle = titleDraft.trim();

    if (!nextTitle) {
      setTitleError('标题不能为空');
      return;
    }

    onUpdateQuestionTitle(question.id, nextTitle);
    setTitleDraft(nextTitle);
    setTitleError(null);
    setIsEditingTitle(false);
  };

  const handleCancelTitleEdit = () => {
    setTitleDraft(question.title);
    setTitleError(null);
    setIsEditingTitle(false);
  };

  const handleSaveNotes = () => {
    onUpdateQuestionNotes(question.id, notes);
    setIsEditingNotes(false);
  };

  const handleDelete = () => {
    if (window.confirm('确定删除这道错题吗？删除后无法恢复。')) {
      onDeleteQuestion(question.id);
      navigate('/questions');
    }
  };

  const handleMarkReviewed = () => {
    const nextCount = question.reviewCount + 1;
    onMarkQuestionReviewed(question.id);
    alert(`已完成第 ${nextCount} 次复习`);
  };

  const handleLightboxContentClick = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  const handleAiError = (error: unknown, fallbackMessage: string): string => {
    if (error instanceof Error) {
      if (error.message === 'TIMEOUT') {
        return '请求超时，请检查网络后重试';
      }

      if (error.message === 'INVALID_JSON') {
        return 'AI返回格式异常';
      }

      if (
        error.message === 'UNSUPPORTED_IMAGE_SOURCE' ||
        error.message === 'IMAGE_FETCH_FAILED' ||
        error.message === 'IMAGE_CONVERSION_FAILED'
      ) {
        return '当前图片数据不可用，请重新上传题目图片后再试';
      }
    }

    return fallbackMessage;
  };

  const handleGenerateAnalysis = async () => {
    if (isGeneratingAnalysis) {
      return;
    }

    setIsGeneratingAnalysis(true);
    setAnalysisError(null);

    try {
      await Promise.race([
        onGenerateAnalysis(question),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT')), DEFAULT_AI_TIMEOUT_MS)
        ),
      ]);
    } catch (error) {
      console.error('Failed to generate Qwen analysis.', error);
      setAnalysisError(handleAiError(error, '分析失败，请重试'));
    } finally {
      setIsGeneratingAnalysis(false);
    }
  };

  const handleGenerateHint = async () => {
    if (isGeneratingHint) {
      return;
    }

    setIsGeneratingHint(true);
    setHintError(null);

    try {
      await Promise.race([
        onGenerateHint(question),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT')), DEFAULT_AI_TIMEOUT_MS)
        ),
      ]);
    } catch (error) {
      console.error('Failed to generate question hint.', error);
      setHintError(handleAiError(error, '思路指引生成失败，请重试'));
    } finally {
      setIsGeneratingHint(false);
    }
  };

  const handleGenerateDetailedExplanation = async () => {
    if (isGeneratingDetailedExplanation) {
      return;
    }

    setIsGeneratingDetailedExplanation(true);
    setDetailedExplanationError(null);

    try {
      await Promise.race([
        onGenerateDetailedExplanation(question),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('TIMEOUT')),
            DETAILED_EXPLANATION_TIMEOUT_MS
          )
        ),
      ]);
    } catch (error) {
      console.error('Failed to generate detailed explanation.', error);
      setDetailedExplanationError(handleAiError(error, '详解生成失败，请重试'));
    } finally {
      setIsGeneratingDetailedExplanation(false);
    }
  };

  const handleSendFollowUp = async () => {
    const nextMessage = followUpInput.trim();

    if (isSendingFollowUp || !nextMessage) {
      return;
    }

    setIsSendingFollowUp(true);
    setFollowUpError(null);

    try {
      await Promise.race([
        onSendFollowUp(question, nextMessage),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT')), DEFAULT_AI_TIMEOUT_MS)
        ),
      ]);
      setFollowUpInput('');
      setTimeout(() => {
        followUpEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    } catch (error) {
      console.error('Failed to send follow-up question.', error);

      if (error instanceof Error && error.message === 'MISSING_API_KEY') {
        setFollowUpError('未检测到 API Key，请检查 .env 配置');
      } else {
        setFollowUpError(handleAiError(error, '追问失败，请重试'));
      }
    } finally {
      setIsSendingFollowUp(false);
    }
  };

  const handleClearFollowUps = () => {
    if (window.confirm('清空后追问记录将无法恢复，确定清空吗？')) {
      onClearFollowUps(question.id);
    }
  };

  const handleAddNoteImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const allowedImageTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedImageTypes.includes(file.type)) {
      alert('请上传 JPG、PNG 或 WebP 格式的图片');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert('图片不能超过 10MB，请压缩后再试');
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result === 'string') {
        try {
          await onAddNoteImage(question.id, reader.result);
        } catch (error) {
          console.error('Failed to persist note image.', error);
          alert('绗旇鍥剧墖淇濆瓨澶辫触锛岃閲嶈瘯');
        }
      }
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  const handleDeleteNoteImage = (index: number) => {
    if (!window.confirm('确定删除这张图片吗？')) {
      return;
    }

    const noteImageId = question.noteImageRefs[index]?.id;
    if (!noteImageId) {
      return;
    }

    onDeleteNoteImage(question.id, noteImageId);
  };

  const formatDate = (date: string) => {
    const value = new Date(date);

    return value.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const renderTextBlocks = (text: string) =>
    text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => <p key={`${index}-${line.slice(0, 16)}`}>{line}</p>);

  return (
    <div className="detail-page">
      <button className="btn-back" onClick={() => navigate('/questions')}>
        ← 返回错题本
      </button>

      <div className="detail-container">
        <div className="detail-image-section">
          <button
            type="button"
            className="detail-image-button"
            onClick={() => setIsImagePreviewOpen(true)}
            aria-label="放大查看错题图片"
          >
            <img src={question.image} alt={question.title} className="detail-image" />
          </button>
          <p className="detail-image-tip">点击可放大查看</p>
        </div>

        <div className="detail-info-section">
          <div className="detail-header">
            <div className="detail-title-area">
              {isEditingTitle ? (
                <div className="detail-title-editor">
                  <input
                    className="detail-title-input"
                    value={titleDraft}
                    onChange={(event) => {
                      setTitleDraft(event.target.value);
                      if (titleError) {
                        setTitleError(null);
                      }
                    }}
                    placeholder="输入题目标题"
                  />
                  <div className="detail-title-editor__actions">
                    <button className="btn-secondary btn-secondary--compact" onClick={handleSaveTitle}>
                      保存
                    </button>
                    <button
                      className="btn-edit btn-edit--compact"
                      onClick={handleCancelTitleEdit}
                    >
                      取消
                    </button>
                  </div>
                  {titleError && <div className="detail-title-error">{titleError}</div>}
                </div>
              ) : (
                <div className="detail-title-row">
                  <h1 className="detail-title">{question.title}</h1>
                  <button
                    className="btn-text btn-text--neutral"
                    onClick={() => setIsEditingTitle(true)}
                  >
                    编辑标题
                  </button>
                </div>
              )}

              <div className="detail-meta">
                <span className="badge badge-category">{question.category}</span>
                <span className="badge badge-date">{formatDate(question.createdAt)}</span>
                {question.analysis && (
                  <span className="badge badge-analysis">{question.analysis.difficulty}</span>
                )}
              </div>
            </div>

            <div className="detail-actions">
              <button
                className="btn-icon btn-mark"
                onClick={handleMarkReviewed}
                title="标记为已复习"
              >
                <span className="btn-icon__symbol" aria-hidden="true">
                  ✓
                </span>
                <span className="btn-icon__text">完成复习</span>
              </button>
              <button
                className="btn-icon btn-delete"
                onClick={handleDelete}
                title="删除错题"
              >
                <span className="btn-icon__symbol" aria-hidden="true">
                  ×
                </span>
                <span className="btn-icon__text">删除</span>
              </button>
            </div>
          </div>

          <div className="detail-divider" />

          <div className="analysis-panel">
            <div className="analysis-panel__header">
              <div>
                <h2 className="section-title">AI 分析</h2>
                <p className="section-subtitle">智能识别知识点、易错点和难度评估</p>
              </div>
              <button
                className="btn-primary"
                onClick={handleGenerateAnalysis}
                disabled={isGeneratingAnalysis}
              >
                {isGeneratingAnalysis
                  ? '正在分析...'
                  : question.analysis
                    ? '重新分析'
                    : '开始分析'}
              </button>
            </div>

            {analysisError && (
              <div className="analysis-error" role="alert">
                {analysisError}
              </div>
            )}

            {question.analysis ? (
              <div className="analysis-grid">
                <div className="analysis-card">
                  <span className="analysis-card__label">难度</span>
                  <strong>
                    {question.analysis.difficultyScore
                      ? `${question.analysis.difficultyScore}/5 · ${question.analysis.difficulty}`
                      : question.analysis.difficulty}
                  </strong>
                </div>
                <div className="analysis-card">
                  <span className="analysis-card__label">学科</span>
                  <strong>{question.analysis.subject || question.category}</strong>
                </div>
                <div className="analysis-card analysis-card--wide">
                  <span className="analysis-card__label">知识点</span>
                  <div className="knowledge-pills">
                    {question.analysis.knowledgePoints.map((point) => (
                      <span key={point}>{point}</span>
                    ))}
                  </div>
                </div>
                <div className="analysis-card analysis-card--wide">
                  <span className="analysis-card__label">易错点</span>
                  <ul className="analysis-list">
                    {question.analysis.commonMistakes.map((mistake) => (
                      <li key={mistake}>{mistake}</li>
                    ))}
                  </ul>
                </div>
                <div className="analysis-card analysis-card--wide">
                  <span className="analysis-card__label">注意事项</span>
                  {question.analysis.cautions && question.analysis.cautions.length > 0 ? (
                    <ul className="analysis-list">
                      {question.analysis.cautions.map((caution) => (
                        <li key={caution}>{caution}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="analysis-card__placeholder">暂无</p>
                  )}
                </div>
                <div className="analysis-card analysis-card--wide">
                  <span className="analysis-card__label">分析总结</span>
                  <p>{question.analysis.analysisSummary || question.analysis.studyAdvice}</p>
                </div>
              </div>
            ) : (
              <div className="analysis-empty">
                <p>点击“开始分析”，查看这道题的知识点、易错点和难度。</p>
              </div>
            )}
          </div>

          <div className="detail-divider" />

          <div className="analysis-panel">
            <div className="analysis-panel__header">
              <div>
                <h2 className="section-title">思路指引</h2>
                <p className="section-subtitle">先给一点方向，方便你继续自己推。</p>
              </div>
              <button
                className="btn-secondary"
                onClick={handleGenerateHint}
                disabled={isGeneratingHint}
              >
                {isGeneratingHint ? '生成中...' : question.hint ? '重新指引' : '思路指引'}
              </button>
            </div>

            {hintError && (
              <div className="analysis-error" role="alert">
                {hintError}
              </div>
            )}

            {question.hint ? (
              <div className="detailed-explanation-card hint-card">
                <div className="detailed-explanation-card__meta">
                  <span>思路指引</span>
                  {question.hintUpdatedAt && <span>{formatDate(question.hintUpdatedAt)}</span>}
                </div>
                <div className="detailed-explanation-content">{renderTextBlocks(question.hint)}</div>
              </div>
            ) : (
              <div className="analysis-empty">
                <p>点击“思路指引”，先拿到几个关键提醒，再继续自己思考。</p>
              </div>
            )}
          </div>

          <div className="detail-divider" />

          <div className="analysis-panel">
            <div className="analysis-panel__header">
              <div>
                <h2 className="section-title">AI 详解</h2>
                <p className="section-subtitle">逐步拆解解题思路与过程</p>
              </div>
              <button
                className="btn-secondary"
                onClick={handleGenerateDetailedExplanation}
                disabled={isGeneratingDetailedExplanation}
              >
                {isGeneratingDetailedExplanation
                  ? '正在生成...'
                  : question.detailedExplanation
                    ? '重新生成'
                    : '生成讲解'}
              </button>
            </div>

            {detailedExplanationError && (
              <div className="analysis-error" role="alert">
                {detailedExplanationError}
              </div>
            )}

            {question.detailedExplanation ? (
              <div className="detailed-explanation-card">
                <div className="detailed-explanation-card__meta">
                  <span>详细讲解</span>
                  {question.detailedExplanationUpdatedAt && (
                    <span>{formatDate(question.detailedExplanationUpdatedAt)}</span>
                  )}
                </div>
                <div className="detailed-explanation-content">
                  {renderTextBlocks(question.detailedExplanation)}
                </div>
              </div>
            ) : (
              <div className="analysis-empty">
                <p>点击“生成讲解”，查看更完整的解题过程。</p>
              </div>
            )}

            {question.detailedExplanation && (
              <div className="followup-panel">
                <div className="followup-panel__header">
                  <h3 className="followup-panel__title">继续追问</h3>
                  {question.followUpChats && question.followUpChats.length > 0 && (
                    <button
                      className="btn-text btn-text--danger"
                      onClick={handleClearFollowUps}
                    >
                      清空记录
                    </button>
                  )}
                </div>

                {question.followUpChats && question.followUpChats.length > 0 && (
                  <div className="followup-messages">
                    {question.followUpChats.map((message) => (
                      <div
                        key={message.id}
                        className={`followup-msg followup-msg--${message.role}`}
                      >
                        <div className="followup-msg__label">
                          {message.role === 'user' ? '我' : 'AI 老师'}
                        </div>
                        <div className="followup-msg__content">
                          {renderTextBlocks(message.content)}
                        </div>
                      </div>
                    ))}
                    <div ref={followUpEndRef} />
                  </div>
                )}

                {followUpError && (
                  <div className="analysis-error" role="alert">
                    {followUpError}
                  </div>
                )}

                <div className="followup-input-area">
                  <textarea
                    className="followup-textarea"
                    value={followUpInput}
                    onChange={(event) => setFollowUpInput(event.target.value)}
                    placeholder="有疑问？继续追问这道题。"
                    rows={2}
                    disabled={isSendingFollowUp}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        handleSendFollowUp();
                      }
                    }}
                  />
                  <button
                    className="btn-primary followup-send-btn"
                    onClick={handleSendFollowUp}
                    disabled={isSendingFollowUp || !followUpInput.trim()}
                  >
                    {isSendingFollowUp ? '思考中...' : '发送'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="detail-divider" />

          <div className="detail-notes-section">
            <h2 className="section-title">我的笔记</h2>
            {isEditingNotes ? (
              <div className="notes-editor">
                <textarea
                  className="notes-textarea"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="写下你的思路、错因和需要注意的地方..."
                  rows={8}
                />
                <div className="editor-actions">
                  <button className="btn-primary" onClick={handleSaveNotes}>
                    保存笔记
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      setNotes(question.notes || '');
                      setIsEditingNotes(false);
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <div className="notes-display">
                {notes ? (
                  <p className="notes-text" style={{ whiteSpace: 'pre-wrap' }}>
                    {notes}
                  </p>
                ) : (
                  <p className="notes-empty">还没有笔记，点击编辑写下你的思考吧。</p>
                )}
                <button className="btn-edit" onClick={() => setIsEditingNotes(true)}>
                  编辑
                </button>
              </div>
            )}

            <div className="note-images-section">
              <div className="note-images-header">
                <h3 className="note-images-title">图片笔记</h3>
                <input
                  ref={noteImageInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp"
                  className="note-images-file-input"
                  onChange={handleAddNoteImage}
                />
                <button
                  className="btn-secondary"
                  onClick={() => noteImageInputRef.current?.click()}
                >
                  添加图片
                </button>
              </div>

              {question.noteImages && question.noteImages.length > 0 ? (
                <div className="note-images-grid">
                  {question.noteImages.map((image, index) => (
                    <div key={index} className="note-image-item">
                      <button
                        type="button"
                        className="note-image-preview-btn"
                        onClick={() => setPreviewNoteImage(image)}
                        aria-label="放大查看笔记图片"
                      >
                        <img
                          src={image}
                          alt={`笔记图片 ${index + 1}`}
                          className="note-image-thumb"
                        />
                      </button>
                      <button
                        className="note-image-delete"
                        onClick={() => handleDeleteNoteImage(index)}
                        title="删除图片"
                        aria-label="删除笔记图片"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="notes-empty">拍照上传手写笔记或草稿图片。</p>
              )}
            </div>
          </div>

          <div className="detail-divider" />

          <div className="detail-stats">
            <div className="stat-item">
              <span className="stat-label">复习次数</span>
              <span className="stat-value">{question.reviewCount} 次</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">创建时间</span>
              <span className="stat-value">{formatDate(question.createdAt)}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">分析状态</span>
              <span className="stat-value">{question.analysis ? '已分析' : '待分析'}</span>
            </div>
          </div>
        </div>
      </div>

      {isImagePreviewOpen && (
        <div
          className="detail-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="错题图片放大查看"
          onClick={() => setIsImagePreviewOpen(false)}
        >
          <div
            className="detail-lightbox__content"
            onClick={handleLightboxContentClick}
          >
            <button
              type="button"
              className="detail-lightbox__close"
              onClick={() => setIsImagePreviewOpen(false)}
              aria-label="关闭放大查看"
            >
              关闭
            </button>
            <img
              src={question.image}
              alt={question.title}
              className="detail-lightbox__image"
            />
            <p className="detail-lightbox__title">{question.title}</p>
          </div>
        </div>
      )}

      {previewNoteImage && (
        <div
          className="detail-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="笔记图片放大查看"
          onClick={() => setPreviewNoteImage(null)}
        >
          <div
            className="detail-lightbox__content"
            onClick={handleLightboxContentClick}
          >
            <button
              type="button"
              className="detail-lightbox__close"
              onClick={() => setPreviewNoteImage(null)}
              aria-label="关闭放大查看"
            >
              关闭
            </button>
            <img
              src={previewNoteImage}
              alt="笔记图片放大"
              className="detail-lightbox__image"
            />
          </div>
        </div>
      )}
    </div>
  );
}
