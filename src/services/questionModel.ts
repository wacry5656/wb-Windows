import { DEFAULT_SUBJECT, isSubject } from '../constants/subjects';
import {
  FollowUpMessage,
  ImageRef,
  Question,
  QuestionAnalysis,
  QuestionReviewStatus,
  QuestionSyncStatus,
} from '../types/question';

const DEFAULT_SYNC_STATUS: QuestionSyncStatus = 'pending';
const DEFAULT_REVIEW_STATUS: QuestionReviewStatus = 'new';

export function calculateNextReviewAt(baseDate: string, reviewCount: number): string {
  const baseTimestamp = new Date(baseDate).getTime();
  const safeTimestamp = Number.isFinite(baseTimestamp) ? baseTimestamp : Date.now();
  const nextDate = new Date(safeTimestamp);
  const intervalDays = getReviewIntervalDays(reviewCount);
  nextDate.setDate(nextDate.getDate() + intervalDays);
  return nextDate.toISOString();
}

export function createInlineImageRef(
  dataUrl: string,
  kind: ImageRef['kind'],
  createdAt: string,
  id?: string,
  mimeType?: string
): ImageRef {
  return {
    id: id || createRandomId(`img-${kind}`),
    storage: 'inline',
    kind,
    dataUrl,
    createdAt,
    mimeType: mimeType || inferMimeTypeFromDataUrl(dataUrl),
  };
}

export function createFileImageRef(
  uri: string,
  kind: ImageRef['kind'],
  createdAt: string,
  id?: string,
  mimeType?: string
): ImageRef {
  return {
    id: id || createRandomId(`img-${kind}`),
    storage: 'file',
    kind,
    uri,
    createdAt,
    mimeType,
  };
}

export function createFollowUpMessage(
  role: FollowUpMessage['role'],
  content: string,
  createdAt: string,
  id?: string
): FollowUpMessage {
  return {
    id: id || createRandomId(`chat-${role}`),
    role,
    content: content.trim(),
    createdAt,
  };
}

export function getImageRefDisplaySrc(ref: ImageRef): string {
  return ref.storage === 'file' ? ref.uri : ref.dataUrl;
}

export function normalizeQuestions(value: unknown): Question[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeQuestion(item))
    .filter((question): question is Question => Boolean(question));
}

export function isActiveQuestion(question: Question): boolean {
  return question.deleted !== true;
}

export function getActiveQuestions(questions: Question[]): Question[] {
  return questions.filter(isActiveQuestion);
}

export function resolveNextSyncStatus(_currentStatus?: QuestionSyncStatus): QuestionSyncStatus {
  return 'modified';
}

