const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');
require('dotenv').config({ quiet: true });
const { Pool } = require('pg');

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
const PROTOCOL_VERSION = 2;
const CAPABILITIES = Object.freeze([
  'push-pull-v2',
  'paged-snapshot-v1',
  'canonical-images-v1',
  'review-events-v1',
  'permanent-tombstones-v1',
  'gzip-v1',
]);

const DEFAULT_LIMITS = Object.freeze({
  maxRequestBytes: 16 * 1024 * 1024,
  maxDecompressedBytes: 48 * 1024 * 1024,
  maxResponseBytes: 48 * 1024 * 1024,
  targetPageBytes: 8 * 1024 * 1024,
  defaultPageLimit: 100,
  maxPageLimit: 250,
});

class HttpError extends Error {
  constructor(status, code, details = {}) {
    super(code);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function positiveInteger(value, fallback, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    return fallback;
  }
  return Math.min(parsed, maximum);
}

function getLimits(overrides = {}) {
  return {
    maxRequestBytes: positiveInteger(
      overrides.maxRequestBytes ?? process.env.SYNC_MAX_REQUEST_BYTES,
      DEFAULT_LIMITS.maxRequestBytes,
      1024
    ),
    maxDecompressedBytes: positiveInteger(
      overrides.maxDecompressedBytes ?? process.env.SYNC_MAX_DECOMPRESSED_BYTES,
      DEFAULT_LIMITS.maxDecompressedBytes,
      1024
    ),
    maxResponseBytes: positiveInteger(
      overrides.maxResponseBytes ?? process.env.SYNC_MAX_RESPONSE_BYTES,
      DEFAULT_LIMITS.maxResponseBytes,
      1024
    ),
    targetPageBytes: positiveInteger(
      overrides.targetPageBytes ?? process.env.SYNC_TARGET_PAGE_BYTES,
      DEFAULT_LIMITS.targetPageBytes,
      1024
    ),
    defaultPageLimit: positiveInteger(
      overrides.defaultPageLimit ?? process.env.SYNC_DEFAULT_PAGE_LIMIT,
      DEFAULT_LIMITS.defaultPageLimit,
      1,
      1000
    ),
    maxPageLimit: positiveInteger(
      overrides.maxPageLimit ?? process.env.SYNC_MAX_PAGE_LIMIT,
      DEFAULT_LIMITS.maxPageLimit,
      1,
      1000
    ),
  };
}

function protocolHeaders(extra = {}) {
  return {
    'x-wrongbook-sync-protocol': String(PROTOCOL_VERSION),
    'x-wrongbook-sync-capabilities': CAPABILITIES.join(','),
    ...extra,
  };
}

function sendJson(req, res, status, payload, extraHeaders = {}) {
  if (res.headersSent || res.writableEnded) {
    return;
  }

  const plainBody = Buffer.from(JSON.stringify(payload));
  const acceptsGzip = /(?:^|,)\s*gzip\s*(?:,|$)/i.test(
    String(req?.headers?.['accept-encoding'] || '')
  );
  const shouldCompress = acceptsGzip && plainBody.length >= 1024;
  const body = shouldCompress ? zlib.gzipSync(plainBody) : plainBody;
  const headers = protocolHeaders({
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    ...extraHeaders,
  });

  if (shouldCompress) {
    headers['content-encoding'] = 'gzip';
    headers.vary = 'Accept-Encoding';
  }

  res.writeHead(status, headers);
  res.end(body);
}

function capabilityPayload(limits) {
  return {
    ok: true,
    protocolVersion: PROTOCOL_VERSION,
    protocolVersions: [1, PROTOCOL_VERSION],
    preferredProtocolVersion: PROTOCOL_VERSION,
    capabilities: [...CAPABILITIES],
    maxRequestBytes: limits.maxRequestBytes,
    maxDecompressedBytes: limits.maxDecompressedBytes,
    maxResponseBytes: limits.maxResponseBytes,
    targetPageBytes: limits.targetPageBytes,
    defaultPageLimit: limits.defaultPageLimit,
    maxPageLimit: limits.maxPageLimit,
  };
}

function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const declaredLength = Number(req.headers['content-length'] || 0);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      req.resume();
      reject(
        new HttpError(413, 'REQUEST_TOO_LARGE', {
          maxRequestBytes: maxBytes,
        })
      );
      return;
    }

    const chunks = [];
    let bytes = 0;
    let settled = false;

    req.on('data', (chunk) => {
      if (settled) {
        return;
      }
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBytes) {
        settled = true;
        chunks.length = 0;
        reject(
          new HttpError(413, 'REQUEST_TOO_LARGE', {
            maxRequestBytes: maxBytes,
          })
        );
        return;
      }
      chunks.push(buffer);
    });

    req.on('end', () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks, bytes));
      }
    });

    req.on('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

async function readJson(req, limits) {
  const raw = await readRawBody(req, limits.maxRequestBytes);
  const contentEncoding = String(req.headers['content-encoding'] || 'identity')
    .trim()
    .toLowerCase();
  let decoded;

  if (!contentEncoding || contentEncoding === 'identity') {
    decoded = raw;
  } else if (contentEncoding === 'gzip' || contentEncoding === 'x-gzip') {
    try {
      decoded = zlib.gunzipSync(raw, {
        maxOutputLength: limits.maxDecompressedBytes,
      });
    } catch (error) {
      if (
        error?.code === 'ERR_BUFFER_TOO_LARGE' ||
        /larger than|output length/i.test(String(error?.message || ''))
      ) {
        throw new HttpError(413, 'DECOMPRESSED_REQUEST_TOO_LARGE', {
          maxDecompressedBytes: limits.maxDecompressedBytes,
        });
      }
      throw new HttpError(400, 'INVALID_GZIP');
    }
  } else {
    throw new HttpError(415, 'UNSUPPORTED_CONTENT_ENCODING', {
      supported: ['identity', 'gzip'],
    });
  }

  if (decoded.length > limits.maxDecompressedBytes) {
    throw new HttpError(413, 'DECOMPRESSED_REQUEST_TOO_LARGE', {
      maxDecompressedBytes: limits.maxDecompressedBytes,
    });
  }

  try {
    return decoded.length > 0 ? JSON.parse(decoded.toString('utf8')) : {};
  } catch (_error) {
    throw new HttpError(400, 'INVALID_JSON');
  }
}

function safeTokenEqual(a, b) {
  const bufferA = Buffer.from(String(a));
  const bufferB = Buffer.from(String(b));
  if (bufferA.length !== bufferB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufferA, bufferB);
}

function requireAuth(req, res, syncToken) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || !safeTokenEqual(token, syncToken)) {
    sendJson(req, res, 401, { error: 'UNAUTHORIZED' });
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

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (isPlainObject(value)) {
    const result = Object.create(null);
    return Object.keys(value)
      .sort()
      .reduce((target, key) => {
        target[key] = stableValue(value[key]);
        return target;
      }, result);
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function copyFields(target, source, fields) {
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      target[field] = source[field];
    }
  }
}

