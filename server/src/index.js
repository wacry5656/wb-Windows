const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const express = require('express');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const PORT = Number(process.env.PORT || 3001);
const SYNC_TOKEN = (process.env.SYNC_TOKEN || '').trim();
const DATABASE_PATH = (process.env.DATABASE_PATH || './data/wrongbook.sqlite').trim();
const BODY_LIMIT = '50mb';

if (!SYNC_TOKEN) {
  throw new Error('SYNC_TOKEN is required');
}

const resolvedDatabasePath = path.resolve(__dirname, '..', DATABASE_PATH);
fs.mkdirSync(path.dirname(resolvedDatabasePath), { recursive: true });

function isoNow() {
  return new Date().toISOString();
}

function toTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return 0;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function toIso(value, fallback) {
  if (typeof value === 'string' && value.trim()) {
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) {
      return new Date(timestamp).toISOString();
    }
  }

  return fallback;
}

function laterIso(left, right) {
  return toTimestamp(right) >= toTimestamp(left) ? right : left;
}

function earlierIso(left, right) {
  return toTimestamp(left) <= toTimestamp(right) ? left : right;
}

function optionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalNullableString(value) {
  const normalized = optionalString(value);
  return normalized || undefined;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map(optionalString).filter(Boolean))];
}

function normalizeInteger(value, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

function normalizeReviewStatus(value) {
  return value === 'reviewing' ? 'reviewing' : 'new';
}

function normalizeSyncStatus(value) {
  return value === 'pending' || value === 'modified' || value === 'synced'
    ? value
    : 'pending';
}

function normalizeImageRefs(value, kind, fallbackCreatedAt, legacySources = []) {
  const refs = Array.isArray(value)
    ? value
        .map((item) => normalizeImageRef(item, kind, fallbackCreatedAt))
        .filter(Boolean)
    : [];

  if (refs.length > 0) {
    return refs;
  }

  return legacySources
    .map((source) => createImageRefFromSource(source, kind, fallbackCreatedAt))
    .filter(Boolean);
}

function normalizeImageRef(value, kind, fallbackCreatedAt) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const id = optionalString(value.id) || `img-${kind}-${Math.random().toString(16).slice(2)}`;
  const createdAt = toIso(value.createdAt, fallbackCreatedAt);
  const mimeType = optionalNullableString(value.mimeType);
  const dataUrl = optionalNullableString(value.dataUrl);
  const uri = optionalNullableString(value.uri);
  const storage = value.storage === 'inline' || dataUrl ? 'inline' : 'file';

  if (storage === 'inline') {
    const normalizedDataUrl = dataUrl || (uri && uri.startsWith('data:image/') ? uri : undefined);
    if (!normalizedDataUrl) {
      return null;
    }

    return {
      id,
      storage: 'inline',
      kind,
      createdAt,
      mimeType,
      dataUrl: normalizedDataUrl,
    };
  }

  if (!uri || uri.startsWith('file://')) {
    return null;
  }

  return {
    id,
    storage: 'file',
    kind,
    createdAt,
    mimeType,
    uri,
  };
}

function createImageRefFromSource(source, kind, createdAt) {
  if (typeof source !== 'string' || !source.trim()) {
    return null;
  }

  if (source.startsWith('data:image/')) {
    return {
      id: `img-${kind}-${Math.random().toString(16).slice(2)}`,
      storage: 'inline',
      kind,
      createdAt,
      dataUrl: source,
    };
  }

  return null;
}

function mergeImageRefs(primary, secondary) {
  const merged = new Map();
  [...primary, ...secondary].forEach((ref) => {
    if (!ref || !ref.id) {
      return;
    }

    merged.set(ref.id, ref);
  });

  return [...merged.values()];
}

function mergeStringArrays(primary, secondary) {
  return [...new Set([...primary, ...secondary].map(optionalString).filter(Boolean))];
}

