import { FollowUpMessage } from '../types/question';

type AnalysisResponse = {
  subject: string;
  knowledge_points: string[];
  common_mistakes: string[];
  difficulty: 1 | 2 | 3 | 4 | 5;
  cautions: string[];
  analysis_summary: string;
};

type ExplanationResponse = {
  explanation: string;
};

type HintResponse = {
  hint: string;
};

type FollowUpResponse = {
  answer: string;
};

type GenerateImagePayload = {
  image: string;
  title?: string;
  subject?: string;
};

type FollowUpPayload = GenerateImagePayload & {
  detailedExplanation: string;
  chatHistory: FollowUpMessage[];
  question: string;
};

function invokeElectronOnly<T>(electronCall: (() => Promise<T>) | undefined) {
  // AI requests are Electron-only. Do not route real API keys through renderer env vars.
  if (!electronCall) {
    return Promise.reject(new Error('ELECTRON_AI_REQUIRED'));
  }

  return electronCall();
}

export function generateQuestionAnalysisRequest(
  payload: GenerateImagePayload
): Promise<AnalysisResponse> {
  return invokeElectronOnly(
    window.electronAPI?.generateQuestionAnalysis
      ? () => window.electronAPI!.generateQuestionAnalysis({ image: payload.image })
      : undefined
  );
}

export function generateQuestionExplanationRequest(
  payload: GenerateImagePayload
): Promise<ExplanationResponse> {
  return invokeElectronOnly(
    window.electronAPI?.generateQuestionExplanation
      ? () =>
          window.electronAPI!.generateQuestionExplanation({
            image: payload.image,
            title: payload.title || '',
            subject: payload.subject || '',
          })
      : undefined
  );
}

export function generateQuestionHintRequest(
  payload: GenerateImagePayload
): Promise<HintResponse> {
  return invokeElectronOnly(
    window.electronAPI?.generateQuestionHint
      ? () =>
          window.electronAPI!.generateQuestionHint({
            image: payload.image,
            title: payload.title || '',
            subject: payload.subject || '',
          })
      : undefined
  );
}

export function generateFollowUpRequest(
  payload: FollowUpPayload
): Promise<FollowUpResponse> {
  return invokeElectronOnly(
    window.electronAPI?.generateFollowUp
      ? () =>
          window.electronAPI!.generateFollowUp({
            image: payload.image,
            title: payload.title || '',
            subject: payload.subject || '',
            detailedExplanation: payload.detailedExplanation,
            chatHistory: payload.chatHistory,
            question: payload.question,
          })
      : undefined
  );
}