function chooseByTime(existing, incoming, target, names, timeFields) {
  const existingTime = getTime(existing, timeFields);
  const incomingTime = getTime(incoming, timeFields);
  let source;

  if (incomingTime > existingTime) {
    source = incoming;
  } else if (existingTime > incomingTime) {
    source = existing;
  } else {
    const existingHasValue = names.some((name) =>
      Object.prototype.hasOwnProperty.call(existing, name)
    );
    const incomingHasValue = names.some((name) =>
      Object.prototype.hasOwnProperty.call(incoming, name)
    );

    if (!existingHasValue && incomingHasValue) {
      source = incoming;
    } else if (existingHasValue && !incomingHasValue) {
      source = existing;
    } else {
      const existingProjection = names.map((name) => existing[name]);
      const incomingProjection = names.map((name) => incoming[name]);
      source =
        stableStringify(incomingProjection) > stableStringify(existingProjection)
          ? incoming
          : existing;
    }
  }

  copyFields(target, source, names);
  return Math.max(existingTime, incomingTime);
}

function getEarlierTime(left, right) {
  const leftMs = toMillis(left);
  const rightMs = toMillis(right);
  if (leftMs > 0 && rightMs > 0) {
    return leftMs <= rightMs ? left : right;
  }
  return leftMs > 0 ? left : right;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeImageId(value, fallbackHash) {
  const raw = typeof value === 'string' ? value.trim() : '';
  const safe = raw.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120);
  return safe || `img-${fallbackHash.slice(0, 32)}`;
}

function normalizeContentHash(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.trim().toLowerCase().replace(/^sha256:/, '');
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : '';
}

function parseImageDataUrl(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(
    trimmed
  );
  if (!match) {
    return null;
  }
  const encoded = match[2].replace(/[\r\n]/g, '');
  if (!encoded || encoded.length % 4 === 1) {
    return null;
  }
  try {
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length === 0) {
      return null;
    }
    const normalizedInput = encoded.replace(/=+$/, '');
    const normalizedOutput = bytes.toString('base64').replace(/=+$/, '');
    if (normalizedInput !== normalizedOutput) {
      return null;
    }
    return {
      dataUrl: `data:${match[1].toLowerCase()};base64,${bytes.toString('base64')}`,
      bytes,
    };
  } catch (_error) {
    return null;
  }
}

function normalizeImageRef(ref, kind = 'question') {
  if (!isPlainObject(ref)) {
    return null;
  }

  const candidateDataUrl =
    typeof ref.dataUrl === 'string' ? ref.dataUrl.trim() : '';
  const parsedDataUrl = parseImageDataUrl(candidateDataUrl);
  const declaredHash = normalizeContentHash(ref.contentHash);
  const dataHash = parsedDataUrl ? sha256(parsedDataUrl.bytes) : '';
  const hashMismatch = Boolean(declaredHash && dataHash && declaredHash !== dataHash);
  const dataUrl = parsedDataUrl && !hashMismatch ? parsedDataUrl.dataUrl : '';
  const contentHash = declaredHash || dataHash;
  const rawUri = typeof ref.uri === 'string' ? ref.uri.trim() : '';
  const localOnlyUri = /^file:/i.test(rawUri);
  const fallbackHash = contentHash || sha256(stableStringify(ref));
  const canonicalId = contentHash
    ? `img-${contentHash.slice(0, 32)}`
    : safeImageId(ref.id, fallbackHash);
  const normalized = {
    id: canonicalId,
    kind: ref.kind === 'note' || kind === 'note' ? 'note' : 'question',
  };

  for (const field of ['createdAt', 'mimeType', 'width', 'height']) {
    if (Object.prototype.hasOwnProperty.call(ref, field)) {
      normalized[field] = ref[field];
    }
  }

  if (contentHash) {
    // Cross-platform contract: lowercase SHA-256 of the decoded image bytes.
    normalized.contentHash = contentHash;
  }

  if (dataUrl) {
    normalized.storage = 'inline';
    normalized.dataUrl = dataUrl;
  } else if (rawUri && !localOnlyUri) {
    normalized.storage = ref.storage || 'remote';
    normalized.uri = rawUri;
  } else {
    normalized.status = 'unavailable';
  }

  if (
    ref.status === 'unavailable' ||
    (candidateDataUrl && !dataUrl) ||
    hashMismatch
  ) {
    normalized.status = 'unavailable';
  }

  return normalized;
}

function legacyRef(value, kind, index) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const raw = value.trim();
  return normalizeImageRef(
    raw.startsWith('data:')
      ? { id: `legacy-${kind}-${index}`, kind, storage: 'inline', dataUrl: raw }
      : { id: `legacy-${kind}-${index}`, kind, uri: raw },
    kind
  );
}

function extractImageRefs(payload, refField, legacyField, kind) {
  const refs = [];
  if (Array.isArray(payload?.[refField])) {
    for (const ref of payload[refField]) {
      const normalized = normalizeImageRef(ref, kind);
      if (normalized) {
        refs.push(normalized);
      }
    }
  } else if (legacyField === 'image') {
    const normalized = legacyRef(payload?.image, kind, 0);
    if (normalized) {
      refs.push(normalized);
    }
  } else if (Array.isArray(payload?.[legacyField])) {
    payload[legacyField].forEach((value, index) => {
      const normalized = legacyRef(value, kind, index);
      if (normalized) {
        refs.push(normalized);
      }
    });
  }

  const byIdentity = new Map();
  for (const ref of refs) {
    const key = ref.contentHash || ref.id;
    const previous = byIdentity.get(key);
    if (!previous || (previous.status === 'unavailable' && ref.status !== 'unavailable')) {
      byIdentity.set(key, ref);
    }
  }
  return [...byIdentity.values()].sort((left, right) =>
    String(left.id).localeCompare(String(right.id))
  );
}

function isUsableImageRef(ref) {
  return (
    isPlainObject(ref) &&
    ref.status !== 'unavailable' &&
    (typeof ref.dataUrl === 'string' || typeof ref.uri === 'string')
  );
}

