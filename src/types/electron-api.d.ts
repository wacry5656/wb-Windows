import type { FollowUpMessage, ImageRef, Question } from './question';

export interface QwenAnalysisResponse {
  knowledge_points: string[];
  common_mistakes: string[];
  solution_methods?: string[];
  difficulty: 1 | 2 | 3 | 4 | 5;
  cautions: string[];
  analysis_summary?: string;
}

export interface QwenDetailedExplanationResponse {
  explanation: string;
}

export interface QwenHintResponse {
  hint: string;
}

export interface QwenFollowUpResponse {
  answer: string;
}

export interface ElectronApi {
  getApiConfigStatus: () => Promise<{
    provider: string;
    envFileLoaded: boolean;
    envFilePath: string | null;
    keyConfigured: boolean;
    keySource: string | null;
    storageFilePath: string;
  }>;
  generateQuestionAnalysis: (payload: {
    image: string;
    title?: string;
    subject?: string;
    questionText?: string;
    userAnswer?: string;
    correctAnswer?: string;
  }) => Promise<QwenAnalysisResponse>;
  generateQuestionExplanation: (payload: {
    image: string;
    title: string;
    subject: string;
    questionText?: string;
    userAnswer?: string;
    correctAnswer?: string;
  }) => Promise<QwenDetailedExplanationResponse>;
  generateQuestionHint: (payload: {
    image: string;
    title: string;
    subject: string;
    questionText?: string;
    userAnswer?: string;
    correctAnswer?: string;
  }) => Promise<QwenHintResponse>;
  generateFollowUp: (payload: {
    image: string;
    title: string;
    subject: string;
    questionText?: string;
    userAnswer?: string;
    correctAnswer?: string;
    detailedExplanation: string;
    chatHistory: FollowUpMessage[];
    question: string;
  }) => Promise<QwenFollowUpResponse>;
  loadQuestions: () => Promise<Question[]>;
  saveQuestions: (
    questions: Question[]
  ) => Promise<{
    success: boolean;
    storageFilePath: string;
    cleanedImagePaths?: string[];
  }>;
  persistImage?: (payload: {
    dataUrl: string;
    kind: ImageRef['kind'];
    createdAt: string;
  }) => Promise<ImageRef>;
  readImageDataUrl?: (payload: {
    uri: string;
  }) => Promise<string>;
  syncQuestions?: (
    questions: Question[]
  ) => Promise<{
    ok: boolean;
    serverTime?: string;
    records: unknown[];
  }>;
}

declare global {
  interface Window {
    electronAPI?: ElectronApi;
  }
}

export {};
