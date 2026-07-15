import { Subject } from '../constants/subjects';
import { FollowUpMessage, ImageRef, Question, QuestionSyncStatus } from '../types/question';
import {
  calculateNextReviewAt,
  createFileImageRef,
  createInlineImageRef,
  getImageRefDisplaySrc,
  isQuestionDueForReview,
  resolveNextSyncStatus,
} from './questionModel';

interface QuestionMutationOptions {
  now?: string;
}

export type QuestionImageInput = string | ImageRef;

export function createQuestion(
  title: string,
  image: QuestionImageInput,
  category: Subject,
  metadataOrOptions: Partial<
    Pick<
      Question,
      | 'grade'
      | 'questionType'
      | 'source'
      | 'questionText'
      | 'userAnswer'
      | 'correctAnswer'
      | 'notes'
      | 'errorCause'
      | 'tags'
    >
  > &
    QuestionMutationOptions = {},
  options: QuestionMutationOptions = {}
): Question {
  const isLegacyOptionsOnly =
    'now' in metadataOrOptions &&
    !('grade' in metadataOrOptions) &&
    !('questionType' in metadataOrOptions) &&
    !('source' in metadataOrOptions) &&
    !('notes' in metadataOrOptions) &&
    !('errorCause' in metadataOrOptions) &&
    !('tags' in metadataOrOptions);
  const metadata = isLegacyOptionsOnly ? {} : metadataOrOptions;
  const mutationOptions = isLegacyOptionsOnly ? metadataOrOptions : options;
  const timestamp = mutationOptions.now || new Date().toISOString();
  // 纯文字错题（无图）不生成空的 imageRef，避免污染同步数据
  const imageRef =
    typeof image === 'string' && !image.trim()
      ? null
      : resolveImageInput(image, 'question', timestamp);

  return {
    id: createQuestionId(),
    title: title.trim(),
    questionText: metadata.questionText?.trim() || '',
    userAnswer: metadata.userAnswer?.trim() || '',
    correctAnswer: metadata.correctAnswer?.trim() || '',
    image: imageRef ? getImageRefDisplaySrc(imageRef) : '',
    imageRefs: imageRef ? [imageRef] : [],
    category,
    grade: metadata.grade?.trim() || '',
    questionType: metadata.questionType?.trim() || '',
    source: metadata.source?.trim() || '',
    createdAt: timestamp,
    updatedAt: timestamp,
    contentUpdatedAt: timestamp,
    deleted: false,
    deletedAt: undefined,
    syncStatus: 'pending',
    notes: metadata.notes || '',
    notesUpdatedAt: metadata.notes?.trim() ? timestamp : undefined,
    errorCause: metadata.errorCause || '',
    tags: normalizeTags(metadata.tags),
    masteryLevel: 0,
    reviewCount: 0,
    lastReviewedAt: undefined,
    nextReviewAt: calculateNextReviewAt(timestamp, 0),
    reviewStatus: 'new',
    reviewEvents: [],
    imageRefsUpdatedAt: imageRef ? timestamp : undefined,
    imageRefsComplete: true,
    noteImagesUpdatedAt: undefined,
    noteImageRefsUpdatedAt: undefined,
    noteImageRefsComplete: true,
    reviewUpdatedAt: undefined,
    noteImages: undefined,
    noteImageRefs: [],
  };
}

export function updateQuestionById(
  questions: Question[],
  id: string,
  updates: Partial<Question>,
  options: QuestionMutationOptions = {}
): Question[] {
  return questions.map((question) =>
    question.id === id ? applyQuestionUpdates(question, updates, options) : question
  );
}

export function updateQuestionTitleById(
  questions: Question[],
  id: string,
  title: string,
  options: QuestionMutationOptions = {}
): Question[] {
  return updateQuestionById(questions, id, { title: title.trim() }, options);
}

export function updateQuestionNotesById(
  questions: Question[],
  id: string,
  notes: string,
  options: QuestionMutationOptions = {}
): Question[] {
  return updateQuestionById(questions, id, { notes }, options);
}

export function replaceQuestionNoteImagesById(
  questions: Question[],
  id: string,
  noteImageRefs: ImageRef[],
  options: QuestionMutationOptions = {}
): Question[] {
  return updateQuestionById(questions, id, { noteImageRefs }, options);
}