function mergePartialImageRefs(existingRefs, incomingRefs, allowNewRefs) {
  const byIdentity = new Map();
  for (const ref of existingRefs) {
    byIdentity.set(ref.contentHash || ref.id, ref);
  }
  for (const ref of incomingRefs.filter(isUsableImageRef)) {
    const key = ref.contentHash || ref.id;
    const previous = byIdentity.get(key);
    if ((!previous && allowNewRefs) || previous?.status === 'unavailable') {
      byIdentity.set(key, ref);
    }
  }
  return [...byIdentity.values()].sort((left, right) =>
    String(left.id).localeCompare(String(right.id))
  );
}

function mergeImageGroup(merged, existing, incoming, config) {
  const existingRefs = extractImageRefs(
    existing,
    config.refField,
    config.legacyField,
    config.kind
  );
  const incomingRefs = extractImageRefs(
    incoming,
    config.refField,
    config.legacyField,
    config.kind
  );
  const existingExplicit =
    Object.prototype.hasOwnProperty.call(existing, config.refField) ||
    Object.prototype.hasOwnProperty.call(existing, config.legacyField);
  const incomingExplicit =
    Object.prototype.hasOwnProperty.call(incoming, config.refField) ||
    Object.prototype.hasOwnProperty.call(incoming, config.legacyField);
  const existingTime = getTime(existing, config.timeFields);
  const incomingTime = getTime(incoming, config.timeFields);
  const incomingHasUnavailable = incomingRefs.some((ref) => !isUsableImageRef(ref));
  const incomingComplete =
    incoming[config.completeField] === true && !incomingHasUnavailable;
  const legacyComplete =
    incoming[config.completeField] !== false &&
    incomingExplicit &&
    incomingRefs.length > 0 &&
    !incomingHasUnavailable;
  const mayReplace = incomingComplete || legacyComplete;
  let result = existingRefs;
  let acceptedIncoming = false;

  if (!existingExplicit && incomingExplicit) {
    result = incomingRefs.filter(isUsableImageRef);
    acceptedIncoming = true;
  } else if (incomingExplicit && mayReplace && incomingTime > existingTime) {
    result = incomingRefs;
    acceptedIncoming = true;
  } else if (incomingExplicit && mayReplace && incomingTime === existingTime) {
    if (existingRefs.length === 0 && incomingRefs.length > 0) {
      result = incomingRefs;
      acceptedIncoming = true;
    } else if (existingRefs.length > 0 && incomingRefs.length > 0) {
      const existingValue = stableStringify(existingRefs);
      const incomingValue = stableStringify(incomingRefs);
      if (incomingValue > existingValue) {
        result = incomingRefs;
        acceptedIncoming = true;
      }
    }
  } else if (incomingExplicit) {
    const combined = mergePartialImageRefs(
      existingRefs,
      incomingRefs,
      incomingTime > existingTime
    );
    acceptedIncoming = stableStringify(combined) !== stableStringify(existingRefs);
    result = combined;
  }

  merged[config.refField] = result;
  merged[config.completeField] = acceptedIncoming
    ? incomingComplete || legacyComplete
    : existing[config.completeField] === true || existingRefs.every(isUsableImageRef);

  const groupTime = acceptedIncoming
    ? Math.max(existingTime, incomingTime)
    : existingTime || incomingTime;
  if (groupTime > 0) {
    merged[config.updatedAtField] = new Date(groupTime).toISOString();
  }

  delete merged[config.legacyField];
}

function canonicalizeImages(payload) {
  const result = { ...payload };
  mergeImageGroup(result, {}, payload, {
    refField: 'imageRefs',
    legacyField: 'image',
    completeField: 'imageRefsComplete',
    updatedAtField: 'imageRefsUpdatedAt',
    timeFields: ['imageRefsUpdatedAt', 'contentUpdatedAt', 'updatedAt'],
    kind: 'question',
  });
  mergeImageGroup(result, {}, payload, {
    refField: 'noteImageRefs',
    legacyField: 'noteImages',
    completeField: 'noteImageRefsComplete',
    updatedAtField: 'noteImageRefsUpdatedAt',
    timeFields: ['noteImageRefsUpdatedAt', 'noteImagesUpdatedAt', 'updatedAt'],
    kind: 'note',
  });
  return result;
}

