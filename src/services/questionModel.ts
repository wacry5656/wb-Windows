import { DEFAULT_SUBJECT, isSubject } from '../constants/subjects';
import {
  FollowUpMessage,
  ImageRef,
  Question,
  QuestionAnalysis,
  ReviewEvent,
  QuestionReviewStatus,
  QuestionSyncStatus,
} from '../types/question';
import { createLegacyFollowUpId } from './followUpChatIds';

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

export function isQuestionDueForReview(
  question: Pick<Question, 'nextReviewAt'>,
  now: string = new Date().toISOString()
): boolean {
  if (!question.nextReviewAt) {
    return true;
  }

  const dueTimestamp = new Date(question.nextReviewAt).getTime();
  const nowTimestamp = new Date(now).getTime();

  return Number.isFinite(dueTimestamp) && Number.isFinite(nowTimestamp)
    ? dueTimestamp <= nowTimestamp
    : true;
}

export function createInlineImageRef(
  dataUrl: string,
  kind: ImageRef['kind'],
  createdAt: string,
  id?: string,
  mimeType?: string,
  contentHash?: string
): ImageRef {
  return {
    id: id || createRandomId(`img-${kind}`),
    storage: 'inline',
    kind,
    dataUrl,
    createdAt,
    mimeType: mimeType || inferMimeTypeFromDataUrl(dataUrl),
    contentHash,
    status: 'available',
  };
}

