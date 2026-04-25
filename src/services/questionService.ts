import { Subject } from '../constants/subjects';
import { FollowUpMessage, ImageRef, Question, QuestionSyncStatus } from '../types/question';
import {
  createFileImageRef,
  createInlineImageRef,
  getImageRefDisplaySrc,
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
  const imageRef = resolveImageInput(image, 'question', timestamp);

  return {
    id: createQuestionId(),
    title: title.trim(),
    questionText: metadata.questionText?.trim() || '',
    userAnswer: metadata.userAnswer?.trim() || '',
    correctAnswer: metadata.correctAnswer?.trim() || '',
    image: getImageRefDisplaySrc(imageRef),
    imageRefs: [imageRef],
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
    errorCause: metadata.errorCause || '',
    tags: normalizeTags(metadata.tags),
    masteryLevel: 0,
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

export function deleteQuestionById(
  questions: Question[],
  id: string
): Question[] {
  const timestamp = new Date().toISOString();

  return questions.map((question) =>
    question.id === id
      ? applyQuestionUpdates(
          question,
          {
            deleted: true,
            deletedAt: timestamp,
          },
          { now: timestamp }
        )
      : question
  );
}

export function findQuestionById(
  questions: Question[],
  id: string
): Question | undefined {
  return questions.find((question) => question.id === id);
}

export function getVisibleStats(questions: Question[]) {
  const analyzedCount = questions.filter((question) => question.analysis).length;
  const reviewedCount = questions.filter((question) => question.reviewCount > 0).length;
  const noteCount = questions.filter(
    (question) => question.notes.trim() || question.noteImageRefs.length > 0
  ).length;

  return {
    totalCount: questions.length,
    analyzedCount,
    reviewedCount,
    noteCount,
  };
}

export function applyQuestionUpdates(
  question: Question,
  updates: Partial<Question>,
  options: QuestionMutationOptions = {}
): Question {
  const timestamp = options.now || new Date().toISOString();
  const nextImageRefs = resolveImageRefs(question, updates, timestamp);
  const nextNoteImageRefs = resolveNoteImageRefs(question, updates, timestamp);
  const nextImage = resolveNextImage(nextImageRefs, updates.image, question.image);
  const coreContentChanged = hasCoreContentChanges(question, updates, nextImageRefs, nextImage);

  return {
    ...question,
    ...updates,
    image: nextImage,
    imageRefs: nextImageRefs,
    updatedAt: timestamp,
    contentUpdatedAt: coreContentChanged ? timestamp : question.contentUpdatedAt,
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

  return left.every((ref, index) => JSON.stringify(ref) === JSON.stringify(right[index]));
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