function withLegacyImageFields(payload) {
  const result = { ...payload };
  const imageRefs = Array.isArray(result.imageRefs) ? result.imageRefs : [];
  const noteImageRefs = Array.isArray(result.noteImageRefs) ? result.noteImageRefs : [];
  const firstImage = imageRefs.find(isUsableImageRef);
  if (firstImage) {
    result.image = firstImage.dataUrl || firstImage.uri || '';
  }
  result.noteImages = noteImageRefs
    .filter(isUsableImageRef)
    .map((ref) => ref.dataUrl || ref.uri)
    .filter(Boolean);
  return result;
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

  if (!id || id.length > 512) {
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
  if (
    !Object.prototype.hasOwnProperty.call(payload, 'restoredAt') &&
    Object.prototype.hasOwnProperty.call(record, 'restoredAt')
  ) {
    payload.restoredAt = record.restoredAt;
  }

  return { id, payload };
}

function computeRecordUpdatedAtMs(payload) {
  const times = [
    payload?.updatedAt,
    payload?.contentUpdatedAt,
    payload?.notesUpdatedAt,
    payload?.imageRefsUpdatedAt,
    payload?.noteImagesUpdatedAt,
    payload?.noteImageRefsUpdatedAt,
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
    payload?.restoredAt,
    payload?.createdAt,
  ];

  if (Array.isArray(payload?.followUpChats)) {
    for (const chat of payload.followUpChats) {
      times.push(chat?.createdAt, chat?.updatedAt);
    }
  }
  if (Array.isArray(payload?.reviewEvents)) {
    for (const event of payload.reviewEvents) {
      times.push(event?.reviewedAt, event?.updatedAt);
    }
  }

  return Math.max(0, ...times.map(toMillis));
}

function followUpFingerprint(chat) {
  const createdAtMs = toMillis(chat?.createdAt);
  return stableStringify({
    role: chat?.role || '',
    content: chat?.content || '',
    createdAt: createdAtMs > 0 ? createdAtMs : chat?.createdAt || '',
  });
}

function legacyFollowUpId(questionId, chat, sourceIndex, fallbackCreatedAt) {
  const createdAtMs =
    toMillis(chat?.createdAt) || toMillis(fallbackCreatedAt) || 0;
  const values = [
    String(questionId || ''),
    String(chat?.role || ''),
    String(chat?.content || ''),
    String(createdAtMs),
    String(sourceIndex),
  ];
  const canonical = values
    .map((value) => `${Buffer.byteLength(value, 'utf8')}:${value}`)
    .join('|');
  return `legacy-followup-${sha256(canonical)}`;
}

function stableFollowUpId(questionId, chat, sourceIndex, fallbackCreatedAt) {
  if (
    typeof chat.id === 'string' &&
    chat.id.trim() &&
    !chat.id.trim().startsWith('legacy-chat-')
  ) {
    return chat.id.trim();
  }
  return legacyFollowUpId(questionId, chat, sourceIndex, fallbackCreatedAt);
}

function normalizeFollowUpChats(payload) {
  const value = payload?.followUpChats;
  if (!Array.isArray(value)) {
    return [];
  }
  const fallbackCreatedAt = payload?.createdAt || payload?.updatedAt || 0;
  return value.filter(isPlainObject).map((chat, index) => {
    const createdAtMs =
      toMillis(chat.createdAt) || toMillis(fallbackCreatedAt) || 0;
    return {
      ...chat,
      id: stableFollowUpId(payload?.id, chat, index, fallbackCreatedAt),
      ...(toMillis(chat.createdAt) > 0 || createdAtMs <= 0
        ? {}
        : { createdAt: new Date(createdAtMs).toISOString() }),
    };
  });
}

function mergeFollowUps(merged, existing, incoming) {
  const byId = new Map();
  const chats = [
    ...normalizeFollowUpChats(existing),
    ...normalizeFollowUpChats(incoming),
  ];
  for (const chat of chats) {
    const previous = byId.get(chat.id);
    if (!previous) {
      byId.set(chat.id, chat);
      continue;
    }
    const previousTime = maxTime(previous.updatedAt, previous.createdAt);
    const chatTime = maxTime(chat.updatedAt, chat.createdAt);
    if (
      chatTime > previousTime ||
      (chatTime === previousTime && stableStringify(chat) > stableStringify(previous))
    ) {
      byId.set(chat.id, chat);
    }
  }

  // Older clients generated different IDs for the same ID-less chat on each
  // read (and early v2 clients used a different hash). Collapse exact message
  // fingerprints so an upgrade cannot duplicate the conversation forever.
  const byFingerprint = new Map();
  for (const chat of byId.values()) {
    const fingerprint = followUpFingerprint(chat);
    const previous = byFingerprint.get(fingerprint);
    if (!previous) {
      byFingerprint.set(fingerprint, chat);
      continue;
    }
    const previousTime = maxTime(previous.updatedAt, previous.createdAt);
    const chatTime = maxTime(chat.updatedAt, chat.createdAt);
    const winner =
      chatTime > previousTime ||
      (chatTime === previousTime && stableStringify(chat) > stableStringify(previous))
        ? chat
        : previous;
    const canonicalIds = [previous.id, chat.id]
      .filter((id) => !String(id).startsWith('legacy-chat-'))
      .sort((left, right) => String(left).localeCompare(String(right)));
    const canonicalId =
      canonicalIds[0] ||
      legacyFollowUpId(merged.id, winner, 0, merged.createdAt || merged.updatedAt);
    byFingerprint.set(fingerprint, { ...winner, id: canonicalId });
  }

  const mergedChats = [...byFingerprint.values()].sort((left, right) => {
    const diff = toMillis(left.createdAt) - toMillis(right.createdAt);
    return diff === 0 ? String(left.id).localeCompare(String(right.id)) : diff;
  });
  if (mergedChats.length > 0) {
    merged.followUpChats = mergedChats;
  } else {
    delete merged.followUpChats;
  }
  const latest = maxTime(
    existing.followUpContentUpdatedAt,
    incoming.followUpContentUpdatedAt,
    ...mergedChats.flatMap((chat) => [chat.createdAt, chat.updatedAt])
  );
  if (latest > 0) {
    merged.followUpContentUpdatedAt = new Date(latest).toISOString();
  }
}

function normalizeReviewEvent(event) {
  if (!isPlainObject(event) || typeof event.id !== 'string' || !event.id.trim()) {
    return null;
  }
  const kind = event.kind === 'revert' ? 'revert' : 'review';
  const normalized = {
    id: event.id.trim(),
    kind,
    reviewedAt:
      toIso(event.reviewedAt || event.updatedAt) ||
      '1970-01-01T00:00:00.001Z',
  };
  if (typeof event.deviceId === 'string' && event.deviceId.trim()) {
    normalized.deviceId = event.deviceId.trim();
  }
  if (kind === 'review') {
    const quality = Number(event.quality);
    normalized.quality = Number.isFinite(quality)
      ? Math.max(0, Math.min(3, Math.floor(quality)))
      : 2;
  } else if (typeof event.targetEventId === 'string' && event.targetEventId.trim()) {
    normalized.targetEventId = event.targetEventId.trim();
  } else {
    return null;
  }
  return normalized;
}

function synthesizeLegacyReviewEvents(payload, existingEvents) {
  const events = [...existingEvents];
  const requestedCount = Number.isFinite(Number(payload?.reviewCount))
    ? Math.max(0, Math.floor(Number(payload.reviewCount)))
    : 0;
  const revertedIds = new Set(
    events
      .filter((event) => event.kind === 'revert')
      .map((event) => event.targetEventId)
  );
  const activeCount = events.filter(
    (event) => event.kind === 'review' && event.quality > 0 && !revertedIds.has(event.id)
  ).length;
  const missing = Math.max(0, requestedCount - activeCount);
  const timestamp =
    toIso(
      payload?.lastReviewedAt ||
        payload?.reviewUpdatedAt ||
        payload?.updatedAt ||
        payload?.createdAt
    ) || '1970-01-01T00:00:00.001Z';
  const questionId = typeof payload?.id === 'string' ? payload.id : 'unknown';
  let ordinal = 1;
  let added = 0;
  while (added < missing) {
    const id = `legacy-review:${questionId}:${ordinal}`;
    ordinal += 1;
    if (events.some((event) => event.id === id)) {
      continue;
    }
    events.push({
      id,
      kind: 'review',
      reviewedAt: timestamp,
      quality: 2,
      deviceId: 'legacy',
    });
    added += 1;
  }
  return events;
}

function normalizeReviewEvents(payload) {
  const supplied = Array.isArray(payload?.reviewEvents)
    ? payload.reviewEvents.map(normalizeReviewEvent).filter(Boolean)
    : [];
  return supplied.length > 0
    ? supplied
    : synthesizeLegacyReviewEvents(payload, supplied);
}

function mergeReviewEvents(existing, incoming) {
  const byId = new Map();
  const existingEvents = normalizeReviewEvents(existing);
  let incomingEvents;
  if (Array.isArray(incoming?.reviewEvents)) {
    incomingEvents = normalizeReviewEvents(incoming);
  } else {
    incomingEvents = [];
    const existingCount = deriveReviewCount(existingEvents);
    const incomingCount = Number.isFinite(Number(incoming?.reviewCount))
      ? Math.max(0, Math.floor(Number(incoming.reviewCount)))
      : 0;
    const timestamp =
      toIso(
        incoming?.lastReviewedAt ||
          incoming?.reviewUpdatedAt ||
          incoming?.updatedAt ||
          incoming?.createdAt
      ) || '1970-01-01T00:00:00.001Z';
    const questionId =
      typeof existing?.id === 'string'
        ? existing.id
        : typeof incoming?.id === 'string'
          ? incoming.id
          : 'unknown';
    const missingCount = Math.max(0, incomingCount - existingCount);
    for (let offset = 1; offset <= missingCount; offset += 1) {
      incomingEvents.push({
        id: `legacy-v1-review:${questionId}:${incomingCount}:${offset}`,
        kind: 'review',
        reviewedAt: timestamp,
        quality: 2,
        deviceId: 'legacy',
      });
    }
  }

  for (const event of [...existingEvents, ...incomingEvents]) {
    const previous = byId.get(event.id);
    if (!previous) {
      byId.set(event.id, event);
      continue;
    }
    const previousTime = toMillis(previous.reviewedAt);
    const eventTime = toMillis(event.reviewedAt);
    if (
      eventTime > previousTime ||
      (eventTime === previousTime && stableStringify(event) > stableStringify(previous))
    ) {
      byId.set(event.id, event);
    }
  }
  return [...byId.values()].sort((left, right) => {
    const diff = toMillis(left.reviewedAt) - toMillis(right.reviewedAt);
    return diff === 0 ? left.id.localeCompare(right.id) : diff;
  });
}

function deriveReviewCount(events) {
  return activeReviewEvents(events).filter((event) => event.quality > 0).length;
}

function activeReviewEvents(events) {
  const revertedIds = new Set(
    events
      .filter((event) => event.kind === 'revert')
      .map((event) => event.targetEventId)
  );
  return events
    .filter((event) => event.kind === 'review' && !revertedIds.has(event.id))
    .sort((left, right) => {
      const diff = toMillis(left.reviewedAt) - toMillis(right.reviewedAt);
      return diff === 0 ? left.id.localeCompare(right.id) : diff;
    });
}

function getReviewIntervalDays(successfulReviewCount) {
  if (successfulReviewCount <= 1) {
    return 1;
  }
  if (successfulReviewCount === 2) {
    return 3;
  }
  if (successfulReviewCount === 3) {
    return 7;
  }
  if (successfulReviewCount === 4) {
    return 14;
  }
  return 30;
}

function deriveReviewState(events, createdAt) {
  const active = activeReviewEvents(events);
  let successfulCount = 0;
  let masteryLevel = 0;
  let nextReviewAtMs = 0;

  for (const event of active) {
    const quality = Math.max(0, Math.min(3, Number(event.quality) || 0));
    if (quality > 0) {
      successfulCount += 1;
    }
    const reviewedAtMs = toMillis(event.reviewedAt);
    const intervalDays = getReviewIntervalDays(Math.max(successfulCount, 1));
    if (reviewedAtMs > 0) {
      if (quality === 0) {
        nextReviewAtMs = reviewedAtMs + 10 * 60 * 1000;
      } else if (quality === 1) {
        nextReviewAtMs = reviewedAtMs + 24 * 60 * 60 * 1000;
      } else if (quality === 3) {
        nextReviewAtMs =
          reviewedAtMs + intervalDays * 2 * 24 * 60 * 60 * 1000;
      } else {
        nextReviewAtMs = reviewedAtMs + intervalDays * 24 * 60 * 60 * 1000;
      }
    }
    if (quality === 0) {
      masteryLevel = 0;
    } else if (quality === 1) {
      masteryLevel = Math.max(masteryLevel, 1);
    } else if (quality === 2) {
      masteryLevel = Math.max(masteryLevel, 3);
    } else {
      masteryLevel = 5;
    }
  }

  if (active.length === 0) {
    const createdAtMs = toMillis(createdAt);
    if (createdAtMs > 0) {
      nextReviewAtMs = createdAtMs + 24 * 60 * 60 * 1000;
    }
  }

  return {
    reviewCount: successfulCount,
    masteryLevel,
    lastReviewedAt: active.length > 0 ? active[active.length - 1].reviewedAt : undefined,
    nextReviewAt:
      nextReviewAtMs > 0 ? new Date(nextReviewAtMs).toISOString() : undefined,
    reviewStatus: active.length > 0 ? 'reviewing' : 'new',
  };
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
  chooseByTime(
    existing,
    incoming,
    merged,
    ['masteryLevel', 'nextReviewAt', 'reviewStatus', 'lastReviewedAt'],
    ['reviewUpdatedAt', 'lastReviewedAt', 'updatedAt']
  );

  const events = mergeReviewEvents(existing, incoming);
  const derived = deriveReviewState(
    events,
    getEarlierTime(existing.createdAt, incoming.createdAt) ||
      existing.updatedAt ||
      incoming.updatedAt
  );
  merged.reviewEvents = events;
  merged.reviewCount = derived.reviewCount;
  merged.masteryLevel = derived.masteryLevel;
  merged.reviewStatus = derived.reviewStatus;
  if (derived.lastReviewedAt) {
    merged.lastReviewedAt = derived.lastReviewedAt;
  } else {
    delete merged.lastReviewedAt;
  }

  const latestEventTime = maxTime(...events.map((event) => event.reviewedAt));
  const latestReviewUpdatedAt = Math.max(
    existingReviewTime,
    incomingReviewTime,
    latestEventTime
  );
  if (latestReviewUpdatedAt > 0) {
    merged.reviewUpdatedAt = new Date(latestReviewUpdatedAt).toISOString();
  }

  // A postpone is an explicit schedule override without a review event. Preserve
  // it only when its mutation timestamp is later than every merged event.
  const hasNewerScheduleOverride =
    Math.max(existingReviewTime, incomingReviewTime) > latestEventTime;
  if (!hasNewerScheduleOverride || !merged.nextReviewAt) {
    if (derived.nextReviewAt) {
      merged.nextReviewAt = derived.nextReviewAt;
    } else {
      delete merged.nextReviewAt;
    }
  }
}

function mergeDeletion(merged, existing, incoming) {
  const existingDeletedAt = toMillis(existing.deletedAt);
  const incomingDeletedAt = toMillis(incoming.deletedAt);
  const existingDeleteTime =
    existingDeletedAt > 0
      ? existingDeletedAt
      : existing.deleted === true
        ? toMillis(existing.updatedAt)
        : 0;
  const incomingDeleteTime =
    incomingDeletedAt > 0
      ? incomingDeletedAt
      : incoming.deleted === true
        ? toMillis(incoming.updatedAt)
        : 0;
  const deleteTime = Math.max(existingDeleteTime, incomingDeleteTime);
  const hasUntimedDelete =
    (existing.deleted === true && existingDeleteTime === 0) ||
    (incoming.deleted === true && incomingDeleteTime === 0);
  const restoreTime = maxTime(existing.restoredAt, incoming.restoredAt);
  const deleted = hasUntimedDelete || (deleteTime > 0 && restoreTime <= deleteTime);

  merged.deleted = deleted;
  if (deleteTime > 0) {
    merged.deletedAt = new Date(deleteTime).toISOString();
  } else if (!deleted) {
    delete merged.deletedAt;
  }
  if (restoreTime > 0) {
    merged.restoredAt = new Date(restoreTime).toISOString();
  } else {
    delete merged.restoredAt;
  }
}

function ensureUpdatedAt(payload) {
  const current = toMillis(payload.updatedAt);
  const fallback = computeRecordUpdatedAtMs(payload);
  if (fallback > current) {
    payload.updatedAt = new Date(fallback).toISOString();
  }
}

function finalizeMergedPayload(payload) {
  let result = canonicalizeImages(payload);
  ensureUpdatedAt(result);
  result.syncStatus = 'synced';
  result.protocolVersion = PROTOCOL_VERSION;
  if (result.deleted !== true) {
    delete result.tombstoneCompacted;
  }
  delete result.image;
  delete result.noteImages;
  return result;
}

function mergeQuestionPayload(existingPayload, incomingPayload) {
  const existing = isPlainObject(existingPayload) ? existingPayload : {};
  const incoming = isPlainObject(incomingPayload) ? incomingPayload : {};
  const merged = { ...existing, ...incoming };

  merged.id =
    typeof existing.id === 'string' && existing.id ? existing.id : incoming.id;

  const createdAt = getEarlierTime(existing.createdAt, incoming.createdAt);
  if (createdAt) {
    merged.createdAt = toIso(createdAt) || createdAt;
  }
  const latestUpdatedAt = maxTime(existing.updatedAt, incoming.updatedAt);
  if (latestUpdatedAt > 0) {
    merged.updatedAt = new Date(latestUpdatedAt).toISOString();
  }

  chooseByTime(
    existing,
    incoming,
    merged,
    [
      'title',
      'questionText',
      'userAnswer',
      'correctAnswer',
      'category',
      'grade',
      'questionType',
      'source',
      'errorCause',
      'tags',
      'contentUpdatedAt',
    ],
    ['contentUpdatedAt', 'updatedAt']
  );

  chooseByTime(
    existing,
    incoming,
    merged,
    ['notes', 'notesUpdatedAt'],
    ['notesUpdatedAt', 'updatedAt']
  );

  mergeImageGroup(merged, existing, incoming, {
    refField: 'imageRefs',
    legacyField: 'image',
    completeField: 'imageRefsComplete',
    updatedAtField: 'imageRefsUpdatedAt',
    timeFields: ['imageRefsUpdatedAt', 'contentUpdatedAt', 'updatedAt'],
    kind: 'question',
  });
  mergeImageGroup(merged, existing, incoming, {
    refField: 'noteImageRefs',
    legacyField: 'noteImages',
    completeField: 'noteImageRefsComplete',
    updatedAtField: 'noteImageRefsUpdatedAt',
    timeFields: ['noteImageRefsUpdatedAt', 'noteImagesUpdatedAt', 'updatedAt'],
    kind: 'note',
  });

  normalizeReviewMerge(merged, existing, incoming);

  chooseByTime(
    existing,
    incoming,
    merged,
    ['analysis', 'analysisContentUpdatedAt'],
    ['analysisContentUpdatedAt', 'analysis.updatedAt', 'updatedAt']
  );
  chooseByTime(
    existing,
    incoming,
    merged,
    [
      'detailedExplanation',
      'detailedExplanationUpdatedAt',
      'explanationContentUpdatedAt',
    ],
    ['explanationContentUpdatedAt', 'detailedExplanationUpdatedAt', 'updatedAt']
  );
  chooseByTime(
    existing,
    incoming,
    merged,
    ['hint', 'hintUpdatedAt', 'hintContentUpdatedAt'],
    ['hintContentUpdatedAt', 'hintUpdatedAt', 'updatedAt']
  );

  mergeFollowUps(merged, existing, incoming);
  mergeDeletion(merged, existing, incoming);
  const finalized = finalizeMergedPayload(merged);
  if (
    finalized.deleted === true &&
    (existing.tombstoneCompacted === true || incoming.tombstoneCompacted === true)
  ) {
    return compactTombstonePayload(finalized);
  }
  return finalized;
}

function compactTombstonePayload(payload) {
  const fallbackDate =
    toIso(payload.createdAt || payload.deletedAt || payload.updatedAt) ||
    '1970-01-01T00:00:00.001Z';
  const compact = {
    id: payload.id,
    title:
      typeof payload.title === 'string' && payload.title.trim()
        ? payload.title
        : '已删除题目',
    category:
      typeof payload.category === 'string' && payload.category.trim()
        ? payload.category
        : '其他',
    createdAt: toIso(payload.createdAt) || fallbackDate,
    deleted: true,
    syncStatus: 'synced',
    protocolVersion: PROTOCOL_VERSION,
    tombstoneCompacted: true,
  };
  for (const field of ['updatedAt', 'deletedAt', 'restoredAt']) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      compact[field] = toIso(payload[field]) || payload[field];
    }
  }
  return compact;
}

