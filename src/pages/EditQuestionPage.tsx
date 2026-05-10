import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { SUBJECTS, type Subject } from '../constants/subjects';
import type { Question } from '../types/question';
import './EditQuestionPage.css';

interface EditQuestionPageProps {
  questions: Question[];
  onUpdateQuestionContent: (
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
  ) => void;
}

export default function EditQuestionPage({
  questions,
  onUpdateQuestionContent,
}: EditQuestionPageProps) {
  const navigate = useNavigate();
  const { id } = useParams();
  const question = questions.find((item) => item.id === id) ?? null;

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<Subject>('数学');
  const [grade, setGrade] = useState('');
  const [questionType, setQuestionType] = useState('');
  const [source, setSource] = useState('');
  const [questionText, setQuestionText] = useState('');
  const [userAnswer, setUserAnswer] = useState('');
  const [correctAnswer, setCorrectAnswer] = useState('');
  const [errorCause, setErrorCause] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);

  useEffect(() => {
    if (question) {
      setTitle(question.title);
      setCategory(question.category as Subject);
      setGrade(question.grade);
      setQuestionType(question.questionType);
      setSource(question.source);
      setQuestionText(question.questionText);
      setUserAnswer(question.userAnswer);
      setCorrectAnswer(question.correctAnswer);
      setErrorCause(question.errorCause);
      setTagsText(question.tags.join('、'));
      setTitleError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question?.id]);

  if (!question) {
    return (
      <div className="edit-page">
        <div className="edit-empty">
          <h2>题目未找到</h2>
          <p>这道题可能已被删除，请返回错题本查看。</p>
          <button className="btn-back btn-back--inline" onClick={() => navigate('/questions')}>
            返回错题本
          </button>
        </div>
      </div>
    );
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) {
      setTitleError('标题不能为空');
      return;
    }

    const tags = parseTags(tagsText);
    onUpdateQuestionContent(question.id, {
      title: nextTitle,
      category,
      grade: grade.trim(),
      questionType: questionType.trim(),
      source: source.trim(),
      questionText: questionText.trim(),
      userAnswer: userAnswer.trim(),
      correctAnswer: correctAnswer.trim(),
      errorCause: errorCause.trim(),
      tags,
    });

    navigate(`/questions/${question.id}`);
  };

  return (
    <div className="edit-page">
      <button className="btn-back" onClick={() => navigate(`/questions/${question.id}`)}>
        ← 返回详情
      </button>

      <div className="edit-container">
        <div className="section-heading">
          <h2>编辑错题</h2>
          <p>修改题目信息，所有字段保存后立即生效。</p>
        </div>

        <form className="edit-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="edit-title" className="form-label">
              题目标题 <span className="required">*</span>
            </label>
            <input
              id="edit-title"
              type="text"
              className="form-input"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                if (titleError) setTitleError(null);
              }}
              autoComplete="off"
            />
            {titleError && <div className="form-error">{titleError}</div>}
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="edit-category" className="form-label">
                学科
              </label>
              <select
                id="edit-category"
                className="form-select"
                value={category}
                onChange={(event) => setCategory(event.target.value as Subject)}
              >
                {SUBJECTS.map((subj) => (
                  <option key={subj} value={subj}>
                    {subj}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="edit-grade" className="form-label">
                年级
              </label>
              <input
                id="edit-grade"
                type="text"
                className="form-input"
                placeholder="例如：高一"
                value={grade}
                onChange={(event) => setGrade(event.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="form-group">
              <label htmlFor="edit-questionType" className="form-label">
                题型
              </label>
              <input
                id="edit-questionType"
                type="text"
                className="form-input"
                placeholder="例如：选择题、解答题"
                value={questionType}
                onChange={(event) => setQuestionType(event.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="form-group">
              <label htmlFor="edit-source" className="form-label">
                来源
              </label>
              <input
                id="edit-source"
                type="text"
                className="form-input"
                placeholder="例如：期中考试"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                autoComplete="off"
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="edit-questionText" className="form-label">
              题目内容
            </label>
            <textarea
              id="edit-questionText"
              className="form-textarea"
              placeholder="手动输入题干文字（可选）"
              value={questionText}
              onChange={(event) => setQuestionText(event.target.value)}
              rows={4}
            />
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="edit-userAnswer" className="form-label">
                我的答案
              </label>
              <textarea
                id="edit-userAnswer"
                className="form-textarea"
                placeholder="记录你当时写下的答案（可选）"
                value={userAnswer}
                onChange={(event) => setUserAnswer(event.target.value)}
                rows={3}
              />
            </div>

            <div className="form-group">
              <label htmlFor="edit-correctAnswer" className="form-label">
                正确答案
              </label>
              <textarea
                id="edit-correctAnswer"
                className="form-textarea"
                placeholder="记录标准答案（可选）"
                value={correctAnswer}
                onChange={(event) => setCorrectAnswer(event.target.value)}
                rows={3}
              />
            </div>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="edit-errorCause" className="form-label">
                错误原因
              </label>
              <input
                id="edit-errorCause"
                type="text"
                className="form-input"
                placeholder="分析做错的原因（可选）"
                value={errorCause}
                onChange={(event) => setErrorCause(event.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="form-group">
              <label htmlFor="edit-tags" className="form-label">
                标签
              </label>
              <input
                id="edit-tags"
                type="text"
                className="form-input"
                placeholder="用逗号、顿号分隔多个标签（可选）"
                value={tagsText}
                onChange={(event) => setTagsText(event.target.value)}
                autoComplete="off"
              />
            </div>
          </div>

          <div className="submit-row">
            <button type="submit" className="btn-submit">
              保存修改
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => navigate(`/questions/${question.id}`)}
            >
              取消
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function parseTags(input: string): string[] {
  return input
    .split(/[,，、\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag, index, arr) => arr.indexOf(tag) === index);
}