function normalizeQuestion(value: unknown): Question | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const question = value as Partial<Question> & {
    imageRefs?: unknown;
    noteImageRefs?: unknown;
    reviewStatus?: unknown;
    syncStatus?: unknown;
    reviewCount?: unknown;
    notes?: unknown;
    errorCause?: unknown;
    tags?: unknown;
    grade?: unknown;
    questionType?: unknown;
    source?: unknown;
    masteryLevel?: unknown;
    deleted?: unknown;
    deletedAt?: unknown;
    updatedAt?: unknown;
    followUpChats?: unknown;
  };

  if (
    typeof question.id !== 'string' ||
    typeof question.title !== 'string' ||
    typeof question.category !== 'string' ||
    typeof question.createdAt !== 'string'
  ) {
    return null;
  }

  const createdAt = normalizeDateString(question.createdAt) || new Date().toISOString();
  const updatedAt = normalizeDateString(question.updatedAt) || createdAt;
  const contentUpdatedAt =
    normalizeDateString(question.contentUpdatedAt) || updatedAt || createdAt;
  const deleted = question.deleted === true;
  const reviewCount =
    typeof question.reviewCount === 'number' && Number.isFinite(question.reviewCount)
      ? Math.max(0, Math.floor(question.reviewCount))
      : 0;

  const imageRefs = normalizeImageRefs(
    question.imageRefs,
    'question',
    createdAt,
    typeof question.image === 'string' ? question.image : undefined
  );
  const noteImageRefs = normalizeImageRefs(
    question.noteImageRefs,
    'note',
    createdAt,
    Array.isArray(question.noteImages) ? question.noteImages : undefined
  );
  const image = resolveLegacyImage(imageRefs, question.image);

  if (!image) {
    return null;
  }

  const normalizedLastReviewedAt = normalizeDateString(question.lastReviewedAt);
  const normalizedReviewStatus = normalizeReviewStatus(question.reviewStatus, reviewCount);
  const normalizedAnalysis = normalizeQuestionAnalysis(question.analysis);
  const normalizedDetailedExplanationUpdatedAt = normalizeDateString(
    question.detailedExplanationUpdatedAt
  );
  const normalizedHintUpdatedAt = normalizeDateString(question.hintUpdatedAt);
  const normalizedFollowUpChats = normalizeFollowUpChats(question.followUpChats);
  const normalizedNotesUpdatedAt =
    normalizeDateString(question.notesUpdatedAt) ||
    (typeof question.notes === 'string' && question.notes.trim() ? updatedAt : undefined);
  const normalizedNoteImagesUpdatedAt =
    normalizeDateString(question.noteImagesUpdatedAt) ||
    (noteImageRefs.length > 0 ? updatedAt : undefined);
  const normalizedReviewUpdatedAt =
    normalizeDateString(question.reviewUpdatedAt) ||
    (reviewCount > 0 || normalizedLastReviewedAt ? normalizedLastReviewedAt || updatedAt : undefined);
  const normalizedAnalysisContentUpdatedAt =
    normalizeDateString(question.analysisContentUpdatedAt) ||
    normalizedAnalysis?.updatedAt ||
    (normalizedAnalysis ? contentUpdatedAt : undefined);
  const normalizedExplanationContentUpdatedAt =
    normalizeDateString(question.explanationContentUpdatedAt) ||
    normalizedDetailedExplanationUpdatedAt ||
    (typeof question.detailedExplanation === 'string' && question.detailedExplanation.trim()
      ? contentUpdatedAt
      : undefined);
  const normalizedHintContentUpdatedAt =
    normalizeDateString(question.hintContentUpdatedAt) ||
    normalizedHintUpdatedAt ||
    (typeof question.hint === 'string' && question.hint.trim() ? contentUpdatedAt : undefined);
  const normalizedFollowUpContentUpdatedAt =
    normalizeDateString(question.followUpContentUpdatedAt) ||
    getLatestFollowUpCreatedAt(normalizedFollowUpChats) ||
    (normalizedFollowUpChats && normalizedFollowUpChats.length > 0
      ? contentUpdatedAt
      : undefined);
  const nextReviewAt =
    normalizeDateString(question.nextReviewAt) ||
    (reviewCount > 0
      ? calculateNextReviewAt(normalizedLastReviewedAt || updatedAt, reviewCount)
      : undefined);

  return {
    id: question.id,
    title: question.title.trim(),
    questionText:
      typeof question.questionText === 'string' ? question.questionText : '',
    userAnswer: typeof question.userAnswer === 'string' ? question.userAnswer : '',
    correctAnswer:
      typeof question.correctAnswer === 'string' ? question.correctAnswer : '',
    image,
    imageRefs,
    category: isSubject(question.category) ? question.category : DEFAULT_SUBJECT,
    grade: typeof question.grade === 'string' ? question.grade.trim() : '',
    questionType:
      typeof question.questionType === 'string' ? question.questionType.trim() : '',
    source: typeof question.source === 'string' ? question.source.trim() : '',
    createdAt,
    updatedAt,
    contentUpdatedAt,
    deleted,
    deletedAt: deleted ? normalizeDateString(question.deletedAt) || updatedAt : undefined,
    syncStatus: normalizeSyncStatus(question.syncStatus),
    notes: typeof question.notes === 'string' ? question.notes : '',
    notesUpdatedAt: normalizedNotesUpdatedAt,
    errorCause: typeof question.errorCause === 'string' ? question.errorCause : '',
    tags: normalizeStringArray(question.tags),
    masteryLevel:
      typeof question.masteryLevel === 'number' && Number.isFinite(question.masteryLevel)
        ? Math.max(0, Math.min(5, Math.floor(question.masteryLevel)))
        : 0,
    reviewCount,
    lastReviewedAt: normalizedLastReviewedAt || undefined,
    nextReviewAt,
    reviewStatus: normalizedReviewStatus,
    noteImagesUpdatedAt: normalizedNoteImagesUpdatedAt,
    reviewUpdatedAt: normalizedReviewUpdatedAt,
    analysis: normalizedAnalysis,
    analysisContentUpdatedAt: normalizedAnalysisContentUpdatedAt,
    detailedExplanation:
      typeof question.detailedExplanation === 'string'
        ? question.detailedExplanation
        : undefined,
    detailedExplanationUpdatedAt: normalizedDetailedExplanationUpdatedAt,
    explanationContentUpdatedAt: normalizedExplanationContentUpdatedAt,
    hint: typeof question.hint === 'string' ? question.hint : undefined,
    hintUpdatedAt: normalizedHintUpdatedAt,
    hintContentUpdatedAt: normalizedHintContentUpdatedAt,
    followUpChats: normalizedFollowUpChats,
    followUpContentUpdatedAt: normalizedFollowUpContentUpdatedAt,
    noteImages:
      noteImageRefs.length > 0
        ? noteImageRefs.map((ref) => getImageRefDisplaySrc(ref))
        : undefined,
    noteImageRefs,
  };
}