export function removeQuestionNoteImageById(
  questions: Question[],
  id: string,
  noteImageId: string,
  options: QuestionMutationOptions = {}
): Question[] {
  return questions.map((question) => {
    if (question.id !== id) {
      return question;
    }

    return applyQuestionUpdates(
      question,
      {
        noteImageRefs: question.noteImageRefs.filter((ref) => ref.id !== noteImageId),
      },
      options
    );
  });
}

export function replaceQuestionFollowUpChatsById(
  questions: Question[],
  id: string,
  followUpChats: FollowUpMessage[],
  options: QuestionMutationOptions = {}
): Question[] {
  return updateQuestionById(questions, id, { followUpChats }, options);
}

export function deleteQuestionById(
  questions: Question[],
  id: string,
  options: QuestionMutationOptions = {}
): Question[] {
  const requestedTimestamp = options.now || new Date().toISOString();
  return questions.map((question) => {
    if (question.id !== id) {
      return question;
    }
    const timestamp = getTimestampAfter(requestedTimestamp, question.restoredAt);
    return applyQuestionUpdates(
      question,
      { deleted: true, deletedAt: timestamp },
      { now: timestamp }
    );
  });
}

export function restoreQuestionById(
  questions: Question[],
  id: string,
  options: QuestionMutationOptions = {}
): Question[] {
  const requestedTimestamp = options.now || new Date().toISOString();
  return questions.map((question) => {
    if (question.id !== id || !question.deleted) {
      return question;
    }
    const timestamp = getTimestampAfter(requestedTimestamp, question.deletedAt);
    return applyQuestionUpdates(
      question,
      { deleted: false, restoredAt: timestamp },
      { now: timestamp }
    );
  });
}

export function findQuestionById(
  questions: Question[],
  id: string
): Question | undefined {
  return questions.find((question) => question.id === id);
}

export function getVisibleStats(
  questions: Question[],
  now: string = new Date().toISOString()
) {
  const analyzedCount = questions.filter((question) => question.analysis).length;
  const reviewedCount = questions.filter((question) => question.reviewCount > 0).length;
  const noteCount = questions.filter(
    (question) => question.notes.trim() || question.noteImageRefs.length > 0
  ).length;
  const dueReviewCount = questions.filter((question) =>
    isQuestionDueForReview(question, now)
  ).length;
  const weakCount = questions.filter((question) => question.masteryLevel <= 2).length;
  const pendingAnalysisCount = questions.filter((question) => !question.analysis).length;
  const staleAiCount = questions.filter(
    (question) => isQuestionAiContentStale(question)
  ).length;

  return {
    totalCount: questions.length,
    analyzedCount,
    reviewedCount,
    noteCount,
    dueReviewCount,
    weakCount,
    pendingAnalysisCount,
    staleAiCount,
  };
}

export function isQuestionAiContentStale(question: Question): boolean {
  return (
    (Boolean(question.analysis) &&
      question.analysisContentUpdatedAt !== question.contentUpdatedAt) ||
    (Boolean(question.detailedExplanation?.trim()) &&
      question.explanationContentUpdatedAt !== question.contentUpdatedAt) ||
    (Boolean(question.hint?.trim()) &&
      question.hintContentUpdatedAt !== question.contentUpdatedAt) ||
    (Boolean(question.followUpChats?.length) &&
      question.followUpContentUpdatedAt !== question.contentUpdatedAt)
  );
}