function normalizeStoragePayload(payload) {
  const finalized = finalizeMergedPayload(payload);
  return finalized.deleted === true && payload.tombstoneCompacted === true
    ? compactTombstonePayload(finalized)
    : finalized;
}

function storagePayloadNeedsRewrite(existingPayload, mergedPayload) {
  if (!existingPayload) {
    return true;
  }
  // Compare the bytes represented by the stored JSON itself. Comparing a
  // normalized view here would incorrectly treat legacy image/imageRefs
  // duplication as already canonical and leave both base64 copies in JSONB.
  return stableStringify(existingPayload) !== stableStringify(mergedPayload);
}

function getDeviceId(input) {
  return typeof input?.deviceId === 'string' && input.deviceId.trim()
    ? input.deviceId.trim().slice(0, 256)
    : 'unknown-device';
}

function getTombstoneCompactCutoffMs() {
  const raw =
    process.env.TOMBSTONE_COMPACT_AFTER_DAYS ??
    process.env.TOMBSTONE_RETENTION_DAYS ??
    '0';
  const days = Number.parseInt(raw, 10);
  return Number.isFinite(days) && days > 0
    ? Date.now() - days * 24 * 60 * 60 * 1000
    : 0;
}

async function currentGeneration(client) {
  const result = await client.query(
    'select coalesce(max(revision), 0)::text as generation from question_records'
  );
  return String(result.rows[0]?.generation || '0');
}

