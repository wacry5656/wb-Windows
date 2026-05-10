import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type MouseEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { DEFAULT_SUBJECT, SUBJECTS, type Subject } from '../constants/subjects';
import './HomePageV2.css';

const MAX_QUESTION_IMAGE_BYTES = 10 * 1024 * 1024;

interface HomePageProps {
  onAddQuestion: (
    title: string,
    image: string,
    category: Subject,
    metadata?: Partial<
      Pick<
        import('../types/question').Question,
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
  ) => Promise<{ id: string }>;
}

export default function HomePage({ onAddQuestion }: HomePageProps) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState<Subject>(DEFAULT_SUBJECT);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // 新增元数据字段
  const [grade, setGrade] = useState('');
  const [questionType, setQuestionType] = useState('');
  const [source, setSource] = useState('');
  const [questionText, setQuestionText] = useState('');
  const [userAnswer, setUserAnswer] = useState('');
  const [correctAnswer, setCorrectAnswer] = useState('');
  const [errorCause, setErrorCause] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    return () => {
      if (previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      titleInputRef.current?.focus();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  const handleImageUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;

    if (!file) {
      return;
    }

    if (!isSupportedImage(file)) {
      alert('请上传 JPG、JPEG 或 PNG 格式的图片');
      clearSelectedImage();
      return;
    }

    if (file.size > MAX_QUESTION_IMAGE_BYTES) {
      alert('图片不能超过 10MB，请压缩后再试');
      clearSelectedImage();
      return;
    }

    setPreviewUrl((currentPreviewUrl) => {
      if (currentPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(currentPreviewUrl);
      }

      return URL.createObjectURL(file);
    });
    setImageFile(file);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (!title.trim()) {
      alert('请输入标题');
      return;
    }

    if (!imageFile || !previewUrl) {
      alert('请上传图片');
      return;
    }

    const imageDataUrl = await readFileAsDataUrl(imageFile);
    const tags = parseTags(tagsText);
    const newQuestion = await onAddQuestion(title, imageDataUrl, subject, {
      grade: grade.trim(),
      questionType: questionType.trim(),
      source: source.trim(),
      questionText: questionText.trim(),
      userAnswer: userAnswer.trim(),
      correctAnswer: correctAnswer.trim(),
      errorCause: errorCause.trim(),
      tags,
      notes: notes.trim(),
    });

    // 重置表单
    setTitle('');
    setSubject(DEFAULT_SUBJECT);
    clearSelectedImage();
    setGrade('');
    setQuestionType('');
    setSource('');
    setQuestionText('');
    setUserAnswer('');
    setCorrectAnswer('');
    setErrorCause('');
    setTagsText('');
    setNotes('');

    navigate(`/questions/${newQuestion.id}`);
  };

  const clearSelectedImage = () => {
    setIsPreviewOpen(false);
    setImageFile(null);
    setPreviewUrl((currentPreviewUrl) => {
      if (currentPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(currentPreviewUrl);
      }

      return '';
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleLightboxContentClick = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  const handleTitleContainerMouseDown = () => {
    window.setTimeout(() => {
      titleInputRef.current?.focus();
    }, 0);
  };

  return (
    <div className="home-page">
      <section className="hero-card">
        <div>
          <p className="hero-card__eyebrow">添加错题</p>
          <h2 className="home-title">专注整理错题，提高复习效率</h2>
          <p className="home-subtitle">记录每一道错题，让复习更有针对性。</p>
        </div>

        <div className="feature-pills">
          <span>拍照录入</span>
          <span>完整元数据</span>
          <span>分类整理</span>
          <span>智能讲解</span>
        </div>
      </section>

      <div className="home-layout">
        <form className="upload-form" onSubmit={handleSubmit}>
          <div className="section-heading">
            <h3>添加错题</h3>
            <p>完善题目信息，方便后续搜索、分析和复习。</p>
          </div>

          <div
            className="form-group form-group--title"
            onMouseDown={handleTitleContainerMouseDown}
          >
            <label htmlFor="title" className="form-label">
              题目标题 <span className="required">*</span>
            </label>
            <input
              ref={titleInputRef}
              id="title"
              type="text"
              className="form-input"
              placeholder="例如：二次函数最值综合题"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="category" className="form-label">
                学科
              </label>
              <select
                id="category"
                className="form-select"
                value={subject}
                onChange={(event) => setSubject(event.target.value as Subject)}
              >
                {SUBJECTS.map((currentSubject) => (
                  <option key={currentSubject} value={currentSubject}>
                    {currentSubject}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="grade" className="form-label">
                年级
              </label>
              <input
                id="grade"
                type="text"
                className="form-input"
                placeholder="例如：高一"
                value={grade}
                onChange={(event) => setGrade(event.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="form-group">
              <label htmlFor="questionType" className="form-label">
                题型
              </label>
              <input
                id="questionType"
                type="text"
                className="form-input"
                placeholder="例如：选择题、解答题"
                value={questionType}
                onChange={(event) => setQuestionType(event.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="form-group">
              <label htmlFor="source" className="form-label">
                来源
              </label>
              <input
                id="source"
                type="text"
                className="form-input"
                placeholder="例如：期中考试、模拟卷"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                autoComplete="off"
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="questionText" className="form-label">
              题目内容
            </label>
            <textarea
              id="questionText"
              className="form-textarea"
              placeholder="手动输入题干文字，方便搜索和 AI 分析（可选）"
              value={questionText}
              onChange={(event) => setQuestionText(event.target.value)}
              rows={3}
            />
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="userAnswer" className="form-label">
                我的答案
              </label>
              <textarea
                id="userAnswer"
                className="form-textarea"
                placeholder="记录你当时写下的答案（可选）"
                value={userAnswer}
                onChange={(event) => setUserAnswer(event.target.value)}
                rows={2}
              />
            </div>

            <div className="form-group">
              <label htmlFor="correctAnswer" className="form-label">
                正确答案
              </label>
              <textarea
                id="correctAnswer"
                className="form-textarea"
                placeholder="记录标准答案或参考答案（可选）"
                value={correctAnswer}
                onChange={(event) => setCorrectAnswer(event.target.value)}
                rows={2}
              />
            </div>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="errorCause" className="form-label">
                错误原因
              </label>
              <input
                id="errorCause"
                type="text"
                className="form-input"
                placeholder="分析做错的原因（可选）"
                value={errorCause}
                onChange={(event) => setErrorCause(event.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="form-group">
              <label htmlFor="tags" className="form-label">
                标签
              </label>
              <input
                id="tags"
                type="text"
                className="form-input"
                placeholder="用逗号、顿号分隔多个标签（可选）"
                value={tagsText}
                onChange={(event) => setTagsText(event.target.value)}
                autoComplete="off"
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="notes" className="form-label">
              笔记
            </label>
            <textarea
              id="notes"
              className="form-textarea"
              placeholder="记录解题思路、注意事项或老师讲解要点（可选）"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
            />
          </div>

          <div className="form-group">
            <label htmlFor="image" className="form-label">
              题目图片 <span className="required">*</span>
            </label>
            <div className="image-upload-area">
              <input
                id="image"
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleImageUpload}
                className="file-input"
              />
              <div className="upload-placeholder">
                <div className="upload-icon">📷</div>
                <p>点击选择图片</p>
                <p className="upload-hint">支持 JPG、PNG、WebP 格式</p>
              </div>
            </div>
          </div>

          {previewUrl && (
            <div className="preview-section">
              <div className="preview-section__header">
                <h3 className="preview-title">已选图片</h3>
                <button
                  type="button"
                  className="btn-clear-image"
                  onClick={clearSelectedImage}
                >
                  重新选择
                </button>
              </div>
              <button
                type="button"
                className="preview-image-button"
                onClick={() => setIsPreviewOpen(true)}
                aria-label="放大查看预览图片"
              >
                <img src={previewUrl} alt="preview" className="preview-image" />
              </button>
              <p className="preview-tip">点击可放大查看</p>
            </div>
          )}

          <div className="submit-row">
            <button type="submit" className="btn-submit">
              保存错题
            </button>
            <p className="submit-hint">保存后可继续补充笔记、分析结果和详细讲解。</p>
          </div>
        </form>

        <aside className="tips-section">
          <div className="section-heading">
            <h3>使用提示</h3>
            <p>帮你更顺手地整理每一道题。</p>
          </div>

          <ul className="tips-list">
            <li>题目图片会保存在本地，不依赖在线存储。</li>
            <li>完善题干、答案和错因，能大幅提升 AI 分析准确度。</li>
            <li>标签和来源方便后续按维度筛选和统计。</li>
            <li>支持生成知识点分析、思路指引和详细讲解。</li>
            <li>复习页会按掌握度和复习间隔帮你智能推送。</li>
          </ul>

          <div className="future-panel">
            <h4>学习辅助</h4>
            <p>用分析结果抓重点，用详细讲解查漏补缺。</p>
            <p>把每次复盘都积累成可复用的错题记录。</p>
          </div>
        </aside>
      </div>

      {isPreviewOpen && previewUrl && (
        <div
          className="preview-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="错题图片放大预览"
          onClick={() => setIsPreviewOpen(false)}
        >
          <div
            className="preview-lightbox__content"
            onClick={handleLightboxContentClick}
          >
            <button
              type="button"
              className="preview-lightbox__close"
              onClick={() => setIsPreviewOpen(false)}
              aria-label="关闭放大预览"
            >
              关闭
            </button>
            <img
              src={previewUrl}
              alt="错题图片放大预览"
              className="preview-lightbox__image"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function isSupportedImage(file: File): boolean {
  return ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('Failed to read image file.'));
    };

    reader.onerror = () => {
      reject(new Error('Failed to read image file.'));
    };

    reader.readAsDataURL(file);
  });
}

function parseTags(input: string): string[] {
  return input
    .split(/[,，、\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag, index, arr) => arr.indexOf(tag) === index);
}
