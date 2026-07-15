import { fireEvent, render, screen } from '@testing-library/react';
import { createQuestion } from '../services/questionService';
import ReviewPage from './ReviewPage';

function createDueQuestion() {
  return {
    ...createQuestion('复习测试题', '', '数学', {
      questionText: '1 + 1 = ?',
      now: '2020-01-01T00:00:00.000Z',
    }),
    id: 'review-ui-question',
    nextReviewAt: '2020-01-02T00:00:00.000Z',
  };
}

describe('ReviewPage successful-review rollback', () => {
  test('keeps the latest successful review undo available after the due list is empty', () => {
    const question = createDueQuestion();
    const onMarkQuestionReviewed = jest.fn();
    const onRevertLastReview = jest.fn();
    const props = {
      onMarkQuestionReviewed,
      onPostponeQuestion: jest.fn(),
      onRevertLastReview,
    };
    const { container, rerender } = render(
      <ReviewPage questions={[question]} {...props} />
    );

    fireEvent.click(container.querySelector('.rating-btn--2')!);
    expect(onMarkQuestionReviewed).toHaveBeenCalledWith(question.id, 2);

    rerender(
      <ReviewPage
        questions={[{ ...question, nextReviewAt: '2999-01-01T00:00:00.000Z' }]}
        {...props}
      />
    );

    const undoButton = screen.getByRole('button', {
      name: '撤销上一题的成功复习',
    });
    fireEvent.click(undoButton);

    expect(onRevertLastReview).toHaveBeenCalledWith(question.id);
    expect(
      screen.queryByRole('button', { name: '撤销上一题的成功复习' })
    ).not.toBeInTheDocument();
  });

  test('does not treat a quality-zero attempt as a successful undo target', () => {
    const question = createDueQuestion();
    const props = {
      onMarkQuestionReviewed: jest.fn(),
      onPostponeQuestion: jest.fn(),
      onRevertLastReview: jest.fn(),
    };
    const { container, rerender } = render(
      <ReviewPage questions={[question]} {...props} />
    );

    fireEvent.click(container.querySelector('.rating-btn--0')!);
    rerender(
      <ReviewPage
        questions={[{ ...question, nextReviewAt: '2999-01-01T00:00:00.000Z' }]}
        {...props}
      />
    );

    expect(props.onMarkQuestionReviewed).toHaveBeenCalledWith(question.id, 0);
    expect(
      screen.queryByRole('button', { name: '撤销上一题的成功复习' })
    ).not.toBeInTheDocument();
  });
});
