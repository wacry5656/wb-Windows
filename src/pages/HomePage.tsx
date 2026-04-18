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

interface HomePageProps {
  onAddQuestion: (
    title: string,
    image: string,
    category: Subject
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
    const newQuestion = await onAddQuestion(title, imageDataUrl, subject);

    setTitle('');
    setSubject(DEFAULT_SUBJECT);
    clearSelectedImage();
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
          <span>本地保存</span>
          <span>分类整理</span>
          <span>智能讲解</span>
        </div>
      </section>

      <div className="home-layout">
        <form className="upload-form" onSubmit={handleSubmit}>
          <div className="section-heading">
            <h3>添加错题</h3>
            <p>上传题目图片，保存后再补充笔记和讲解。</p>
          </div>

          <div
            className="form-group form-group--title"
            onMouseDown={handleTitleContainerMouseDown}
          >
            <label htmlFor="title" className="form-label">
              题目标题
            </label>
            <input
              ref={titleInputRef}
              id="title"
              type="text"
              className="form-input"
              placeholder="例如：二次函数最值综合题"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onInput={(event) =>
                setTitle((event.target as HTMLInputElement).value)
              }
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
              <label htmlFor="image" className="form-label">
                题目图片
              </label>
              <div className="image-upload-area">
                <input
                  id="image"
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={handleImageUpload}
                  className="file-input"
                />
                <div className="upload-placeholder">
                  <div className="upload-icon">📷</div>
                  <p>点击选择图片</p>
                  <p className="upload-hint">支持 JPG、PNG 格式</p>
                </div>
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
            <li>可以补充自己的笔记、草稿图和复习记录。</li>
            <li>支持生成知识点分析、思路指引和详细讲解。</li>
            <li>复习页会按次数和状态帮你快速回看。</li>
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
  return ['image/jpeg', 'image/png'].includes(file.type);
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