function normalizeFollowUpChats(value, fallbackCreatedAt) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const role = item.role === 'assistant' ? 'assistant' : item.role === 'user' ? 'user' : null;
      const content = optionalString(item.content);
      if (!role || !content) {
        return null;
      }

      return {
        id: optionalString(item.id) || `chat-${role}-${Math.random().toString(16).slice(2)}`,
        role,
        content,
        createdAt: toIso(item.createdAt, fallbackCreatedAt),
      };
    })
    .filter(Boolean)
    .sort((left, right) => toTimestamp(left.createdAt) - toTimestamp(right.createdAt));
}

function mergeFollowUpChats(existing, incoming) {
  const merged = new Map();
  [...existing, ...incoming].forEach((chat) => {
    if (!chat || !chat.id) {
      return;
    }

    merged.set(chat.id, chat);
  });

  return [...merged.values()].sort(
    (left, right) => toTimestamp(left.createdAt) - toTimestamp(right.createdAt)
  );
}

function normalizeAnalysis(value, contentUpdatedAt) {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const knowledgePoints = normalizeStringArray(value.knowledgePoints || value.knowledge_points);
  const commonMistakes = normalizeStringArray(value.commonMistakes || value.common_mistakes);
  const solutionMethods = normalizeStringArray(
    value.solutionMethods || value.solution_methods || value.recommendedMethods || value.recommended_methods
  );
  const cautions = normalizeStringArray(value.cautions || value.notices);
  const notices = normalizeStringArray(value.notices || value.cautions);

  return {
    difficulty: optionalString(value.difficulty) || '中等',
    difficultyScore: normalizeInteger(value.difficultyScore || value.difficulty_score, 3, 1, 5),
    commonMistakes,
    knowledgePoints,
    solutionMethods,
    cautions,
    notices,
    studyAdvice:
      optionalString(value.studyAdvice) ||
      [
        knowledgePoints.length > 0 ? `重点复习：${knowledgePoints.join('、')}` : '',
        commonMistakes.length > 0 ? `易错点：${commonMistakes[0]}` : '',
        solutionMethods.length > 0 ? `推荐方法：${solutionMethods.join('、')}` : '',
      ]
        .filter(Boolean)
        .join('。'),
    updatedAt: toIso(value.updatedAt, contentUpdatedAt),
    source: value.source === 'demo' ? 'demo' : 'ai',
  };
}

function normalizeQuestionRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }

  const id = optionalString(input.id);
  if (!id) {
    return null;
  }

  const now = isoNow();
  const createdAt = toIso(input.createdAt, now);
  const updatedAt = toIso(input.updatedAt, createdAt);
  const contentUpdatedAt = toIso(input.contentUpdatedAt, updatedAt);
  const imageRefs = normalizeImageRefs(input.imageRefs, 'question', createdAt, [input.image]);
  const noteImageRefs = normalizeImageRefs(input.noteImageRefs, 'note', createdAt, input.noteImages || []);
  const analysis = normalizeAnalysis(input.analysis, contentUpdatedAt);
  const followUpChats = normalizeFollowUpChats(input.followUpChats, updatedAt);
  const detailedExplanation = optionalNullableString(input.detailedExplanation);
  const hint = optionalNullableString(input.hint);
  const notes = optionalString(input.notes);
  const notesUpdatedAt =
    toIso(input.notesUpdatedAt, '') || (notes ? updatedAt : undefined);
  const noteImagesUpdatedAt =
    toIso(input.noteImagesUpdatedAt, '') || (noteImageRefs.length > 0 ? updatedAt : undefined);
  const reviewCount = normalizeInteger(input.reviewCount, 0, 0);
  const lastReviewedAt = optionalNullableString(toIso(input.lastReviewedAt, ''));
  const reviewUpdatedAt =
    toIso(input.reviewUpdatedAt, '') ||
    ((reviewCount > 0 || lastReviewedAt) ? lastReviewedAt || updatedAt : undefined);

  return {
    id,
    title: optionalString(input.title) || '未命名错题',
    questionText: optionalString(input.questionText),
    userAnswer: optionalString(input.userAnswer),
    correctAnswer: optionalString(input.correctAnswer),
    image: imageRefs[0]?.dataUrl || imageRefs[0]?.uri || '',
    imageRefs,
    category: optionalString(input.category),
    grade: optionalString(input.grade),
    questionType: optionalString(input.questionType),
    source: optionalString(input.source),
    createdAt,
    updatedAt,
    contentUpdatedAt,
    deleted: input.deleted === true,
    deletedAt:
      input.deleted === true ? toIso(input.deletedAt, updatedAt) : undefined,
    syncStatus: normalizeSyncStatus(input.syncStatus),
    notes,
    notesUpdatedAt,
    errorCause: optionalString(input.errorCause),
    tags: normalizeStringArray(input.tags),
    masteryLevel: normalizeInteger(input.masteryLevel, 0, 0, 5),
    reviewCount,
    lastReviewedAt,
    nextReviewAt: optionalNullableString(toIso(input.nextReviewAt, '')),
    reviewStatus: normalizeReviewStatus(input.reviewStatus),
    noteImagesUpdatedAt,
    reviewUpdatedAt,
    analysis,
    analysisContentUpdatedAt: analysis
      ? toIso(input.analysisContentUpdatedAt, analysis.updatedAt || contentUpdatedAt)
      : undefined,
    detailedExplanation,
    detailedExplanationUpdatedAt: detailedExplanation
      ? toIso(input.detailedExplanationUpdatedAt, contentUpdatedAt)
      : undefined,
    explanationContentUpdatedAt: detailedExplanation
      ? toIso(input.explanationContentUpdatedAt, input.detailedExplanationUpdatedAt || contentUpdatedAt)
      : undefined,
    hint,
    hintUpdatedAt: hint ? toIso(input.hintUpdatedAt, contentUpdatedAt) : undefined,
    hintContentUpdatedAt: hint
      ? toIso(input.hintContentUpdatedAt, input.hintUpdatedAt || contentUpdatedAt)
      : undefined,
    followUpChats,
    followUpContentUpdatedAt:
      followUpChats.length > 0
        ? toIso(input.followUpContentUpdatedAt, followUpChats[followUpChats.length - 1].createdAt)
        : undefined,
    noteImages: noteImageRefs
      .map((ref) => ref.dataUrl || ref.uri || '')
      .filter(Boolean),
    noteImageRefs,
  };
}

