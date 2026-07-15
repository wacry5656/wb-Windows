import { Question } from '../types/question';
import './TrashPage.css';

interface TrashPageProps {
  questions: Question[];
  onRestoreQuestion: (id: string) => void;
}

export default function TrashPage({ questions, onRestoreQuestion }: TrashPageProps) {
  return (
    <section className="trash-page">
      <header className="trash-hero">
        <div>
          <p className="eyebrow">RECYCLE BIN</p>
          <h2>{'\u56de\u6536\u7ad9'}</h2>
          <p>{'\u6062\u590d\u64cd\u4f5c\u4f1a\u540c\u6b65\u5230\u5176\u4ed6\u8bbe\u5907\uff0c\u666e\u901a\u7f16\u8f91\u4e0d\u4f1a\u610f\u5916\u590d\u6d3b\u5df2\u5220\u9664\u9898\u76ee\u3002'}</p>
        </div>
        <span className="trash-count">{questions.length}</span>
      </header>

      {questions.length === 0 ? (
        <div className="trash-empty">
          <span aria-hidden="true">✓</span>
          <h3>{'\u56de\u6536\u7ad9\u662f\u7a7a\u7684'}</h3>
          <p>{'\u5220\u9664\u7684\u9898\u76ee\u4f1a\u5728\u8fd9\u91cc\u5b89\u5168\u4fdd\u7559\u3002'}</p>
        </div>
      ) : (
        <div className="trash-grid">
          {questions.map((question) => (
            <article className="trash-card" key={question.id}>
              {question.image ? (
                <img src={question.image} alt="" className="trash-card__image" />
              ) : (
                <div className="trash-card__placeholder" aria-hidden="true">T</div>
              )}
              <div className="trash-card__body">
                <span className="trash-card__subject">{question.category}</span>
                <h3>{question.title || '\u672a\u547d\u540d\u9898\u76ee'}</h3>
                <p>
                  {'\u5220\u9664\u4e8e '}
                  {question.deletedAt
                    ? new Date(question.deletedAt).toLocaleString('zh-CN')
                    : '\u672a\u77e5\u65f6\u95f4'}
                </p>
                <button type="button" onClick={() => onRestoreQuestion(question.id)}>
                  {'\u6062\u590d\u5230\u9519\u9898\u672c'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
