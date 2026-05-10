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

function cleanChatText(text: string): string {
  if (!text.trim()) {
    return '';
  }

  let cleaned = text
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/```/g, '')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/^[\s]*[-*][\s]+/gm, '')
    .replace(/^[ \t]+>/gm, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const unwantedOpenings = [
    /^(小柒[：:]\s*)/,
    /^(作为小柒[，,]\s*)/,
    /^(我[想觉得][，,]?\s*)/,
  ];
  for (const pattern of unwantedOpenings) {
    cleaned = cleaned.replace(pattern, '');
  }

  return cleaned.trim();
}

export async function generateAnalysisUpdates(
  question: Question
): Promise<Pick<Question, 'analysis' | 'analysisContentUpdatedAt'>> {
  const image = await resolveQuestionImageForAi(question);
  const result = await generateQuestionAnalysisRequest({
    image,
    title: question.title,
    subject: question.category,
    questionText: question.questionText,
    userAnswer: question.userAnswer,
    correctAnswer: question.correctAnswer,
  });
  const difficultyScore = result.difficulty;

  return {
    analysis: {
      difficulty: mapDifficulty(difficultyScore),
      difficultyScore,
      commonMistakes: result.common_mistakes,
      knowledgePoints: result.knowledge_points,
      solutionMethods:
        result.solution_methods && result.solution_methods.length > 0
          ? result.solution_methods
          : result.analysis_summary
            ? [result.analysis_summary]
            : [],
      cautions: result.cautions,
      notices: result.cautions,
      studyAdvice: buildStudyAdvice(
        result.knowledge_points,
        result.common_mistakes,
        result.solution_methods
      ),
      updatedAt: new Date().toISOString(),
      source: 'ai',
    },
    analysisContentUpdatedAt: question.contentUpdatedAt,
  };
}

export async function generateDetailedExplanationUpdates(
  question: Question
): Promise<
  Pick<
    Question,
    'detailedExplanation' | 'detailedExplanationUpdatedAt' | 'explanationContentUpdatedAt'
  >
> {
  const image = await resolveQuestionImageForAi(question);
  const result = await generateQuestionExplanationRequest({
    image,
    title: question.title,
    subject: question.category,
    questionText: question.questionText,
    userAnswer: question.userAnswer,
    correctAnswer: question.correctAnswer,
  });
  const cleanedExplanation = cleanExplanationText(result.explanation);

  return {
    detailedExplanation: cleanedExplanation || result.explanation.trim(),
    detailedExplanationUpdatedAt: new Date().toISOString(),
    explanationContentUpdatedAt: question.contentUpdatedAt,
  };
}

export async function generateHintUpdates(
  question: Question
): Promise<Pick<Question, 'hint' | 'hintUpdatedAt' | 'hintContentUpdatedAt'>> {
  const image = await resolveQuestionImageForAi(question);
  const result = await generateQuestionHintRequest({
    image,
    title: question.title,
    subject: question.category,
    questionText: question.questionText,
    userAnswer: question.userAnswer,
    correctAnswer: question.correctAnswer,
  });
  const cleanedHint = cleanExplanationText(result.hint).replace(/\n{2,}/g, '\n').trim();

  return {
    hint: cleanedHint || result.hint.trim(),
    hintUpdatedAt: new Date().toISOString(),
    hintContentUpdatedAt: question.contentUpdatedAt,
  };
}

export async function generateFollowUpUpdates(
  question: Question,
  userMessage: string
): Promise<{
  answer: string;
  updates: Pick<Question, 'followUpChats' | 'followUpContentUpdatedAt'>;
}> {
  const image = await resolveQuestionImageForAi(question);
  const result = await generateFollowUpRequest({
    image,
    title: question.title,
    subject: question.category,
    questionText: question.questionText,
    userAnswer: question.userAnswer,
    correctAnswer: question.correctAnswer,
    detailedExplanation: question.detailedExplanation || '',
    chatHistory: question.followUpChats || [],
    question: userMessage,
  });

  const cleanedAnswer = cleanChatText(result.answer) || result.answer.trim();
  const timestamp = new Date().toISOString();
  const newUserMsg = createFollowUpMessage('user', userMessage, timestamp);
  const newAssistantMsg = createFollowUpMessage('assistant', cleanedAnswer, timestamp);

  return {
    answer: cleanedAnswer,
    updates: {
      followUpChats: [...(question.followUpChats || []), newUserMsg, newAssistantMsg],
      followUpContentUpdatedAt: question.contentUpdatedAt,
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

function buildStudyAdvice(
  knowledgePoints: string[],
  commonMistakes: string[],
  solutionMethods?: string[]
): string {
  const parts = [];

  if (knowledgePoints.length > 0) {
    parts.push(`重点复习：${knowledgePoints.join('、')}。`);
  }

  if (commonMistakes.length > 0) {
    parts.push(`易错点：${commonMistakes[0]}。`);
  }

  if (solutionMethods && solutionMethods.length > 0) {
    parts.push(`推荐方法：${solutionMethods.join('、')}。`);
  }

  return parts.join('');
}