function setSynced(question) {
  return {
    ...question,
    image: question.imageRefs[0]?.dataUrl || question.imageRefs[0]?.uri || '',
    noteImages: question.noteImageRefs
      .map((ref) => ref.dataUrl || ref.uri || '')
      .filter(Boolean),
    syncStatus: 'synced',
  };
}

function mergeQuestion(existing, incoming) {
  const existingContentTs = toTimestamp(existing.contentUpdatedAt || existing.updatedAt);
  const incomingContentTs = toTimestamp(incoming.contentUpdatedAt || incoming.updatedAt);
  const existingUpdatedTs = toTimestamp(existing.updatedAt);
  const incomingUpdatedTs = toTimestamp(incoming.updatedAt);
  const existingNotesTs = toTimestamp(existing.notesUpdatedAt || existing.updatedAt);
  const incomingNotesTs = toTimestamp(incoming.notesUpdatedAt || incoming.updatedAt);
  const existingNoteImagesTs = toTimestamp(existing.noteImagesUpdatedAt || existing.updatedAt);
  const incomingNoteImagesTs = toTimestamp(incoming.noteImagesUpdatedAt || incoming.updatedAt);
  const existingReviewTs = toTimestamp(existing.reviewUpdatedAt || existing.lastReviewedAt || existing.updatedAt);
  const incomingReviewTs = toTimestamp(incoming.reviewUpdatedAt || incoming.lastReviewedAt || incoming.updatedAt);
  const useIncomingCore = incomingContentTs >= existingContentTs;
  const useIncomingNotes = incomingNotesTs >= existingNotesTs;
  const useIncomingNoteImages = incomingNoteImagesTs >= existingNoteImagesTs;
  const useIncomingReview = incomingReviewTs >= existingReviewTs;

  const merged = {
    id: existing.id,
    title: useIncomingCore ? incoming.title : existing.title,
    questionText: useIncomingCore ? incoming.questionText : existing.questionText,
    userAnswer: useIncomingCore ? incoming.userAnswer : existing.userAnswer,
    correctAnswer: useIncomingCore ? incoming.correctAnswer : existing.correctAnswer,
    imageRefs: useIncomingCore ? incoming.imageRefs : existing.imageRefs,
    category: useIncomingCore ? incoming.category : existing.category,
    grade: useIncomingCore ? incoming.grade : existing.grade,
    questionType: useIncomingCore ? incoming.questionType : existing.questionType,
    source: useIncomingCore ? incoming.source : existing.source,
    createdAt: earlierIso(existing.createdAt, incoming.createdAt),
    updatedAt: laterIso(existing.updatedAt, incoming.updatedAt),
    contentUpdatedAt: laterIso(existing.contentUpdatedAt, incoming.contentUpdatedAt),
    deleted: false,
    deletedAt: undefined,
    syncStatus: 'synced',
    notes: useIncomingNotes ? incoming.notes : existing.notes,
    notesUpdatedAt: laterIso(existing.notesUpdatedAt || '', incoming.notesUpdatedAt || '') || undefined,
    errorCause: useIncomingCore ? incoming.errorCause : existing.errorCause,
    tags: useIncomingCore ? incoming.tags : existing.tags,
    masteryLevel: useIncomingReview ? incoming.masteryLevel : existing.masteryLevel,
    reviewCount: Math.max(existing.reviewCount, incoming.reviewCount),
    lastReviewedAt: laterIso(existing.lastReviewedAt || '', incoming.lastReviewedAt || '') || undefined,
    nextReviewAt: useIncomingReview ? incoming.nextReviewAt : existing.nextReviewAt,
    reviewStatus: useIncomingReview ? incoming.reviewStatus : existing.reviewStatus,
    noteImagesUpdatedAt:
      laterIso(existing.noteImagesUpdatedAt || '', incoming.noteImagesUpdatedAt || '') || undefined,
    reviewUpdatedAt:
      laterIso(existing.reviewUpdatedAt || '', incoming.reviewUpdatedAt || '') || undefined,
    analysis: existing.analysis,
    analysisContentUpdatedAt: existing.analysisContentUpdatedAt,
    detailedExplanation: existing.detailedExplanation,
    detailedExplanationUpdatedAt: existing.detailedExplanationUpdatedAt,
    explanationContentUpdatedAt: existing.explanationContentUpdatedAt,
    hint: existing.hint,
    hintUpdatedAt: existing.hintUpdatedAt,
    hintContentUpdatedAt: existing.hintContentUpdatedAt,
    followUpChats: mergeFollowUpChats(existing.followUpChats, incoming.followUpChats),
    followUpContentUpdatedAt: laterIso(
      existing.followUpContentUpdatedAt || '',
      incoming.followUpContentUpdatedAt || ''
    ) || undefined,
    noteImageRefs: useIncomingNoteImages ? incoming.noteImageRefs : existing.noteImageRefs,
  };

  const existingAnalysisBasis = existing.analysisContentUpdatedAt || existing.analysis?.updatedAt || '';
  const incomingAnalysisBasis = incoming.analysisContentUpdatedAt || incoming.analysis?.updatedAt || '';
  if (toTimestamp(incomingAnalysisBasis) >= toTimestamp(existingAnalysisBasis)) {
    merged.analysis = incoming.analysis;
    merged.analysisContentUpdatedAt = incoming.analysisContentUpdatedAt;
  }

  const existingExplanationBasis =
    existing.explanationContentUpdatedAt || existing.detailedExplanationUpdatedAt || '';
  const incomingExplanationBasis =
    incoming.explanationContentUpdatedAt || incoming.detailedExplanationUpdatedAt || '';
  if (toTimestamp(incomingExplanationBasis) >= toTimestamp(existingExplanationBasis)) {
    merged.detailedExplanation = incoming.detailedExplanation;
    merged.detailedExplanationUpdatedAt = incoming.detailedExplanationUpdatedAt;
    merged.explanationContentUpdatedAt = incoming.explanationContentUpdatedAt;
  }

  const existingHintBasis = existing.hintContentUpdatedAt || existing.hintUpdatedAt || '';
  const incomingHintBasis = incoming.hintContentUpdatedAt || incoming.hintUpdatedAt || '';
  if (toTimestamp(incomingHintBasis) >= toTimestamp(existingHintBasis)) {
    merged.hint = incoming.hint;
    merged.hintUpdatedAt = incoming.hintUpdatedAt;
    merged.hintContentUpdatedAt = incoming.hintContentUpdatedAt;
  }

  const incomingDeletedTs = incoming.deleted ? toTimestamp(incoming.deletedAt || incoming.updatedAt) : 0;
  const existingDeletedTs = existing.deleted ? toTimestamp(existing.deletedAt || existing.updatedAt) : 0;
  if (incomingDeletedTs >= existingUpdatedTs && incomingDeletedTs >= existingDeletedTs) {
    merged.deleted = true;
    merged.deletedAt = incoming.deletedAt || incoming.updatedAt;
  } else if (existingDeletedTs >= incomingUpdatedTs && existingDeletedTs > 0) {
    merged.deleted = true;
    merged.deletedAt = existing.deletedAt || existing.updatedAt;
  }

  return setSynced({
    ...merged,
    image: merged.imageRefs[0]?.dataUrl || merged.imageRefs[0]?.uri || '',
    noteImages: merged.noteImageRefs
      .map((ref) => ref.dataUrl || ref.uri || '')
      .filter(Boolean),
  });
}