export function applyQuestionUpdates(
  question: Question,
  updates: Partial<Question>,
  options: QuestionMutationOptions = {}
): Question {
  const timestamp = options.now || new Date().toISOString();
  const nextImageRefs = resolveImageRefs(question, updates, timestamp);
  const nextNoteImageRefs = resolveNoteImageRefs(question, updates, timestamp);
  const nextImage =
    Array.isArray(updates.imageRefs) && updates.imageRefs.length === 0
      ? ''
      : resolveNextImage(nextImageRefs, updates.image, question.image);
  const coreContentChanged = hasCoreContentChanges(question, updates, nextImageRefs, nextImage);
  const notesChanged = hasNotesChanges(question, updates);
  const noteImagesChanged = !areImageRefsEqual(nextNoteImageRefs, question.noteImageRefs);
  const reviewChanged = hasReviewChanges(question, updates);

  return {
    ...question,
    ...updates,
    image: nextImage,
    imageRefs: nextImageRefs,
    updatedAt: timestamp,
    contentUpdatedAt: coreContentChanged ? timestamp : question.contentUpdatedAt,
    syncStatus: nextSyncStatusForMutation(question.syncStatus, updates.syncStatus),
    notesUpdatedAt:
      typeof updates.notesUpdatedAt === 'string'
        ? updates.notesUpdatedAt
        : notesChanged
          ? timestamp
          : question.notesUpdatedAt,
    noteImagesUpdatedAt:
      typeof updates.noteImagesUpdatedAt === 'string'
        ? updates.noteImagesUpdatedAt
        : noteImagesChanged
          ? timestamp
          : question.noteImagesUpdatedAt,
    imageRefsUpdatedAt:
      typeof updates.imageRefsUpdatedAt === 'string'
        ? updates.imageRefsUpdatedAt
        : coreContentChanged && !areImageRefsEqual(nextImageRefs, question.imageRefs)
          ? timestamp
          : question.imageRefsUpdatedAt,
    imageRefsComplete:
      updates.imageRefsComplete ??
      (Array.isArray(updates.imageRefs) ? true : question.imageRefsComplete),
    noteImageRefsUpdatedAt:
      typeof updates.noteImageRefsUpdatedAt === 'string'
        ? updates.noteImageRefsUpdatedAt
        : noteImagesChanged
          ? timestamp
          : question.noteImageRefsUpdatedAt,
    noteImageRefsComplete:
      updates.noteImageRefsComplete ??
      (Array.isArray(updates.noteImageRefs) || Array.isArray(updates.noteImages)
        ? true
        : question.noteImageRefsComplete),
    reviewUpdatedAt:
      typeof updates.reviewUpdatedAt === 'string'
        ? updates.reviewUpdatedAt
        : reviewChanged
          ? timestamp
          : question.reviewUpdatedAt,
    noteImages:
      nextNoteImageRefs.length > 0
        ? nextNoteImageRefs.map((imageRef) => getImageRefDisplaySrc(imageRef))
        : undefined,
    noteImageRefs: nextNoteImageRefs,
  };
}

function resolveImageRefs(
  question: Question,
  updates: Partial<Question>,
  timestamp: string
): ImageRef[] {
  if (Array.isArray(updates.imageRefs)) {
    return updates.imageRefs;
  }

  if (typeof updates.image === 'string' && updates.image) {
    return [resolveImageInput(updates.image, 'question', timestamp)];
  }

  return question.imageRefs;
}

function resolveNoteImageRefs(
  question: Question,
  updates: Partial<Question>,
  timestamp: string
): ImageRef[] {
  if (Array.isArray(updates.noteImageRefs)) {
    return updates.noteImageRefs;
  }

  if (Array.isArray(updates.noteImages)) {
    return updates.noteImages
      .filter((source) => typeof source === 'string' && source)
      .map((source) => resolveImageInput(source, 'note', timestamp));
  }

  return question.noteImageRefs;
}

function resolveImageInput(
  image: QuestionImageInput,
  kind: ImageRef['kind'],
  timestamp: string
): ImageRef {
  if (typeof image === 'string') {
    if (/^file:\/\//i.test(image)) {
      return createFileImageRef(image, kind, timestamp);
    }

    return createInlineImageRef(image, kind, timestamp);
  }

  return image.kind === kind ? image : { ...image, kind };
}

function resolveNextImage(
  imageRefs: ImageRef[],
  nextLegacyImage: string | undefined,
  currentLegacyImage: string
): string {
  if (typeof nextLegacyImage === 'string' && nextLegacyImage) {
    return nextLegacyImage;
  }

  return imageRefs[0] ? getImageRefDisplaySrc(imageRefs[0]) : currentLegacyImage;
}

function nextSyncStatusForMutation(
  currentStatus: QuestionSyncStatus,
  override?: QuestionSyncStatus
): QuestionSyncStatus {
  if (override) {
    return override;
  }

  return resolveNextSyncStatus(currentStatus);
}