function normalizeQuestionAnalysis(value: unknown): Question['analysis'] {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const analysis = value as Partial<QuestionAnalysis> & {
    commonMistakes?: unknown;
    knowledgePoints?: unknown;
    cautions?: unknown;
    notices?: unknown;
    difficultyScore?: unknown;
    solutionMethods?: unknown;
    recommendedMethods?: unknown;
  };

  if (
    typeof analysis.difficulty !== 'string' ||
    typeof analysis.updatedAt !== 'string' ||
    (analysis.source !== 'demo' && analysis.source !== 'ai')
  ) {
    return undefined;
  }

  return {
    ...analysis,
    difficulty: analysis.difficulty,
    difficultyScore: normalizeDifficultyScore(analysis.difficultyScore),
    commonMistakes: normalizeStringArray(analysis.commonMistakes),
    knowledgePoints: normalizeStringArray(analysis.knowledgePoints),
    solutionMethods: normalizeStringArray(
      analysis.solutionMethods ?? analysis.recommendedMethods
    ),
    cautions: normalizeStringArray(analysis.cautions ?? analysis.notices),
    notices: normalizeStringArray(analysis.notices ?? analysis.cautions),
    studyAdvice:
      typeof analysis.studyAdvice === 'string'
        ? analysis.studyAdvice
        : buildLegacyStudyAdvice(analysis),
    updatedAt: normalizeDateString(analysis.updatedAt) || new Date().toISOString(),
    source: analysis.source,
  };
}

function buildLegacyStudyAdvice(
  analysis: Partial<QuestionAnalysis> & {
    commonMistakes?: unknown;
    knowledgePoints?: unknown;
    solutionMethods?: unknown;
    recommendedMethods?: unknown;
  }
): string {
  const knowledgePoints = normalizeStringArray(analysis.knowledgePoints);
  const commonMistakes = normalizeStringArray(analysis.commonMistakes);
  const solutionMethods = normalizeStringArray(
    analysis.solutionMethods ?? analysis.recommendedMethods
  );

  return [
    knowledgePoints.length > 0 ? `重点复习：${knowledgePoints.join('、')}。` : '',
    commonMistakes.length > 0 ? `易错点：${commonMistakes[0]}。` : '',
    solutionMethods.length > 0 ? `推荐方法：${solutionMethods.join('、')}。` : '',
  ]
    .filter(Boolean)
    .join('');
}

