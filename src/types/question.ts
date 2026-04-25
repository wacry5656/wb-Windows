import { Subject } from '../constants/subjects';

export type QuestionDifficulty = '\u7B80\u5355' | '\u4E2D\u7B49' | '\u56F0\u96BE';
export type QuestionSyncStatus = 'pending' | 'synced' | 'modified';
export type QuestionReviewStatus = 'new' | 'reviewing';
export type ImageStorageType = 'inline' | 'file';
export type ReviewQuality = 0 | 1 | 2 | 3;

interface BaseImageRef {
  id: string;
  kind: 'question' | 'note';
  createdAt: string;
  mimeType?: string;
}

export type ImageRef =
  | (Omit<BaseImageRef, 'dataUrl'> & {
      storage: 'inline';
      dataUrl: string;
      uri?: undefined;
    })
  | (Omit<BaseImageRef, 'dataUrl'> & {
      storage: 'file';
      uri: string;
      dataUrl?: undefined;
    });

export interface FollowUpMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface QuestionAnalysis {
  difficulty: QuestionDifficulty;
  difficultyScore?: 1 | 2 | 3 | 4 | 5;
  commonMistakes: string[];
  knowledgePoints: string[];
  solutionMethods?: string[];
  cautions?: string[];
  notices?: string[];
  // Legacy summary kept for older saved records and review fallbacks.
  studyAdvice: string;
  updatedAt: string;
  source: 'demo' | 'ai';
}

export interface Question {
  id: string;
  title: string;
  // Legacy display field kept for UI compatibility while imageRefs are introduced.
  image: string;
  imageRefs: ImageRef[];
  category: Subject;
  grade: string;
  questionType: string;
  source: string;
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
  deletedAt?: string;
  syncStatus: QuestionSyncStatus;
  notes: string;
  errorCause: string;
  tags: string[];
  masteryLevel: number;
  reviewCount: number;
  lastReviewedAt?: string;
  nextReviewAt?: string;
  reviewStatus: QuestionReviewStatus;
  analysis?: QuestionAnalysis;
  detailedExplanation?: string;
  detailedExplanationUpdatedAt?: string;
  hint?: string;
  hintUpdatedAt?: string;
  followUpChats?: FollowUpMessage[];
  // Legacy display field kept for UI compatibility while noteImageRefs are introduced.
  noteImages?: string[];
  noteImageRefs: ImageRef[];
}
