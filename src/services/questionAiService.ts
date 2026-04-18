import { Question, QuestionDifficulty } from '../types/question';
import { createFollowUpMessage } from './questionModel';
import { resolveQuestionImageForAi } from './questionImageService';
import { cleanExplanationText } from '../utils/cleanExplanationText';
import {
  generateFollowUpRequest,
  generateQuestionAnalysisRequest,
  generateQuestionExplanationRequest,
  generateQuestionHintRequest,
} from '../utils/qwenClient';

export async function generateAnalysisUpdates(
  question: Question
): Promise<Pick<Question, 'analysis'>> {
  const image = await resolveQuestionImageForAi(question);
  const result = await generateQuestionAnalysisRequest({ image });
  const difficultyScore = result.difficulty;

  return {
    analysis: {
      subject: result.subject,
      difficulty: mapDifficulty(difficultyScore),
      difficultyScore,
      commonMistakes: result.common_mistakes,
      knowledgePoints: result.knowledge_points,
      cautions: result.cautions,
      analysisSummary: result.analysis_summary,
      studyAdvice: `\u91CD\u70B9\u590D\u4E60\uFF1A${result.knowledge_points.join('\u3001')}\u3002\u6CE8\u610F\u907F\u514D\uFF1A${result.common_mistakes[0] || '\u5E38\u89C1\u6613\u9519\u70B9'}\u3002`,
      updatedAt: new Date().toISOString(),
      source: 'ai',
    },
  };
}

export async function generateDetailedExplanationUpdates(
  question: Question
): Promise<
  Pick<Question, 'detailedExplanation' | 'detailedExplanationUpdatedAt'>
> {
  const image = await resolveQuestionImageForAi(question);
  const result = await generateQuestionExplanationRequest({
    image,
    title: question.title,
    subject: question.analysis?.subject || question.category,
  });
  const cleanedExplanation = cleanExplanationText(result.explanation);

  return {
    detailedExplanation: cleanedExplanation || result.explanation.trim(),
    detailedExplanationUpdatedAt: new Date().toISOString(),
  };
}

export async function generateHintUpdates(
  question: Question
): Promise<Pick<Question, 'hint' | 'hintUpdatedAt'>> {
  const image = await resolveQuestionImageForAi(question);
  const result = await generateQuestionHintRequest({
    image,
    title: question.title,
    subject: question.analysis?.subject || question.category,
  });
  const cleanedHint = cleanExplanationText(result.hint).replace(/\n{2,}/g, '\n').trim();

  return {
    hint: cleanedHint || result.hint.trim(),
    hintUpdatedAt: new Date().toISOString(),
  };
}

export async function generateFollowUpUpdates(
  question: Question,
  userMessage: string
): Promise<{
  answer: string;
  updates: Pick<Question, 'followUpChats'>;
}> {
  const image = await resolveQuestionImageForAi(question);
  const result = await generateFollowUpRequest({
    image,
    title: question.title,
    subject: question.analysis?.subject || question.category,
    detailedExplanation: question.detailedExplanation || '',
    chatHistory: question.followUpChats || [],
    question: userMessage,
  });

  const cleanedAnswer = cleanExplanationText(result.answer) || result.answer.trim();
  const timestamp = new Date().toISOString();
  const newUserMsg = createFollowUpMessage('user', userMessage, timestamp);
  const newAssistantMsg = createFollowUpMessage('assistant', cleanedAnswer, timestamp);

  return {
    answer: cleanedAnswer,
    updates: {
      followUpChats: [...(question.followUpChats || []), newUserMsg, newAssistantMsg],
    },
  };
}

function mapDifficulty(score: 1 | 2 | 3 | 4 | 5): QuestionDifficulty {
  if (score <= 2) {
    return '\u7B80\u5355';
  }

  if (score >= 4) {
    return '\u56F0\u96BE';
  }

  return '\u4E2D\u7B49';
}