function createDatabase() {
  const db = new Database(resolvedDatabasePath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      contentUpdatedAt TEXT,
      deleted INTEGER NOT NULL DEFAULT 0,
      deletedAt TEXT,
      lastSyncedAt TEXT
    );
  `);

  return db;
}

function loadQuestion(db, id) {
  const row = db.prepare('SELECT payload FROM questions WHERE id = ?').get(id);
  if (!row) {
    return null;
  }

  return normalizeQuestionRecord(JSON.parse(row.payload));
}

function saveQuestion(db, question, serverTime) {
  const payload = JSON.stringify(setSynced(question));
  db.prepare(
    `
      INSERT INTO questions (id, payload, updatedAt, contentUpdatedAt, deleted, deletedAt, lastSyncedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        payload = excluded.payload,
        updatedAt = excluded.updatedAt,
        contentUpdatedAt = excluded.contentUpdatedAt,
        deleted = excluded.deleted,
        deletedAt = excluded.deletedAt,
        lastSyncedAt = excluded.lastSyncedAt
    `,
  ).run(
    question.id,
    payload,
    question.updatedAt,
    question.contentUpdatedAt,
    question.deleted ? 1 : 0,
    question.deletedAt || null,
    serverTime
  );
}

function loadAllQuestions(db) {
  const rows = db.prepare('SELECT payload FROM questions ORDER BY updatedAt DESC').all();
  return rows
    .map((row) => {
      try {
        return normalizeQuestionRecord(JSON.parse(row.payload));
      } catch (_error) {
        return null;
      }
    })
    .filter(Boolean)
    .map(setSynced);
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const expected = `Bearer ${SYNC_TOKEN}`;

  if (authHeader !== expected) {
    return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  }

  return next();
}

async function startServer() {
  const db = createDatabase();
  const app = express();

  app.use(express.json({ limit: BODY_LIMIT }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, serverTime: isoNow() });
  });

  app.post('/api/sync/questions', authMiddleware, async (req, res) => {
    const { records } = req.body || {};
    if (!Array.isArray(records)) {
      return res.status(400).json({ ok: false, error: 'INVALID_RECORDS' });
    }

    const serverTime = isoNow();

    try {
      db.exec('BEGIN');
      for (const record of records) {
        const normalized = normalizeQuestionRecord(record);
        if (!normalized) {
          continue;
        }

        const existing = loadQuestion(db, normalized.id);
        const merged = existing ? mergeQuestion(existing, normalized) : setSynced(normalized);
        saveQuestion(db, merged, serverTime);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      return res.status(500).json({ ok: false, error: 'SYNC_FAILED', message: error.message });
    }

    const allQuestions = loadAllQuestions(db);
    return res.json({ ok: true, serverTime, records: allQuestions });
  });

  app.listen(PORT, () => {
    console.log(`WrongBook sync server listening on ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error(error);
  process.exit(1);
});