function coalesceIncomingRecords(records) {
  const byId = new Map();
  let ignoredCount = 0;
  for (const item of records) {
    const record = normalizeRecord(item);
    if (!record) {
      ignoredCount += 1;
      continue;
    }
    const previous = byId.get(record.id);
    byId.set(record.id, {
      id: record.id,
      payload: previous
        ? mergeQuestionPayload(previous.payload, record.payload)
        : record.payload,
    });
  }
  return {
    records: [...byId.values()].sort((left, right) => left.id.localeCompare(right.id)),
    ignoredCount,
  };
}

async function compactExpiredTombstones(client, cutoffMs) {
  if (cutoffMs <= 0) {
    return 0;
  }
  const candidates = await client.query(
    `
      select id, payload
      from question_records
      where deleted = true
        and deleted_at_ms > 0
        and deleted_at_ms < $1
        and coalesce(payload->>'tombstoneCompacted', 'false') <> 'true'
      order by id asc
      for update
    `,
    [cutoffMs]
  );

  for (const row of candidates.rows) {
    await client.query(
      `
        update question_records
        set payload = $2::jsonb,
            revision = nextval('question_records_revision_seq'),
            server_updated_at = now()
        where id = $1
      `,
      [row.id, JSON.stringify(compactTombstonePayload(row.payload))]
    );
  }
  return candidates.rows.length;
}