function normalizeDifficultyScore(value: unknown): 1 | 2 | 3 | 4 | 5 | undefined {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5
    ? value
    : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeFollowUpChats(value: unknown): FollowUpMessage[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const chats = value
    .filter(
      (item): item is Partial<FollowUpMessage> =>
        Boolean(item) &&
        typeof item === 'object' &&
        (item.role === 'user' || item.role === 'assistant') &&
        typeof item.content === 'string' &&
        typeof item.createdAt === 'string'
    )
    .map((item) =>
      createFollowUpMessage(
        item.role!,
        item.content!,
        normalizeDateString(item.createdAt) || new Date().toISOString(),
        typeof item.id === 'string' && item.id.trim() ? item.id : undefined
      )
    )
    .filter((item) => item.content);

  return chats.length > 0 ? chats : undefined;
}

function getLatestFollowUpCreatedAt(
  chats: FollowUpMessage[] | undefined
): string | undefined {
  if (!chats || chats.length === 0) {
    return undefined;
  }

  return chats.reduce<string | undefined>((latest, chat) => {
    if (!latest) {
      return chat.createdAt;
    }

    return new Date(chat.createdAt).getTime() > new Date(latest).getTime()
      ? chat.createdAt
      : latest;
  }, undefined);
}

function normalizeImageRefs(
  value: unknown,
  kind: ImageRef['kind'],
  fallbackCreatedAt: string,
  legacyImages?: string | string[]
): ImageRef[] {
  const refs = Array.isArray(value)
    ? value
        .map((item) => normalizeImageRef(item, kind, fallbackCreatedAt))
        .filter((ref): ref is ImageRef => Boolean(ref))
    : [];

  if (refs.length > 0) {
    return refs;
  }

  const legacySources = Array.isArray(legacyImages)
    ? legacyImages
    : typeof legacyImages === 'string'
      ? [legacyImages]
      : [];

  return legacySources
    .map((source) => createImageRefFromSource(source, kind, fallbackCreatedAt))
    .filter((ref): ref is ImageRef => Boolean(ref));
}

function normalizeImageRef(
  value: unknown,
  kind: ImageRef['kind'],
  fallbackCreatedAt: string
): ImageRef | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const ref = value as Partial<ImageRef>;
  const normalizedCreatedAt = normalizeDateString(ref.createdAt) || fallbackCreatedAt;
  const refId = typeof ref.id === 'string' && ref.id ? ref.id : undefined;

  if (
    (ref.storage === 'file' || (typeof ref.storage !== 'string' && typeof ref.uri === 'string')) &&
    isFileImageSource(ref.uri)
  ) {
    return createFileImageRef(ref.uri!, kind, normalizedCreatedAt, refId, ref.mimeType);
  }

  if (typeof ref.dataUrl === 'string' && ref.dataUrl.startsWith('data:image/')) {
    return createInlineImageRef(
      ref.dataUrl,
      kind,
      normalizedCreatedAt,
      refId,
      ref.mimeType
    );
  }

  return null;
}

function createImageRefFromSource(
  source: unknown,
  kind: ImageRef['kind'],
  createdAt: string
): ImageRef | null {
  if (typeof source !== 'string') {
    return null;
  }

  if (source.startsWith('data:image/')) {
    return createInlineImageRef(source, kind, createdAt);
  }

  if (isFileImageSource(source)) {
    return createFileImageRef(source, kind, createdAt);
  }

  return null;
}

function resolveLegacyImage(imageRefs: ImageRef[], legacyImage: unknown): string {
  if (isDisplayImageSource(legacyImage)) {
    return legacyImage;
  }

  return imageRefs[0] ? getImageRefDisplaySrc(imageRefs[0]) : '';
}

function normalizeDateString(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function normalizeReviewStatus(
  value: unknown,
  reviewCount: number
): QuestionReviewStatus {
  if (value === 'new' || value === 'reviewing') {
    return value;
  }

  return reviewCount > 0 ? 'reviewing' : DEFAULT_REVIEW_STATUS;
}

function normalizeSyncStatus(value: unknown): QuestionSyncStatus {
  if (value === 'pending' || value === 'synced' || value === 'modified') {
    return value;
  }

  return DEFAULT_SYNC_STATUS;
}

function getReviewIntervalDays(reviewCount: number): number {
  if (reviewCount <= 0) {
    return 1;
  }

  if (reviewCount === 1) {
    return 3;
  }

  if (reviewCount === 2) {
    return 7;
  }

  if (reviewCount === 3) {
    return 14;
  }

  return 30;
}

function inferMimeTypeFromDataUrl(dataUrl: string): string | undefined {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
  return match?.[1];
}

function isDisplayImageSource(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value.startsWith('data:image/') || isFileImageSource(value))
  );
}

function isFileImageSource(value: unknown): value is string {
  return typeof value === 'string' && /^file:\/\//i.test(value);
}

function createRandomId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