function hasNotesChanges(question: Question, updates: Partial<Question>): boolean {
  const nextNotes = typeof updates.notes === 'string' ? updates.notes : question.notes;
  return nextNotes !== question.notes;
}

function hasReviewChanges(question: Question, updates: Partial<Question>): boolean {
  const nextMasteryLevel =
    typeof updates.masteryLevel === 'number' ? updates.masteryLevel : question.masteryLevel;
  const nextReviewCount =
    typeof updates.reviewCount === 'number' ? updates.reviewCount : question.reviewCount;
  const nextLastReviewedAt =
    typeof updates.lastReviewedAt === 'string'
      ? updates.lastReviewedAt
      : question.lastReviewedAt;
  const nextNextReviewAt =
    typeof updates.nextReviewAt === 'string' ? updates.nextReviewAt : question.nextReviewAt;
  const nextReviewStatus = updates.reviewStatus ?? question.reviewStatus;

  return (
    nextMasteryLevel !== question.masteryLevel ||
    nextReviewCount !== question.reviewCount ||
    nextLastReviewedAt !== question.lastReviewedAt ||
    nextNextReviewAt !== question.nextReviewAt ||
    nextReviewStatus !== question.reviewStatus
  );
}

function hasCoreContentChanges(
  question: Question,
  updates: Partial<Question>,
  nextImageRefs: ImageRef[],
  nextImage: string
): boolean {
  const nextTitle =
    typeof updates.title === 'string' ? updates.title : question.title;
  const nextQuestionText =
    typeof updates.questionText === 'string'
      ? updates.questionText
      : question.questionText;
  const nextUserAnswer =
    typeof updates.userAnswer === 'string' ? updates.userAnswer : question.userAnswer;
  const nextCorrectAnswer =
    typeof updates.correctAnswer === 'string'
      ? updates.correctAnswer
      : question.correctAnswer;
  const nextCategory = updates.category ?? question.category;
  const nextGrade = typeof updates.grade === 'string' ? updates.grade : question.grade;
  const nextQuestionType =
    typeof updates.questionType === 'string'
      ? updates.questionType
      : question.questionType;
  const nextSource = typeof updates.source === 'string' ? updates.source : question.source;
  const nextErrorCause =
    typeof updates.errorCause === 'string' ? updates.errorCause : question.errorCause;
  const nextTags = Array.isArray(updates.tags) ? updates.tags : question.tags;

  return (
    nextTitle !== question.title ||
    nextQuestionText !== question.questionText ||
    nextUserAnswer !== question.userAnswer ||
    nextCorrectAnswer !== question.correctAnswer ||
    nextImage !== question.image ||
    !areImageRefsEqual(nextImageRefs, question.imageRefs) ||
    nextCategory !== question.category ||
    nextGrade !== question.grade ||
    nextQuestionType !== question.questionType ||
    nextSource !== question.source ||
    nextErrorCause !== question.errorCause ||
    !areStringArraysEqual(nextTags, question.tags)
  );
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length && left.every((value, index) => value === right[index])
  );
}

function areImageRefsEqual(left: ImageRef[], right: ImageRef[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((ref, index) => isImageRefEqual(ref, right[index]));
}

function isImageRefEqual(left: ImageRef, right: ImageRef): boolean {
  if (left.storage !== right.storage) {
    return false;
  }

  return (
    left.id === right.id &&
    left.kind === right.kind &&
    left.createdAt === right.createdAt &&
    left.mimeType === right.mimeType &&
    left.contentHash === right.contentHash &&
    left.status === right.status &&
    left.uri === right.uri &&
    left.dataUrl === right.dataUrl
  );
}

function createQuestionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }

  return tags
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag, index, all) => all.indexOf(tag) === index);
}

function getTimestampAfter(candidate: string, floor?: string): string {
  const candidateMs = new Date(candidate).getTime();
  const floorMs = typeof floor === 'string' ? new Date(floor).getTime() : Number.NaN;
  const safeCandidateMs = Number.isFinite(candidateMs) ? candidateMs : Date.now();
  return new Date(
    Number.isFinite(floorMs) ? Math.max(safeCandidateMs, floorMs + 1) : safeCandidateMs
  ).toISOString();
}