async function pushRecords(pool, inputRecords, deviceId, options = {}) {
  const source = Array.isArray(inputRecords) ? inputRecords : [];
  const coalesced = coalesceIncomingRecords(source);
  if (options.strict === true && coalesced.ignoredCount > 0) {
    throw new HttpError(400, 'INVALID_RECORDS', {
      invalidRecordCount: coalesced.ignoredCount,
    });
  }
  const client = await pool.connect();
  let changedCount = 0;
  let compactedCount = 0;
  try {
    await client.query('begin');
    // A single sync database serves one private account. Serializing merge commits is
    // cheap here and also covers concurrent inserts, which row locks cannot protect.
    await client.query("select pg_advisory_xact_lock(hashtext('wrongbook_sync_v2'))");

    const ids = coalesced.records.map((record) => record.id);
    const existingById = new Map();
    if (ids.length > 0) {
      const existingResult = await client.query(
        `
          select id, payload
          from question_records
          where id = any($1::text[])
          order by id asc
          for update
        `,
        [ids]
      );
      for (const row of existingResult.rows) {
        existingById.set(row.id, row.payload);
      }
    }

    const tombstoneCompactCutoffMs = getTombstoneCompactCutoffMs();
    for (const record of coalesced.records) {
      const existingPayload = existingById.get(record.id);
      let mergedPayload = existingPayload
        ? mergeQuestionPayload(existingPayload, record.payload)
        : mergeQuestionPayload({}, record.payload);
      const deleteTime =
        toMillis(mergedPayload.deletedAt) || toMillis(mergedPayload.updatedAt);
      if (
        mergedPayload.deleted === true &&
        tombstoneCompactCutoffMs > 0 &&
        deleteTime > 0 &&
        deleteTime < tombstoneCompactCutoffMs
      ) {
        mergedPayload = compactTombstonePayload(mergedPayload);
      }
      mergedPayload = normalizeStoragePayload(mergedPayload);
      if (!storagePayloadNeedsRewrite(existingPayload, mergedPayload)) {
        continue;
      }

      const updatedAtMs = computeRecordUpdatedAtMs(mergedPayload);
      const deletedAtMs =
        mergedPayload.deleted === true
          ? toMillis(mergedPayload.deletedAt) || toMillis(mergedPayload.updatedAt)
          : toMillis(mergedPayload.deletedAt);
      const restoredAtMs = toMillis(mergedPayload.restoredAt);
      await client.query(
        `
          insert into question_records
            (
              id, updated_at_ms, deleted, payload, source_device,
              server_updated_at, revision, deleted_at_ms, restored_at_ms
            )
          values
            (
              $1, $2, $3, $4::jsonb, $5,
              now(), nextval('question_records_revision_seq'), $6, $7
            )
          on conflict (id) do update set
            updated_at_ms = excluded.updated_at_ms,
            deleted = excluded.deleted,
            payload = excluded.payload,
            source_device = excluded.source_device,
            server_updated_at = now(),
            revision = nextval('question_records_revision_seq'),
            deleted_at_ms = excluded.deleted_at_ms,
            restored_at_ms = excluded.restored_at_ms
        `,
        [
          record.id,
          updatedAtMs,
          mergedPayload.deleted === true,
          JSON.stringify(mergedPayload),
          deviceId,
          deletedAtMs,
          restoredAtMs,
        ]
      );
      changedCount += 1;
    }

    compactedCount = await compactExpiredTombstones(
      client,
      tombstoneCompactCutoffMs
    );
    const generation = await currentGeneration(client);
    await client.query('commit');
    return {
      acceptedCount: coalesced.records.length,
      ignoredCount: coalesced.ignoredCount,
      changedCount,
      compactedCount,
      generation,
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function encodeCursor(generation, afterId) {
  return Buffer.from(
    JSON.stringify({ generation: String(generation), afterId: String(afterId) })
  ).toString('base64url');
}

function decodeCursor(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      !isPlainObject(parsed) ||
      !/^\d+$/.test(String(parsed.generation || '')) ||
      typeof parsed.afterId !== 'string'
    ) {
      throw new Error('bad cursor');
    }
    return {
      generation: String(parsed.generation),
      afterId: parsed.afterId,
    };
  } catch (_error) {
    throw new HttpError(400, 'INVALID_CURSOR');
  }
}

function pageByByteTarget(rows, targetBytes, maxBytes) {
  const selected = [];
  let bytes = 2;
  for (const row of rows) {
    const payload = finalizeMergedPayload(row.payload);
    const recordBytes = Buffer.byteLength(JSON.stringify(payload)) + 1;
    if (selected.length > 0 && bytes + recordBytes > targetBytes) {
      break;
    }
    if (recordBytes > maxBytes) {
      throw new HttpError(413, 'RECORD_TOO_LARGE', {
        id: row.id,
        maxResponseBytes: maxBytes,
      });
    }
    selected.push(payload);
    bytes += recordBytes;
  }
  return selected;
}

async function pullPage(pool, input, limits) {
  const cursor = decodeCursor(input.cursor);
  const requestedLimit = positiveInteger(
    input.limit,
    limits.defaultPageLimit,
    1,
    limits.maxPageLimit
  );
  const requestedBytes = positiveInteger(
    input.maxBytes,
    limits.targetPageBytes,
    64 * 1024,
    limits.maxResponseBytes
  );
  const client = await pool.connect();
  try {
    await client.query('begin isolation level repeatable read read only');
    const generation = await currentGeneration(client);
    if (cursor && cursor.generation !== generation) {
      await client.query('rollback');
      throw new HttpError(409, 'SNAPSHOT_STALE', { generation });
    }

    const snapshotGeneration = cursor?.generation || generation;
    const afterId = cursor?.afterId || '';
    const result = await client.query(
      `
        select id, payload
        from question_records
        where id > $1
        order by id asc
        limit $2
      `,
      [afterId, requestedLimit + 1]
    );
    const candidateRows = result.rows.slice(0, requestedLimit);
    const records = pageByByteTarget(
      candidateRows,
      requestedBytes,
      limits.maxResponseBytes
    );
    const consumedAllCandidates = records.length === candidateRows.length;
    const hasMore =
      !consumedAllCandidates || result.rows.length > requestedLimit;
    const lastId = records.length > 0 ? records[records.length - 1].id : afterId;
    const nextCursor = hasMore
      ? encodeCursor(snapshotGeneration, lastId)
      : null;
    await client.query('commit');
    return {
      generation: snapshotGeneration,
      records,
      nextCursor,
      snapshotComplete: !hasMore,
    };
  } catch (error) {
    try {
      await client.query('rollback');
    } catch (_rollbackError) {
      // Preserve the original error.
    }
    throw error;
  } finally {
    client.release();
  }
}

async function pullLegacySnapshot(pool, limits) {
  const client = await pool.connect();
  try {
    await client.query('begin isolation level repeatable read read only');
    const generation = await currentGeneration(client);
    const result = await client.query(
      'select id, payload from question_records order by id asc'
    );
    const records = result.rows.map((row) =>
      withLegacyImageFields(finalizeMergedPayload(row.payload))
    );
    const responseBytes = Buffer.byteLength(JSON.stringify(records));
    if (responseBytes > limits.maxResponseBytes) {
      await client.query('rollback');
      throw new HttpError(413, 'LEGACY_RESPONSE_TOO_LARGE', {
        protocolVersionRequired: PROTOCOL_VERSION,
        maxResponseBytes: limits.maxResponseBytes,
      });
    }
    await client.query('commit');
    return { generation, records };
  } catch (error) {
    try {
      await client.query('rollback');
    } catch (_rollbackError) {
      // Preserve the original error.
    }
    throw error;
  } finally {
    client.release();
  }
}

async function handleSync(req, res, pool, syncToken, limits) {
  if (!requireAuth(req, res, syncToken)) {
    return;
  }

  let input;
  try {
    input = await readJson(req, limits);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    const code = error instanceof HttpError ? error.code : 'INVALID_JSON';
    sendJson(req, res, status, { error: code, ...(error.details || {}) });
    return;
  }

  const deviceId = getDeviceId(input);
  const isV2 = Number(input.protocolVersion) >= PROTOCOL_VERSION;
  const mode = typeof input.mode === 'string' ? input.mode : '';

  try {
    if (isV2 && mode === 'push') {
      if (!Array.isArray(input.records)) {
        throw new HttpError(400, 'RECORDS_REQUIRED');
      }
      const result = await pushRecords(pool, input.records, deviceId, {
        strict: true,
      });
      sendJson(req, res, 200, {
        ok: true,
        protocolVersion: PROTOCOL_VERSION,
        mode: 'push',
        ...result,
        serverTime: new Date().toISOString(),
      });
      return;
    }

    if (isV2 && mode === 'pull') {
      const result = await pullPage(pool, input, limits);
      sendJson(req, res, 200, {
        ok: true,
        protocolVersion: PROTOCOL_VERSION,
        mode: 'pull',
        ...result,
        serverTime: new Date().toISOString(),
      });
      return;
    }

    if (isV2) {
      throw new HttpError(400, 'INVALID_SYNC_MODE', {
        supportedModes: ['push', 'pull'],
      });
    }

    // Protocol v1 remains available so installed clients keep working until the
    // VPS and both apps have been upgraded. It uses one full request/response.
    const pushResult = await pushRecords(
      pool,
      Array.isArray(input.records) ? input.records : [],
      deviceId
    );
    const snapshot = await pullLegacySnapshot(pool, limits);
    sendJson(req, res, 200, {
      ok: true,
      protocolVersion: 1,
      serverProtocolVersion: PROTOCOL_VERSION,
      serverTime: new Date().toISOString(),
      records: snapshot.records,
      generation: snapshot.generation,
      snapshotComplete: true,
      acceptedCount: pushResult.acceptedCount,
      ignoredCount: pushResult.ignoredCount,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(req, res, error.status, { error: error.code, ...error.details });
      return;
    }
    console.error(error);
    sendJson(req, res, 500, { error: 'SYNC_FAILED' });
  }
}

function createServer(pool, syncToken, options = {}) {
  const limits = getLimits(options.limits);
  return http.createServer((req, res) => {
    const pathname = String(req.url || '').split('?')[0];

    if (req.method === 'GET' && pathname === '/health') {
      sendJson(req, res, 200, capabilityPayload(limits));
      return;
    }

    if (req.method === 'OPTIONS' && pathname === '/api/sync') {
      if (!requireAuth(req, res, syncToken)) {
        return;
      }
      sendJson(req, res, 200, capabilityPayload(limits), {
        allow: 'OPTIONS, POST',
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/sync') {
      void handleSync(req, res, pool, syncToken, limits);
      return;
    }

    sendJson(req, res, 404, { error: 'NOT_FOUND' });
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

  const pool = new Pool({ connectionString: databaseUrl });
  // schema.sql is idempotent and includes ALTER statements for existing VPS data.
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
  CAPABILITIES,
  DEFAULT_LIMITS,
  HttpError,
  PROTOCOL_VERSION,
  canonicalizeImages,
  capabilityPayload,
  compactTombstonePayload,
  computeRecordUpdatedAtMs,
  createServer,
  decodeCursor,
  deriveReviewCount,
  encodeCursor,
  finalizeMergedPayload,
  getLimits,
  getTombstoneCompactCutoffMs,
  legacyFollowUpId,
  mergeQuestionPayload,
  normalizeImageRef,
  normalizeRecord,
  normalizeReviewEvents,
  normalizeStoragePayload,
  pageByByteTarget,
  readJson,
  storagePayloadNeedsRewrite,
  toMillis,
};
