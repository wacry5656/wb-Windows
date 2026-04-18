import { Subject } from '../constants/subjects';
import { FollowUpMessage, ImageRef, Question, QuestionSyncStatus } from '../types/question';
import {
  createFileImageRef,
  createInlineImageRef,
  getImageRefDisplaySrc,
  isActiveQuestion,
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
  options: QuestionMutationOptions = {}
): Question {
  const timestamp = options.now || new Date().toISOString();
  const imageRef = resolveImageInput(image, 'question', timestamp);

  return {
    id: createQuestionId(),
    title: title.trim(),
    image: getImageRefDisplaySrc(imageRef),
    imageRefs: [imageRef],
    category,
    createdAt: timestamp,
    updatedAt: timestamp,
    deleted: false,
    deletedAt: undefined,
    syncStatus: 'pending',
    notes: '',
    reviewCount: 0,
    lastReviewedAt: undefined,
    nextReviewAt: undefined,
    reviewStatus: 'new',
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

export function softDeleteQuestionById(
  questions: Question[],
  id: string,
  options: QuestionMutationOptions = {}
): Question[] {
  const timestamp = options.now || new Date().toISOString();

  return questions.map((question) => {
    if (question.id !== id || question.deleted) {
      return question;
    }

    // Soft delete keeps image refs intact so file cleanup can stay conservative.
    // Future hard-delete/archive flows should reclaim files explicitly.
    return {
      ...question,
      deleted: true,
      deletedAt: timestamp,
      updatedAt: timestamp,
      syncStatus: nextSyncStatusForMutation(question.syncStatus),
    };
  });
}

export function findQuestionById(
  questions: Question[],
  id: string,
  options: { includeDeleted?: boolean } = {}
): Question | undefined {
  return questions.find(
    (question) => question.id === id && (options.includeDeleted || isActiveQuestion(question))
  );
}

export function getVisibleStats(questions: Question[]) {
  const visibleQuestions = questions.filter(isActiveQuestion);
  const analyzedCount = visibleQuestions.filter((question) => question.analysis).length;
  const reviewedCount = visibleQuestions.reduce(
    (total, question) => total + question.reviewCount,
    0
  );

  return {
    totalCount: visibleQuestions.length,
    analyzedCount,
    reviewedCount,
  };
}

export function applyQuestionUpdates(
  question: Question,
  updates: Partial<Question>,
  options: QuestionMutationOptions = {}
): Question {
  if (question.deleted && updates.deleted !== false) {
    return question;
  }

  const timestamp = options.now || new Date().toISOString();
  const nextImageRefs = resolveImageRefs(question, updates, timestamp);
  const nextNoteImageRefs = resolveNoteImageRefs(question, updates, timestamp);
  const nextDeleted = updates.deleted ?? question.deleted;

  return {
    ...question,
    ...updates,
    image: resolveNextImage(nextImageRefs, updates.image, question.image),
    imageRefs: nextImageRefs,
    updatedAt: timestamp,
    deleted: nextDeleted,
    deletedAt: nextDeleted
      ? updates.deletedAt || question.deletedAt || timestamp
      : undefined,
    syncStatus: nextSyncStatusForMutation(question.syncStatus, updates.syncStatus),
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
  if (Array.isArray(updates.imageRefs) && updates.imageRefs.length > 0) {
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

function createQuestionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
