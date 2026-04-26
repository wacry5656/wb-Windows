const crypto = require('crypto');
const http = require('http');
require('dotenv').config();
const { Pool } = require('pg');

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS question_records (
  id TEXT PRIMARY KEY,
  updated_at_ms BIGINT NOT NULL DEFAULT 0,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSONB NOT NULL,
  source_device TEXT NOT NULL DEFAULT 'unknown-device',
  server_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_question_records_updated_at_ms
ON question_records(updated_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_question_records_deleted
ON question_records(deleted);
`;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 50 * 1024 * 1024) {
        reject(new Error('REQUEST_TOO_LARGE'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function requireAuth(req, res, syncToken) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || token !== syncToken) {
    sendJson(res, 401, { error: 'UNAUTHORIZED' });
    return false;
  }
  return true;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }

  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && /^\d+$/.test(value.trim())) {
      return Math.max(0, Math.floor(numeric));
    }

    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }

  return 0;
}

function toIso(value) {
  const millis = toMillis(value);
  return millis > 0 ? new Date(millis).toISOString() : undefined;
}

function getTime(payload, fields) {
  for (const field of fields) {
    const value = field.includes('.')
      ? field.split('.').reduce((current, key) => current?.[key], payload)
      : payload?.[field];
    const millis = toMillis(value);
    if (millis > 0) {
      return millis;
    }
  }
  return 0;
}

function maxTime(...values) {
  return Math.max(0, ...values.map(toMillis));
}

function copyFields(target, source, fields) {
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      target[field] = source[field];
    }
  }
}

function chooseByTime(existing, incoming, fields, timeFields) {
  const existingTime = getTime(existing, timeFields);
  const incomingTime = getTime(incoming, timeFields);
  const source = incomingTime >= existingTime ? incoming : existing;
  copyFields(fields.target, source, fields.names);
  return Math.max(existingTime, incomingTime);
}

function getDisplayImage(ref) {
  if (!isPlainObject(ref)) {
    return '';
  }
  if (typeof ref.uri === 'string' && ref.uri) {
    return ref.uri;
  }
  if (typeof ref.dataUrl === 'string' && ref.dataUrl) {
    return ref.dataUrl;
  }
  return '';
}

function keepLegacyImageFieldsAligned(payload) {
  if (Array.isArray(payload.imageRefs) && payload.imageRefs.length > 0) {
    const image = getDisplayImage(payload.imageRefs[0]);
    if (image) {
      payload.image = image;
    }
  }

  if (Array.isArray(payload.noteImageRefs) && payload.noteImageRefs.length > 0) {
    payload.noteImages = payload.noteImageRefs
      .map(getDisplayImage)
      .filter(Boolean);
  }
}

function normalizeRecord(record) {
  if (!isPlainObject(record)) {
    return null;
  }

  const rawPayload = isPlainObject(record.payload) ? record.payload : record;
  const id =
    typeof record.id === 'string' && record.id.trim()
      ? record.id.trim()
      : typeof rawPayload.id === 'string' && rawPayload.id.trim()
        ? rawPayload.id.trim()
        : '';

  if (!id) {
    return null;
  }

  const payload = {
    ...rawPayload,
    id,
    deleted: record.deleted === true || rawPayload.deleted === true,
  };

  if (
    !Object.prototype.hasOwnProperty.call(payload, 'deletedAt') &&
    Object.prototype.hasOwnProperty.call(record, 'deletedAt')
  ) {
    payload.deletedAt = record.deletedAt;
  }

  keepLegacyImageFieldsAligned(payload);

  return {
    id,
    payload,
  };
}

function computeRecordUpdatedAtMs(payload) {
  const times = [
    payload?.updatedAt,
    payload?.contentUpdatedAt,
    payload?.notesUpdatedAt,
    payload?.noteImagesUpdatedAt,
    payload?.reviewUpdatedAt,
    payload?.lastReviewedAt,
    payload?.analysisContentUpdatedAt,
    payload?.analysis?.updatedAt,
    payload?.detailedExplanationUpdatedAt,
    payload?.explanationContentUpdatedAt,
    payload?.hintUpdatedAt,
    payload?.hintContentUpdatedAt,
    payload?.followUpContentUpdatedAt,
    payload?.deletedAt,
    payload?.createdAt,
  ];

  if (Array.isArray(payload?.followUpChats)) {
    for (const chat of payload.followUpChats) {
      times.push(chat?.createdAt);
    }
  }

  return Math.max(0, ...times.map(toMillis));
}

function getEarlierTime(left, right) {
  const leftMs = toMillis(left);
  const rightMs = toMillis(right);
  if (leftMs > 0 && rightMs > 0) {
    return leftMs <= rightMs ? left : right;
  }
  return leftMs > 0 ? left : right;
}

function normalizeReviewMerge(merged, existing, incoming) {
  const existingReviewTime = getTime(existing, [
    'reviewUpdatedAt',
    'lastReviewedAt',
    'updatedAt',
  ]);
  const incomingReviewTime = getTime(incoming, [
    'reviewUpdatedAt',
    'lastReviewedAt',
    'updatedAt',
  ]);
  const source = incomingReviewTime >= existingReviewTime ? incoming : existing;

  merged.reviewCount = Math.max(
    Number.isFinite(Number(existing.reviewCount)) ? Number(existing.reviewCount) : 0,
    Number.isFinite(Number(incoming.reviewCount)) ? Number(incoming.reviewCount) : 0
  );

  const latestLastReviewedAt = maxTime(
    existing.lastReviewedAt,
    incoming.lastReviewedAt
  );
  if (latestLastReviewedAt > 0) {
    merged.lastReviewedAt = new Date(latestLastReviewedAt).toISOString();
  }

  copyFields(merged, source, ['masteryLevel', 'nextReviewAt', 'reviewStatus']);

  const latestReviewUpdatedAt = Math.max(existingReviewTime, incomingReviewTime);
  if (latestReviewUpdatedAt > 0) {
    merged.reviewUpdatedAt = new Date(latestReviewUpdatedAt).toISOString();
  }
}

function stableFollowUpId(chat, index, origin) {
  if (typeof chat.id === 'string' && chat.id.trim()) {
    return chat.id.trim();
  }

  const fingerprint = JSON.stringify({
    role: chat.role || '',
    content: chat.content || '',
    createdAt: chat.createdAt || '',
    index,
    origin,
  });

  return `legacy-chat-${crypto
    .createHash('sha1')
    .update(fingerprint)
    .digest('hex')
    .slice(0, 16)}`;
}

function normalizeFollowUpChats(value, origin) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isPlainObject)
    .map((chat, index) => ({
      ...chat,
      id: stableFollowUpId(chat, index, origin),
    }));
}

function mergeFollowUps(merged, existing, incoming) {
  const byId = new Map();
  const chats = [
    ...normalizeFollowUpChats(existing.followUpChats, 'existing'),
    ...normalizeFollowUpChats(incoming.followUpChats, 'incoming'),
  ];

  for (const chat of chats) {
    const previous = byId.get(chat.id);
    if (!previous || toMillis(chat.createdAt) >= toMillis(previous.createdAt)) {
      byId.set(chat.id, chat);
    }
  }

  const mergedChats = [...byId.values()].sort((left, right) => {
    const diff = toMillis(left.createdAt) - toMillis(right.createdAt);
    return diff === 0 ? String(left.id).localeCompare(String(right.id)) : diff;
  });

  if (mergedChats.length > 0) {
    merged.followUpChats = mergedChats;
  } else {
    delete merged.followUpChats;
  }

  const latestFollowUpTime = maxTime(
    existing.followUpContentUpdatedAt,
    incoming.followUpContentUpdatedAt,
    ...mergedChats.map((chat) => chat.createdAt)
  );
  if (latestFollowUpTime > 0) {
    merged.followUpContentUpdatedAt = new Date(latestFollowUpTime).toISOString();
  }
}

function mergeDeletion(merged, existing, incoming) {
  if (existing.deleted === true || incoming.deleted === true) {
    const existingDeleteTime =
      existing.deleted === true ? maxTime(existing.deletedAt, existing.updatedAt) : 0;
    const incomingDeleteTime =
      incoming.deleted === true ? maxTime(incoming.deletedAt, incoming.updatedAt) : 0;
    const deletedAtMs = Math.max(existingDeleteTime, incomingDeleteTime);

    merged.deleted = true;
    if (deletedAtMs > 0) {
      merged.deletedAt = new Date(deletedAtMs).toISOString();
    } else {
      delete merged.deletedAt;
    }
    return;
  }

  merged.deleted = false;
  delete merged.deletedAt;
}

function ensureUpdatedAt(payload) {
  if (toMillis(payload.updatedAt) > 0) {
    return;
  }

  const fallback = computeRecordUpdatedAtMs(payload);
  if (fallback > 0) {
    payload.updatedAt = new Date(fallback).toISOString();
  }
}

function finalizeMergedPayload(payload) {
  keepLegacyImageFieldsAligned(payload);
  ensureUpdatedAt(payload);

  payload.syncStatus = 'synced';
  return payload;
}

function mergeQuestionPayload(existingPayload, incomingPayload) {
  const existing = isPlainObject(existingPayload) ? existingPayload : {};
  const incoming = isPlainObject(incomingPayload) ? incomingPayload : {};
  const merged = {
    ...existing,
    ...incoming,
  };

  merged.id = typeof existing.id === 'string' && existing.id ? existing.id : incoming.id;

  const createdAt = getEarlierTime(existing.createdAt, incoming.createdAt);
  if (createdAt) {
    merged.createdAt = toIso(createdAt) || createdAt;
  }

  chooseByTime(
    existing,
    incoming,
    {
      target: merged,
      names: [
        'title',
        'questionText',
        'userAnswer',
        'correctAnswer',
        'image',
        'imageRefs',
        'category',
        'grade',
        'questionType',
        'source',
        'errorCause',
        'tags',
        'contentUpdatedAt',
      ],
    },
    ['contentUpdatedAt', 'updatedAt']
  );

  chooseByTime(
    existing,
    incoming,
    {
      target: merged,
      names: ['notes', 'notesUpdatedAt'],
    },
    ['notesUpdatedAt', 'updatedAt']
  );

  chooseByTime(
    existing,
    incoming,
    {
      target: merged,
      names: ['noteImages', 'noteImageRefs', 'noteImagesUpdatedAt'],
    },
    ['noteImagesUpdatedAt', 'updatedAt']
  );

  normalizeReviewMerge(merged, existing, incoming);

  chooseByTime(
    existing,
    incoming,
    {
      target: merged,
      names: ['analysis', 'analysisContentUpdatedAt'],
    },
    ['analysisContentUpdatedAt', 'analysis.updatedAt', 'updatedAt']
  );

  chooseByTime(
    existing,
    incoming,
    {
      target: merged,
      names: [
        'detailedExplanation',
        'detailedExplanationUpdatedAt',
        'explanationContentUpdatedAt',
      ],
    },
    ['explanationContentUpdatedAt', 'detailedExplanationUpdatedAt', 'updatedAt']
  );

  chooseByTime(
    existing,
    incoming,
    {
      target: merged,
      names: ['hint', 'hintUpdatedAt', 'hintContentUpdatedAt'],
    },
    ['hintContentUpdatedAt', 'hintUpdatedAt', 'updatedAt']
  );

  mergeFollowUps(merged, existing, incoming);
  mergeDeletion(merged, existing, incoming);

  return finalizeMergedPayload(merged);
}

async function handleSync(req, res, pool, syncToken) {
  if (!requireAuth(req, res, syncToken)) {
    return;
  }

  let input;
  try {
    input = await readJson(req);
  } catch (_error) {
    sendJson(res, 400, { error: 'INVALID_JSON' });
    return;
  }

  const deviceId =
    typeof input.deviceId === 'string' && input.deviceId.trim()
      ? input.deviceId.trim()
      : 'unknown-device';
  const records = Array.isArray(input.records) ? input.records : [];

  const client = await pool.connect();
  try {
    await client.query('begin');

    for (const item of records) {
      const record = normalizeRecord(item);
      if (!record) {
        continue;
      }

      const existingResult = await client.query(
        'select payload from question_records where id = $1 for update',
        [record.id]
      );
      const existingPayload = existingResult.rows[0]?.payload;
      const mergedPayload = existingPayload
        ? mergeQuestionPayload(existingPayload, record.payload)
        : finalizeMergedPayload({ ...record.payload, syncStatus: 'synced' });
      const updatedAtMs = computeRecordUpdatedAtMs(mergedPayload);

      await client.query(
        `
          insert into question_records
            (id, updated_at_ms, deleted, payload, source_device, server_updated_at)
          values
            ($1, $2, $3, $4::jsonb, $5, now())
          on conflict (id) do update set
            updated_at_ms = excluded.updated_at_ms,
            deleted = excluded.deleted,
            payload = excluded.payload,
            source_device = excluded.source_device,
            server_updated_at = now()
        `,
        [
          record.id,
          updatedAtMs,
          mergedPayload.deleted === true,
          JSON.stringify(mergedPayload),
          deviceId,
        ]
      );
    }

    const result = await client.query(
      `
        select payload
        from question_records
        order by updated_at_ms desc, id asc
      `
    );
    await client.query('commit');

    sendJson(res, 200, {
      ok: true,
      serverTime: new Date().toISOString(),
      records: result.rows.map((row) =>
        finalizeMergedPayload({ ...row.payload, syncStatus: 'synced' })
      ),
    });
  } catch (error) {
    await client.query('rollback');
    console.error(error);
    sendJson(res, 500, { error: 'SYNC_FAILED' });
  } finally {
    client.release();
  }
}

function createServer(pool, syncToken) {
  return http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/sync') {
      void handleSync(req, res, pool, syncToken);
      return;
    }

    sendJson(res, 404, { error: 'NOT_FOUND' });
  });
}

async function start() {
  const port = Number(process.env.PORT || 3017);
  const syncToken = process.env.SYNC_TOKEN || '';
  const databaseUrl = process.env.DATABASE_URL || '';

  if (!syncToken) {
    throw new Error('SYNC_TOKEN is required');
  }

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = new Pool({
    connectionString: databaseUrl,
  });
  await pool.query(SCHEMA_SQL);

  const server = createServer(pool, syncToken);
  server.listen(port, '0.0.0.0', () => {
    console.log(`WrongBook sync server listening on ${port}`);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  computeRecordUpdatedAtMs,
  mergeQuestionPayload,
  normalizeRecord,
  toMillis,
};