export function createFileImageRef(
  uri: string,
  kind: ImageRef['kind'],
  createdAt: string,
  id?: string,
  mimeType?: string,
  contentHash?: string
): ImageRef {
  return {
    id: id || createRandomId(`img-${kind}`),
    storage: 'file',
    kind,
    uri,
    createdAt,
    mimeType,
    contentHash,
    status: 'available',
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

export function getDeletedQuestions(questions: Question[]): Question[] {
  return questions.filter((question) => question.deleted === true);
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
  const reviewEvents = normalizeReviewEvents(
    question.reviewEvents,
    question.id,
    reviewCount,
    normalizeDateString(question.lastReviewedAt) ||
      normalizeDateString(question.reviewUpdatedAt) ||
      updatedAt
  );
  const derivedReviewCount = getEffectiveReviewCount(reviewEvents);

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
  const questionText =
    typeof question.questionText === 'string' ? question.questionText : '';

  const normalizedLastReviewedAt = normalizeDateString(question.lastReviewedAt);
  const normalizedReviewStatus = normalizeReviewStatus(
    question.reviewStatus,
    derivedReviewCount
  );
  const normalizedAnalysis = normalizeQuestionAnalysis(question.analysis);
  const normalizedDetailedExplanationUpdatedAt = normalizeDateString(
    question.detailedExplanationUpdatedAt
  );
  const normalizedHintUpdatedAt = normalizeDateString(question.hintUpdatedAt);
  const normalizedFollowUpChats = normalizeFollowUpChats(
    question.followUpChats,
    question.id,
    createdAt
  );
  const normalizedNotesUpdatedAt =
    normalizeDateString(question.notesUpdatedAt) ||
    (typeof question.notes === 'string' && question.notes.trim() ? updatedAt : undefined);
  const normalizedNoteImagesUpdatedAt =
    normalizeDateString(question.noteImagesUpdatedAt) ||
    (noteImageRefs.length > 0 ? updatedAt : undefined);
  const normalizedReviewUpdatedAt =
    normalizeDateString(question.reviewUpdatedAt) ||
    (derivedReviewCount > 0 || normalizedLastReviewedAt
      ? normalizedLastReviewedAt || updatedAt
      : undefined);
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
    (derivedReviewCount > 0
      ? calculateNextReviewAt(normalizedLastReviewedAt || updatedAt, derivedReviewCount)
      : undefined);

  return {
    id: question.id,
    title: question.title.trim(),
    questionText,
    userAnswer: typeof question.userAnswer === 'string' ? question.userAnswer : '',
    correctAnswer:
      typeof question.correctAnswer === 'string' ? question.correctAnswer : '',
    image: image || '',
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
    deletedAt:
      normalizeDateString(question.deletedAt) || (deleted ? updatedAt : undefined),
    restoredAt: normalizeDateString(question.restoredAt),
    tombstoneCompacted: question.tombstoneCompacted === true ? true : undefined,
    syncStatus: normalizeSyncStatus(question.syncStatus),
    notes: typeof question.notes === 'string' ? question.notes : '',
    notesUpdatedAt: normalizedNotesUpdatedAt,
    errorCause: typeof question.errorCause === 'string' ? question.errorCause : '',
    tags: normalizeStringArray(question.tags),
    masteryLevel:
      typeof question.masteryLevel === 'number' && Number.isFinite(question.masteryLevel)
        ? Math.max(0, Math.min(5, Math.floor(question.masteryLevel)))
        : 0,
    reviewCount: derivedReviewCount,
    lastReviewedAt: normalizedLastReviewedAt || undefined,
    nextReviewAt,
    reviewStatus: normalizedReviewStatus,
    reviewEvents,
    imageRefsUpdatedAt:
      normalizeDateString(question.imageRefsUpdatedAt) ||
      (imageRefs.length > 0 ? contentUpdatedAt : undefined),
    imageRefsComplete: question.imageRefsComplete !== false,
    noteImagesUpdatedAt: normalizedNoteImagesUpdatedAt,
    noteImageRefsUpdatedAt:
      normalizeDateString(question.noteImageRefsUpdatedAt) ||
      normalizedNoteImagesUpdatedAt,
    noteImageRefsComplete: question.noteImageRefsComplete !== false,
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

function normalizeFollowUpChats(
  value: unknown,
  questionId: string,
  fallbackCreatedAt: string
): FollowUpMessage[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const chats = value
    .map((valueItem, sourceIndex): FollowUpMessage | null => {
      if (!valueItem || typeof valueItem !== 'object') {
        return null;
      }
      const item = valueItem as Partial<FollowUpMessage> & { createdAt?: unknown };
      if (
        (item.role !== 'user' && item.role !== 'assistant') ||
        typeof item.content !== 'string' ||
        !item.content.trim()
      ) {
        return null;
      }

      const role = item.role;
      const rawContent = item.content;
      const createdAt = normalizeFollowUpCreatedAt(
        item.createdAt,
        fallbackCreatedAt
      );
      const existingId =
        typeof item.id === 'string' && item.id.trim() ? item.id : undefined;

      return createFollowUpMessage(
        role,
        rawContent,
        createdAt,
        existingId ||
          createLegacyFollowUpId({
            questionId,
            role,
            content: rawContent,
            createdAtMillis: new Date(createdAt).getTime(),
            sourceIndex,
          })
      );
    })
    .filter((item): item is FollowUpMessage => Boolean(item));

  return chats.length > 0 ? chats : undefined;
}

function normalizeFollowUpCreatedAt(value: unknown, fallbackCreatedAt: string): string {
  const timestamp =
    typeof value === 'number' && Number.isFinite(value)
      ? value
      : typeof value === 'string'
        ? new Date(value).getTime()
        : Number.NaN;
  return Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp).toISOString()
    : fallbackCreatedAt;
}

function normalizeReviewEvents(
  value: unknown,
  questionId: string,
  legacyReviewCount: number,
  legacyReviewedAt: string
): ReviewEvent[] {
  const events = Array.isArray(value)
    ? value
        .map(normalizeReviewEvent)
        .filter((event): event is ReviewEvent => Boolean(event))
    : [];

  if (events.length > 0 || legacyReviewCount <= 0) {
    return deduplicateReviewEvents(events);
  }

  return Array.from({ length: legacyReviewCount }, (_, index) => ({
    id: `legacy-review:${questionId}:${index + 1}`,
    kind: 'review' as const,
    reviewedAt: legacyReviewedAt,
    quality: 2 as const,
  }));
}

function normalizeReviewEvent(value: unknown): ReviewEvent | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const event = value as Partial<ReviewEvent>;
  const id = typeof event.id === 'string' ? event.id.trim() : '';
  const reviewedAt = normalizeDateString(event.reviewedAt);
  if (!id || !reviewedAt || (event.kind !== 'review' && event.kind !== 'revert')) {
    return null;
  }

  if (event.kind === 'revert') {
    const targetEventId =
      typeof event.targetEventId === 'string' ? event.targetEventId.trim() : '';
    if (!targetEventId) {
      return null;
    }
    return {
      id,
      kind: 'revert',
      reviewedAt,
      targetEventId,
      deviceId:
        typeof event.deviceId === 'string' && event.deviceId.trim()
          ? event.deviceId.trim()
          : undefined,
    };
  }

  const quality = event.quality;
  if (quality !== 0 && quality !== 1 && quality !== 2 && quality !== 3) {
    return null;
  }

  return {
    id,
    kind: 'review',
    reviewedAt,
    quality,
    deviceId:
      typeof event.deviceId === 'string' && event.deviceId.trim()
        ? event.deviceId.trim()
        : undefined,
  };
}

function deduplicateReviewEvents(events: ReviewEvent[]): ReviewEvent[] {
  const byId = new Map<string, ReviewEvent>();
  events.forEach((event) => {
    const previous = byId.get(event.id);
    if (!previous || event.reviewedAt >= previous.reviewedAt) {
      byId.set(event.id, event);
    }
  });
  return [...byId.values()].sort((left, right) =>
    left.reviewedAt === right.reviewedAt
      ? left.id.localeCompare(right.id)
      : left.reviewedAt.localeCompare(right.reviewedAt)
  );
}

export function getEffectiveReviewEvents(events: ReviewEvent[]): ReviewEvent[] {
  const revertedIds = new Set(
    events
      .filter((event) => event.kind === 'revert' && event.targetEventId)
      .map((event) => event.targetEventId!)
  );
  return events.filter(
    (event) => event.kind === 'review' && !revertedIds.has(event.id)
  );
}

export function getEffectiveReviewCount(events: ReviewEvent[]): number {
  return getEffectiveReviewEvents(events).filter(
    (event) => event.quality === 1 || event.quality === 2 || event.quality === 3
  ).length;
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
    return createFileImageRef(
      ref.uri!,
      kind,
      normalizedCreatedAt,
      refId,
      ref.mimeType,
      ref.contentHash
    );
  }

  if (typeof ref.dataUrl === 'string' && ref.dataUrl.startsWith('data:image/')) {
    return createInlineImageRef(
      ref.dataUrl,
      kind,
      normalizedCreatedAt,
      refId,
      ref.mimeType,
      ref.contentHash
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
  const normalizedValue = typeof value === 'string' ? value.toLowerCase() : '';
  if (normalizedValue === 'new') {
    return 'new';
  }
  if (normalizedValue === 'reviewing' || normalizedValue === 'mastered') {
    return 'reviewing';
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
  if (reviewCount <= 1) {
    return 1;
  }

  if (reviewCount === 2) {
    return 3;
  }

  if (reviewCount === 3) {
    return 7;
  }

  if (reviewCount === 4) {
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
