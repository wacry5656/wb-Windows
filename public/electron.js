const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { fileURLToPath, pathToFileURL } = require('url');
const dotenv = require('dotenv');

let mainWindow;

const isDev =
  process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
const DEFAULT_QWEN_BASE_URL =
  'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_QWEN_MODEL = 'qwen3.6-plus';
const DEFAULT_AI_TIMEOUT_MS = 60000;
const DETAILED_EXPLANATION_TIMEOUT_MS = 180000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// Write queue to prevent concurrent file writes and data corruption
let writeQueue = Promise.resolve();

let loadedEnvPath = null;
let resolvedApiKeySource = null;

function getPortableExecutableDirectory() {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;

  if (typeof portableDir !== 'string' || !portableDir.trim()) {
    return null;
  }

  return path.resolve(portableDir.trim());
}

function getUserDataDirectory() {
  try {
    return app.getPath('userData');
  } catch (_error) {
    return path.resolve(process.cwd(), '.wrong-question-assistant');
  }
}

function getMainProcessLogPath() {
  return path.join(getStorageBaseDirectory(), 'main-process.log');
}

function appendMainProcessLog(message, extra) {
  try {
    const logDirectory = getStorageBaseDirectory();
    const timestamp = new Date().toISOString();
    const details =
      typeof extra === 'undefined'
        ? ''
        : ` ${JSON.stringify(extra, null, 2)}`;

    fs.mkdirSync(logDirectory, { recursive: true });
    fs.appendFileSync(
      getMainProcessLogPath(),
      `[${timestamp}] ${message}${details}\n`,
      'utf8'
    );
  } catch (_error) {
    // Avoid crashing the main process because of logging.
  }
}

function getStorageBaseDirectory() {
  if (isDev) {
    return path.resolve(__dirname, '../data');
  }

  const portableDirectory = getPortableExecutableDirectory();

  if (portableDirectory) {
    return path.join(portableDirectory, 'data');
  }

  return path.join(getUserDataDirectory(), 'data');
}

function getQuestionsStorageFilePath() {
  return path.join(getStorageBaseDirectory(), 'questions.json');
}

function getImagesStorageDirectory() {
  return path.join(getStorageBaseDirectory(), 'images');
}

function getLegacyQuestionsStorageFilePath() {
  return path.join(getUserDataDirectory(), 'questions.json');
}

function getLegacyQuestionsStorageFilePaths() {
  const candidates = [getLegacyQuestionsStorageFilePath()];

  if (!isDev) {
    candidates.push(
      path.join(path.dirname(process.execPath), 'data', 'questions.json')
    );
  }

  return [...new Set(candidates.map((filePath) => path.resolve(filePath)))];
}

async function readQuestionsArrayFromFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const rawValue = await fs.promises.readFile(filePath, 'utf8');
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

async function ensureLegacyQuestionsMigrated() {
  const nextStorageFilePath = getQuestionsStorageFilePath();
  const resolvedNextStorageFilePath = path.resolve(nextStorageFilePath);

  if (fs.existsSync(resolvedNextStorageFilePath)) {
    return;
  }

  for (const legacyStorageFilePath of getLegacyQuestionsStorageFilePaths()) {
    if (
      legacyStorageFilePath === resolvedNextStorageFilePath ||
      !fs.existsSync(legacyStorageFilePath)
    ) {
      continue;
    }

    try {
      const legacyQuestions = await readQuestionsArrayFromFile(
        legacyStorageFilePath
      );

      if (legacyQuestions.length === 0) {
        continue;
      }

      await fs.promises.mkdir(path.dirname(resolvedNextStorageFilePath), {
        recursive: true,
      });
      await fs.promises.copyFile(
        legacyStorageFilePath,
        resolvedNextStorageFilePath
      );
      appendMainProcessLog('storage:migrate-legacy-questions', {
        from: legacyStorageFilePath,
        to: resolvedNextStorageFilePath,
        count: legacyQuestions.length,
      });
      return;
    } catch (error) {
      console.warn('Failed to migrate legacy questions storage.', error);
    }
  }
}

function getEnvCandidatePaths() {
  const portableDirectory = getPortableExecutableDirectory();
  const candidateDirectories = [
    portableDirectory,
    portableDirectory ? path.resolve(portableDirectory, '..') : null,
    path.dirname(process.execPath),
    path.resolve(path.dirname(process.execPath), '..'),
    typeof process.resourcesPath === 'string' && process.resourcesPath
      ? process.resourcesPath
      : null,
    getUserDataDirectory(),
    process.cwd(),
    path.resolve(__dirname, '../'),
  ].filter(Boolean);

  const candidatePaths = [];

  for (const directory of candidateDirectories) {
    candidatePaths.push(path.resolve(directory, '.env'));
    candidatePaths.push(path.resolve(directory, '.env.local'));
  }

  return [...new Set(candidatePaths)];
}

function hasConfiguredApiKey(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const normalizedValue = value.trim();

  return Boolean(
    normalizedValue && normalizedValue.toLowerCase() !== 'your_api_key_here'
  );
}

function loadEnvFile() {
  for (const envPath of getEnvCandidatePaths()) {
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const result = dotenv.config({
      path: envPath,
      override: false,
      quiet: true,
    });

    if (
      loadedEnvPath === null &&
      !result.error &&
      result.parsed &&
      Object.keys(result.parsed).length > 0
    ) {
      loadedEnvPath = envPath;
    }
  }

  normalizeApiKeyNames();
  appendMainProcessLog('config:env-loaded', {
    envFilePath: loadedEnvPath,
    keyConfigured: hasConfiguredApiKey(process.env.DASHSCOPE_API_KEY),
    keySource: resolvedApiKeySource,
    candidatePaths: getEnvCandidatePaths(),
  });
}

function normalizeApiKeyNames() {
  const aliases = [
    'DASHSCOPE_API_KEY',
    'QWEN_API_KEY',
    'BAILIAN_API_KEY',
    'ALIYUN_BAILIAN_API_KEY',
  ];

  const matchedKey = aliases.find((keyName) => {
    const value = process.env[keyName];
    return hasConfiguredApiKey(value);
  });

  resolvedApiKeySource = matchedKey ?? null;

  if (matchedKey && !process.env.DASHSCOPE_API_KEY) {
    process.env.DASHSCOPE_API_KEY = process.env[matchedKey];
  }
}

function getApiConfigStatus() {
  const key = process.env.DASHSCOPE_API_KEY;

  return {
    provider: 'qwen',
    envFileLoaded: Boolean(loadedEnvPath),
    envFilePath: loadedEnvPath,
    keyConfigured: hasConfiguredApiKey(key),
    keySource: resolvedApiKeySource,
    storageFilePath: getQuestionsStorageFilePath(),
  };
}

async function loadQuestionsFromFile() {
  await ensureLegacyQuestionsMigrated();
  const storageFilePath = getQuestionsStorageFilePath();

  try {
    return await readQuestionsArrayFromFile(storageFilePath);
  } catch (error) {
    console.warn('Failed to read saved questions from file storage.', error);
    return [];
  }
}

async function saveQuestionsToFile(_event, questions) {
  // Queue writes to prevent concurrent file corruption
  const result = await enqueueWrite(async () => {
    await ensureLegacyQuestionsMigrated();
    const storageFilePath = getQuestionsStorageFilePath();
    const previousQuestions = await readQuestionsArrayFromFile(storageFilePath);
    const nextValue = Array.isArray(questions) ? questions : [];

    await fs.promises.mkdir(path.dirname(storageFilePath), { recursive: true });

    // Atomic write: write to temp file first, then rename
    const tmpFilePath = storageFilePath + '.tmp.' + crypto.randomBytes(4).toString('hex');
    await fs.promises.writeFile(
      tmpFilePath,
      JSON.stringify(nextValue, null, 2),
      'utf8'
    );
    await fs.promises.rename(tmpFilePath, storageFilePath);
    const cleanedImagePaths = await cleanupRemovedImageFiles(
      previousQuestions,
      nextValue
    );

    return {
      success: true,
      storageFilePath,
      cleanedImagePaths,
    };
  });

  return result;
}

async function persistImageToFile(_event, payload) {
  const dataUrl = typeof payload?.dataUrl === 'string' ? payload.dataUrl.trim() : '';
  const kind = payload?.kind === 'note' ? 'note' : 'question';
  const createdAt =
    typeof payload?.createdAt === 'string' && payload.createdAt.trim()
      ? payload.createdAt
      : new Date().toISOString();

  const parsed = parseImageDataUrl(dataUrl);

  if (!parsed) {
    throw new Error('INVALID_IMAGE_DATA');
  }

  validateImageBufferSize(parsed.buffer);

  return enqueueWrite(async () => {
    const imagesDirectory = getImagesStorageDirectory();
    await fs.promises.mkdir(imagesDirectory, { recursive: true });

    const extension = getImageExtension(parsed.mimeType);
    const imageId = createResourceId(`img-${kind}`);
    const filePath = getSafeImageStoragePath(
      imagesDirectory,
      imageId,
      extension
    );

    await fs.promises.writeFile(filePath, parsed.buffer);

    return {
      id: imageId,
      storage: 'file',
      kind,
      uri: pathToFileURL(filePath).href,
      createdAt,
      mimeType: parsed.mimeType,
    };
  });
}

async function readImageDataUrlFromFile(_event, payload) {
  const uri = typeof payload?.uri === 'string' ? payload.uri.trim() : '';
  if (!uri) {
    throw new Error('MISSING_IMAGE_URI');
  }

  const resolvedPath = resolveImageFilePath(uri);
  const buffer = await fs.promises.readFile(resolvedPath);
  const mimeType = getMimeTypeFromPath(resolvedPath);

  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

async function materializeImageRefForSync(ref) {
  if (!ref || typeof ref !== 'object') {
    return ref;
  }

  if (ref.storage === 'inline' && typeof ref.dataUrl === 'string') {
    return ref;
  }

  const uri = typeof ref.uri === 'string' ? ref.uri : '';
  if (!isFileImageUri(uri)) {
    return ref;
  }

  try {
    const filePath = resolveImageFilePath(uri, { requireExists: true });
    const buffer = await fs.promises.readFile(filePath);
    const mimeType = ref.mimeType || getMimeTypeFromPath(filePath);
    return {
      id: ref.id,
      kind: ref.kind,
      createdAt: ref.createdAt,
      mimeType,
      storage: 'inline',
      dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
    };
  } catch (error) {
    appendMainProcessLog('sync:image-inline-skip', {
      id: ref.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return ref;
  }
}

async function materializeRemoteImageRefForLocalStorage(ref) {
  if (!ref || typeof ref !== 'object') {
    return ref;
  }

  const dataUrl = typeof ref.dataUrl === 'string' ? ref.dataUrl.trim() : '';
  if (ref.storage !== 'inline' || !dataUrl) {
    return ref;
  }

  const parsed = parseImageDataUrl(dataUrl);
  if (!parsed) {
    return ref;
  }

  validateImageBufferSize(parsed.buffer);

  return enqueueWrite(async () => {
    const imagesDirectory = getImagesStorageDirectory();
    await fs.promises.mkdir(imagesDirectory, { recursive: true });

    const imageId = getSafeImageId(
      ref.id,
      `img-${ref.kind === 'note' ? 'note' : 'question'}`
    );
    const extension = getImageExtension(ref.mimeType || parsed.mimeType);
    const filePath = getSafeImageStoragePath(
      imagesDirectory,
      imageId,
      extension
    );

    await fs.promises.writeFile(filePath, parsed.buffer);

    return {
      id: imageId,
      storage: 'file',
      kind: ref.kind === 'note' ? 'note' : 'question',
      uri: pathToFileURL(filePath).href,
      createdAt:
        typeof ref.createdAt === 'string' && ref.createdAt.trim()
          ? ref.createdAt
          : new Date().toISOString(),
      mimeType: ref.mimeType || parsed.mimeType,
    };
  });
}

async function materializeQuestionForSync(question) {
  if (!question || typeof question !== 'object') {
    return question;
  }

  const imageRefs = Array.isArray(question.imageRefs)
    ? await Promise.all(question.imageRefs.map(materializeImageRefForSync))
    : [];
  const noteImageRefs = Array.isArray(question.noteImageRefs)
    ? await Promise.all(question.noteImageRefs.map(materializeImageRefForSync))
    : [];
  const firstQuestionImage = imageRefs[0];
  const legacyImage =
    typeof firstQuestionImage?.dataUrl === 'string'
      ? firstQuestionImage.dataUrl
      : question.image;

  return {
    ...question,
    image: legacyImage,
    imageRefs,
    noteImages: noteImageRefs
      .map((ref) => (typeof ref?.dataUrl === 'string' ? ref.dataUrl : null))
      .filter(Boolean),
    noteImageRefs,
  };
}

async function materializeRemoteQuestionForLocalStorage(question) {
  if (!question || typeof question !== 'object') {
    return question;
  }

  const imageRefs = Array.isArray(question.imageRefs)
    ? await Promise.all(question.imageRefs.map(materializeRemoteImageRefForLocalStorage))
    : [];
  const noteImageRefs = Array.isArray(question.noteImageRefs)
    ? await Promise.all(question.noteImageRefs.map(materializeRemoteImageRefForLocalStorage))
    : [];

  return {
    ...question,
    image: imageRefs[0]?.uri || imageRefs[0]?.dataUrl || question.image,
    imageRefs,
    noteImages: noteImageRefs
      .map((ref) => (typeof ref?.uri === 'string' ? ref.uri : typeof ref?.dataUrl === 'string' ? ref.dataUrl : null))
      .filter(Boolean),
    noteImageRefs,
  };
}

async function syncQuestionsWithServer(_event, questions) {
  loadEnvFile();
  const syncApiUrl = process.env.SYNC_API_URL?.trim();
  const syncToken = process.env.SYNC_TOKEN?.trim();
  const deviceId = process.env.SYNC_DEVICE_ID?.trim() || `windows-${require('os').hostname()}`;

  if (!syncApiUrl) {
    appendMainProcessLog('sync:error', {
      message: 'SYNC_API_URL_NOT_CONFIGURED',
      deviceId,
      uploadedCount: Array.isArray(questions) ? questions.length : 0,
    });
    throw new Error('SYNC_API_URL_NOT_CONFIGURED');
  }

  if (!syncToken) {
    appendMainProcessLog('sync:error', {
      message: 'SYNC_TOKEN_NOT_CONFIGURED',
      url: syncApiUrl,
      deviceId,
      uploadedCount: Array.isArray(questions) ? questions.length : 0,
    });
    throw new Error('SYNC_TOKEN_NOT_CONFIGURED');
  }

  const nextQuestions = Array.isArray(questions) ? questions : [];
  const records = await Promise.all(nextQuestions.map(materializeQuestionForSync));
  const uploadedCount = records.length;

  appendMainProcessLog('sync:start', {
    url: syncApiUrl,
    deviceId,
    uploadedCount,
  });

  try {
    const response = await fetchWithTimeout(
      syncApiUrl,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${syncToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          deviceId,
          records,
        }),
      },
      120000
    );

    const responseText = await response.text();
    let responseJson = null;
    try {
      responseJson = JSON.parse(responseText);
    } catch (_error) {
      responseJson = null;
    }

    if (!response.ok) {
      const error = new Error('SYNC_REQUEST_FAILED');
      error.status = response.status;
      error.details = responseJson ?? responseText;
      appendMainProcessLog('sync:error', {
        url: syncApiUrl,
        deviceId,
        uploadedCount,
        status: response.status,
        details: responseJson ?? responseText,
      });
      throw error;
    }

    if (!responseJson || !Object.prototype.hasOwnProperty.call(responseJson, 'records')) {
      appendMainProcessLog('sync:error', {
        url: syncApiUrl,
        deviceId,
        uploadedCount,
        message: 'SYNC_INVALID_RESPONSE',
        details: responseJson ?? responseText,
      });
      throw new Error('SYNC_INVALID_RESPONSE');
    }

    if (!Array.isArray(responseJson.records)) {
      appendMainProcessLog('sync:error', {
        url: syncApiUrl,
        deviceId,
        uploadedCount,
        message: 'SYNC_INVALID_RECORDS',
        details: responseJson.records,
      });
      throw new Error('SYNC_INVALID_RECORDS');
    }

    if (uploadedCount > 0 && responseJson.records.length === 0) {
      appendMainProcessLog('sync:error', {
        url: syncApiUrl,
        deviceId,
        uploadedCount,
        receivedCount: 0,
        message: 'SYNC_EMPTY_REMOTE',
      });
      throw new Error('SYNC_EMPTY_REMOTE');
    }

    const remoteRecords = await Promise.all(
      responseJson.records.map(materializeRemoteQuestionForLocalStorage)
    );

    appendMainProcessLog('sync:success', {
      url: syncApiUrl,
      deviceId,
      uploadedCount,
      receivedCount: remoteRecords.length,
      serverTime: responseJson?.serverTime,
    });

    return {
      ok: true,
      serverTime: responseJson?.serverTime,
      records: remoteRecords,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      ![
        'SYNC_REQUEST_FAILED',
        'SYNC_INVALID_RESPONSE',
        'SYNC_INVALID_RECORDS',
        'SYNC_EMPTY_REMOTE',
      ].includes(error.message)
    ) {
      appendMainProcessLog('sync:error', {
        url: syncApiUrl,
        deviceId,
        uploadedCount,
        message: error.message,
      });
    }
    throw error;
  }
}

const MAX_WRITE_QUEUE_LENGTH = 50;
let writeQueueLength = 0;

function enqueueWrite(fn) {
  if (writeQueueLength >= MAX_WRITE_QUEUE_LENGTH) {
    return Promise.reject(new Error('WRITE_QUEUE_FULL'));
  }
  writeQueueLength++;
  writeQueue = writeQueue.then(fn, fn).finally(() => {
    writeQueueLength--;
  });
  return writeQueue;
}

function parseImageDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);

  if (!match) {
    return null;
  }

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  };
}

function validateImageBufferSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('IMAGE_TOO_LARGE');
  }
}

function getSafeImageId(value, fallbackPrefix) {
  const candidate = typeof value === 'string' ? value.trim() : '';

  if (
    candidate &&
    candidate !== '.' &&
    candidate !== '..' &&
    path.basename(candidate) === candidate &&
    /^[a-zA-Z0-9._-]+$/.test(candidate)
  ) {
    return candidate;
  }

  return createResourceId(fallbackPrefix);
}

function getSafeImageStoragePath(imagesDirectory, imageId, extension) {
  const resolvedImagesDirectory = path.resolve(imagesDirectory);
  const filePath = path.resolve(
    resolvedImagesDirectory,
    `${imageId}.${extension}`
  );
  const relativePath = path.relative(resolvedImagesDirectory, filePath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('INVALID_IMAGE_PATH');
  }

  return filePath;
}

function getImageExtension(mimeType) {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return 'bin';
  }
}

function getMimeTypeFromPath(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

function resolveImageFilePath(uri, options = {}) {
  const requireExists = options.requireExists !== false;
  const imagesDirectory = path.resolve(getImagesStorageDirectory());
  const resolvedPath = path.resolve(
    uri.startsWith('file://') ? fileURLToPath(uri) : uri
  );
  const relativePath = path.relative(imagesDirectory, resolvedPath);

  if (
    relativePath.startsWith('..') ||
    path.isAbsolute(relativePath) ||
    (requireExists && !fs.existsSync(resolvedPath))
  ) {
    throw new Error('INVALID_IMAGE_URI');
  }

  return resolvedPath;
}

function collectReferencedFileImageUris(questions) {
  if (!Array.isArray(questions)) {
    return new Set();
  }

  const uris = new Set();

  for (const question of questions) {
    if (!question || typeof question !== 'object') {
      continue;
    }

    if (isFileImageUri(question.image)) {
      uris.add(question.image);
    }

    if (Array.isArray(question.noteImages)) {
      for (const noteImage of question.noteImages) {
        if (isFileImageUri(noteImage)) {
          uris.add(noteImage);
        }
      }
    }

    collectFileUrisFromRefs(question.imageRefs, uris);
    collectFileUrisFromRefs(question.noteImageRefs, uris);
  }

  return uris;
}

function collectFileUrisFromRefs(refs, uris) {
  if (!Array.isArray(refs)) {
    return;
  }

  for (const ref of refs) {
    if (
      ref &&
      typeof ref === 'object' &&
      (ref.storage === 'file' || typeof ref.uri === 'string') &&
      isFileImageUri(ref.uri)
    ) {
      uris.add(ref.uri);
    }
  }
}

function isFileImageUri(value) {
  return typeof value === 'string' && /^file:\/\//i.test(value);
}

async function cleanupRemovedImageFiles(previousQuestions, nextQuestions) {
  const previousUris = collectReferencedFileImageUris(previousQuestions);
  const nextUris = collectReferencedFileImageUris(nextQuestions);
  const removedUris = [...previousUris].filter((uri) => !nextUris.has(uri));
  const cleanedImagePaths = [];

  for (const uri of removedUris) {
    try {
      const filePath = resolveImageFilePath(uri, { requireExists: false });
      await fs.promises.unlink(filePath);
      cleanedImagePaths.push(filePath);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        continue;
      }

      appendMainProcessLog('storage:cleanup-image-skip', {
        uri,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return cleanedImagePaths;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort(new Error('TIMEOUT'));
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') {
      throw new Error('TIMEOUT');
    }

    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function createResourceId(prefix) {
  if (typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function buildAnalysisPrompt(payload = {}) {
  const title =
    typeof payload?.title === 'string' && payload.title.trim()
      ? payload.title.trim()
      : '未命名题目';
  const subject =
    typeof payload?.subject === 'string' && payload.subject.trim()
      ? payload.subject.trim()
      : '未识别学科';
  const supplementalContext = buildSupplementalContext(payload);

  return [
    '你是一名中国高中理科老师，请像批改错题一样分析题目。',
    '',
    '请根据用户提供的题目图片进行分析，并严格按照 JSON 格式输出结果。',
    `题目标题：${title}`,
    `学科：${subject}`,
    supplementalContext,
    '',
    '【最高优先级要求】',
    '1. 只输出 JSON，不要输出任何解释、注释、markdown、前后缀。',
    '2. 只保留指定字段，所有字段必须存在。',
    '3. 所有内容必须结合题目图片中的具体条件，不允许输出泛化、模板化内容。',
    '4. 不允许编造题目中不存在的信息。',
    '5. 如果题目部分无法识别，请基于可见信息分析，并在对应字段里写明需要确认的条件。',
    '',
    '输出格式：',
    '{',
    '  "knowledge_points": [],',
    '  "common_mistakes": [],',
    '  "solution_methods": [],',
    '  "difficulty": 1,',
    '  "cautions": []',
    '}',
    '',
    '字段要求：',
    'knowledge_points：本题真正考查的知识点，常规题 2 到 3 条，复杂题最多 5 条。必须具体到题目里的模型、公式、图像、实验条件或限制。',
    'common_mistakes：这道题最容易犯的具体错误，常规题 2 到 3 条。不要写“粗心”“审题不清”“计算错误”这类空话。',
    'solution_methods：推荐方法，像老师给学生指出解题抓手，1 到 3 条。要能直接指导下一次做同类题。',
    'difficulty：1 到 5 的整数。1 是很基础，2 是基础题，3 是中等题，4 是较难题，5 是难题。',
    'cautions：解题时要特别盯住的关键条件、边界、单位、图像信息、实验条件或限制，常规题 2 到 3 条。',
    '所有数组至少 1 条。每条用自然中文短句，不要编号，不要项目符号，不要多余特殊符号。',
    '不同字段之间不要重复表达同一个意思。宁可少写，也不要凑数量。',
  ].join('\n');
}

function buildDetailedExplanationPrompt(payload) {
  const title =
    typeof payload?.title === 'string' && payload.title.trim()
      ? payload.title.trim()
      : '未命名题目';
  const subject =
    typeof payload?.subject === 'string' && payload.subject.trim()
      ? payload.subject.trim()
      : '未识别学科';
  const supplementalContext = buildSupplementalContext(payload);

  return [
    '你是一名中国高中理科老师，请根据题目图片生成详细讲解。',
    '',
    '重要要求（必须严格遵守）：',
    '1. 输出必须是纯文本，不要使用 markdown 格式',
    '2. 不要使用任何特殊符号，包括：###、##、#、**、*、```、>、- 等',
    '3. 不要使用加粗、标题语法、代码块',
    '4. 不要输出“你好”“我们来分析”等寒暄内容',
    '5. 直接从讲解内容开始',
    '6. 全文只能使用简体中文表达，不允许输出英文单词、英文句子或中英夹杂解释',
    '7. 涉及公式、符号、变量时可以保留必要的数学字母或物理符号，例如 x、y、sin、cos、R、m、v，但解释这些公式时仍必须使用中文',
    '8. 如果你脑中先想到英文表述，必须先完整翻译成自然中文后再输出，不能把翻译过程写出来',
    '',
    `题目标题：${title}`,
    `预估学科：${subject}`,
    supplementalContext,
    '',
    '输出结构如下（使用普通文本表达）：',
    '题型判断：',
    '（判断题目属于哪个学科，并说明考查的核心知识点）',
    '',
    '解题思路：',
    '（说明整体思路，用通俗语言解释为什么这样做）',
    '',
    '详细步骤：',
    '1. ...',
    '2. ...',
    '3. ...',
    '',
    '易错提醒：',
    '1. ...',
    '2. ...',
    '',
    '方法总结：',
    '（总结这一类题的通用解法或规律）',
    '',
    '补充要求：',
    '语言要清晰，适合高中生理解。',
    '每一步都要说明为什么这样做。',
    '不要只给结论，重点讲过程。',
    '如果题目条件不完整或图片不清晰，要明确指出不确定之处。',
    '不要编造不存在的条件。',
    '除公式和变量外，禁止出现英文。',
  ].join('\n');
}

function buildHintPrompt() {
  return [
    '你是一名中国高中理科老师，请根据题目图片给出“思路指引”。',
    '',
    '要求：',
    '1. 只给解题方向，不给完整解法',
    '2. 不要给最终答案',
    '3. 不要展开详细步骤',
    '4. 语言要像老师在点拨',
    '5. 必须结合这道题本身的条件',
    '6. 避免空话，例如“认真审题”“注意计算”',
    '7. 控制在 2 到 5 句话内',
    '8. 优先输出简洁中文，不要 markdown，不要标题，不要编号',
    '9. 除公式、变量、必要符号外，禁止输出英文单词和英文句子',
    '',
    '输出目标：',
    '帮助学生继续独立思考，而不是直接看答案。',
  ].join('\n');
}

function buildSupplementalContext(payload = {}) {
  const questionText =
    typeof payload?.questionText === 'string' ? payload.questionText.trim() : '';
  const userAnswer =
    typeof payload?.userAnswer === 'string' ? payload.userAnswer.trim() : '';
  const correctAnswer =
    typeof payload?.correctAnswer === 'string' ? payload.correctAnswer.trim() : '';

  const lines = [];

  if (questionText) {
    lines.push(`补充题干：${questionText}`);
  }

  if (userAnswer) {
    lines.push(`学生作答：${userAnswer}`);
  }

  if (correctAnswer) {
    lines.push(`标准答案：${correctAnswer}`);
  }

  if (lines.length === 0) {
    return '';
  }

  return ['补充文本信息：', ...lines].join('\n');
}

function normalizeStringArray(value, maxLength) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, maxLength);
}

function ensureNonEmptyArray(items, fallbackItem) {
  return items.length > 0 ? items : [fallbackItem];
}

function clampDifficulty(value) {
  const difficulty = Number(value);

  if (!Number.isInteger(difficulty)) {
    return 3;
  }

  return Math.min(5, Math.max(1, difficulty));
}

function extractJsonString(content) {
  if (typeof content !== 'string') {
    return null;
  }

  const trimmed = content.trim();

  if (!trimmed) {
    return null;
  }

  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch (_error) {
    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fencedMatch?.[1]) {
      return fencedMatch[1].trim();
    }

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return trimmed.slice(firstBrace, lastBrace + 1);
    }
  }

  return trimmed;
}

function extractTextContent(content) {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((item) => {
      if (typeof item?.text === 'string') {
        return item.text;
      }

      if (typeof item === 'string') {
        return item;
      }

      return '';
    })
    .join('\n')
    .trim();
}

function normalizeHintText(text) {
  if (typeof text !== 'string') {
    return '';
  }

  return text
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[>*#`]/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function normalizeAnalysisPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('INVALID_JSON');
  }
  const knowledgePoints = ensureNonEmptyArray(
    normalizeStringArray(payload.knowledge_points, 5),
    '需结合题面进一步确认核心知识点'
  );
  const commonMistakes = ensureNonEmptyArray(
    normalizeStringArray(payload.common_mistakes, 5),
    '需结合题目条件检查关键步骤是否遗漏'
  );
  const cautions = ensureNonEmptyArray(
    normalizeStringArray(payload.cautions, 5),
    '需结合题面条件核对已知量与约束条件'
  );
  const solutionMethods = ensureNonEmptyArray(
    normalizeStringArray(payload.solution_methods, 5),
    '先分析题目条件，再按模型分步求解'
  );
  return {
    knowledge_points: knowledgePoints,
    common_mistakes: commonMistakes,
    solution_methods: solutionMethods,
    difficulty: clampDifficulty(payload.difficulty),
    cautions,
  };
}

// 构造发给模型的用户消息内容：有图片时用图文数组，纯文字错题则只发文本
function buildAiUserContent(image, text) {
  if (!image) {
    return text;
  }

  return [
    {
      type: 'image_url',
      image_url: {
        url: image,
      },
    },
    {
      type: 'text',
      text,
    },
  ];
}

async function generateQuestionAnalysis(_event, payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('INVALID_PAYLOAD');
  }

  const image = typeof payload.image === 'string' ? payload.image.trim() : '';
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  const subject = typeof payload.subject === 'string' ? payload.subject.trim() : '';

  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();

  if (!apiKey) {
    appendMainProcessLog('analysis:missing-api-key', {
      envFilePath: loadedEnvPath,
      keySource: resolvedApiKeySource,
    });
    throw new Error('MISSING_API_KEY');
  }

  const model = process.env.QWEN_MODEL?.trim() || DEFAULT_QWEN_MODEL;
  const baseUrl =
    process.env.DASHSCOPE_BASE_URL?.trim() || DEFAULT_QWEN_BASE_URL;

  appendMainProcessLog('analysis:generate:start', {
    model,
    imagePrefix: image.slice(0, 32),
    imageLength: image.length,
    title,
    subject,
    hasQuestionText: Boolean(payload.questionText),
    hasUserAnswer: Boolean(payload.userAnswer),
    hasCorrectAnswer: Boolean(payload.correctAnswer),
  });

  const response = await fetchWithTimeout(
    `${baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        enable_thinking: false,
        temperature: 0.2,
        response_format: {
          type: 'json_object',
        },
        messages: [
          {
            role: 'system',
            content: '你是一个严格只返回 JSON 的错题分析助手。',
          },
          {
            role: 'user',
            content: buildAiUserContent(image, buildAnalysisPrompt(payload)),
          },
        ],
      }),
    },
    DEFAULT_AI_TIMEOUT_MS
  );

  const responseText = await response.text();
  let responseJson = null;

  try {
    responseJson = JSON.parse(responseText);
  } catch (_error) {
    responseJson = null;
  }

  if (!response.ok) {
    const error = new Error('QWEN_API_REQUEST_FAILED');
    error.details = responseJson ?? responseText;
    error.status = response.status;
    appendMainProcessLog('analysis:generate:error', {
      status: response.status,
      details: responseJson ?? responseText,
    });
    throw error;
  }

  const content = responseJson?.choices?.[0]?.message?.content;
  const jsonString = extractJsonString(
    Array.isArray(content)
      ? content
          .map((item) => (typeof item?.text === 'string' ? item.text : ''))
          .join('\n')
      : content
  );

  if (!jsonString) {
    throw new Error('INVALID_JSON');
  }

  try {
    const normalized = normalizeAnalysisPayload(JSON.parse(jsonString));
    appendMainProcessLog('analysis:generate:success', {
      knowledgePointsCount: normalized.knowledge_points.length,
      commonMistakesCount: normalized.common_mistakes.length,
      cautionsCount: normalized.cautions.length,
      solutionMethodsCount: normalized.solution_methods.length,
    });
    return normalized;
  } catch (_error) {
    appendMainProcessLog('analysis:generate:invalid-json', {
      content: jsonString,
    });
    throw new Error('INVALID_JSON');
  }
}

async function generateQuestionExplanation(_event, payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('INVALID_PAYLOAD');
  }

  const image = typeof payload.image === 'string' ? payload.image.trim() : '';
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  const subject = typeof payload.subject === 'string' ? payload.subject.trim() : '';

  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();

  if (!apiKey) {
    appendMainProcessLog('explanation:missing-api-key', {
      envFilePath: loadedEnvPath,
      keySource: resolvedApiKeySource,
    });
    throw new Error('MISSING_API_KEY');
  }

  const model = process.env.QWEN_MODEL?.trim() || DEFAULT_QWEN_MODEL;
  const baseUrl =
    process.env.DASHSCOPE_BASE_URL?.trim() || DEFAULT_QWEN_BASE_URL;

  appendMainProcessLog('explanation:generate:start', {
    model,
    imagePrefix: image.slice(0, 32),
    imageLength: image.length,
    title,
    subject,
    hasQuestionText: Boolean(payload.questionText),
    hasUserAnswer: Boolean(payload.userAnswer),
    hasCorrectAnswer: Boolean(payload.correctAnswer),
  });

  const response = await fetchWithTimeout(
    `${baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        enable_thinking: true,
        temperature: 0.4,
        messages: [
          {
            role: 'system',
            content: [
              '你是一名中国高中理科老师，擅长给学生讲清楚解题过程。',
              '回答必须是自然、完整的简体中文。',
              '输出必须是纯文本自然段，不要使用 markdown 格式。',
              '禁止使用标题符号、加粗符号、列表符号、引用符号、代码块或分隔线。',
              '禁止输出这些装饰字符：###、##、#、**、*、```、>、-、•。',
              '不要用“一、二、三”或“1. 2. 3.”组织答案，改用自然段承接。',
              '严禁输出英文句子、英文段落或中英夹杂解释。',
              '只有公式、变量、单位、函数名中允许保留必要字母。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: buildAiUserContent(image, buildDetailedExplanationPrompt(payload)),
          },
        ],
      }),
    },
    DETAILED_EXPLANATION_TIMEOUT_MS
  );

  const responseText = await response.text();
  let responseJson = null;

  try {
    responseJson = JSON.parse(responseText);
  } catch (_error) {
    responseJson = null;
  }

  if (!response.ok) {
    const error = new Error('QWEN_EXPLANATION_REQUEST_FAILED');
    error.details = responseJson ?? responseText;
    error.status = response.status;
    appendMainProcessLog('explanation:generate:error', {
      status: response.status,
      details: responseJson ?? responseText,
    });
    throw error;
  }

  const explanation = extractTextContent(
    responseJson?.choices?.[0]?.message?.content
  );

  if (!explanation) {
    appendMainProcessLog('explanation:generate:empty');
    throw new Error('EMPTY_EXPLANATION');
  }

  appendMainProcessLog('explanation:generate:success', {
    length: explanation.length,
  });

  return {
    explanation,
  };
}

async function generateQuestionHint(_event, payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('INVALID_PAYLOAD');
  }

  const image = typeof payload.image === 'string' ? payload.image.trim() : '';
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  const subject = typeof payload.subject === 'string' ? payload.subject.trim() : '';

  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();

  if (!apiKey) {
    appendMainProcessLog('hint:missing-api-key', {
      envFilePath: loadedEnvPath,
      keySource: resolvedApiKeySource,
    });
    throw new Error('MISSING_API_KEY');
  }

  const model = process.env.QWEN_MODEL?.trim() || DEFAULT_QWEN_MODEL;
  const baseUrl =
    process.env.DASHSCOPE_BASE_URL?.trim() || DEFAULT_QWEN_BASE_URL;

  appendMainProcessLog('hint:generate:start', {
    model,
    imagePrefix: image.slice(0, 32),
    imageLength: image.length,
    title,
    subject,
    hasQuestionText: Boolean(payload.questionText),
    hasUserAnswer: Boolean(payload.userAnswer),
    hasCorrectAnswer: Boolean(payload.correctAnswer),
  });

  const response = await fetchWithTimeout(
    `${baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        enable_thinking: false,
        temperature: 0.4,
        messages: [
          {
            role: 'system',
            content: [
              '你是一名中国高中理科老师，擅长用简短提示点拨学生继续思考。',
              '输出必须是纯文本自然段，不要使用 markdown、标题、列表、加粗、引用、代码块或分隔线。',
              '禁止输出这些装饰字符：###、##、#、**、*、```、>、-、•。',
              '不要编号，不要项目符号，只用几句连贯中文提示。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: buildAiUserContent(
              image,
              [buildHintPrompt(), '', `题目标题：${title || '未命名题目'}`, `预估学科：${subject || '未识别学科'}`].join('\n')
            ),
          },
        ],
      }),
    },
    DEFAULT_AI_TIMEOUT_MS
  );

  const responseText = await response.text();
  let responseJson = null;

  try {
    responseJson = JSON.parse(responseText);
  } catch (_error) {
    responseJson = null;
  }

  if (!response.ok) {
    const error = new Error('QWEN_HINT_REQUEST_FAILED');
    error.details = responseJson ?? responseText;
    error.status = response.status;
    appendMainProcessLog('hint:generate:error', {
      status: response.status,
      details: responseJson ?? responseText,
    });
    throw error;
  }

  const hint = normalizeHintText(
    extractTextContent(responseJson?.choices?.[0]?.message?.content)
  );

  if (!hint) {
    appendMainProcessLog('hint:generate:empty');
    throw new Error('EMPTY_HINT');
  }

  appendMainProcessLog('hint:generate:success', {
    length: hint.length,
  });

  return {
    hint,
  };
}

function analyzeConversationMood(chatHistory, currentMessage) {
  const SHORT_RESPONSES = /^(嗯+|哦+|啊+|哈+|嘿+|额+|诶+|噢+|唔+|呐+|喔+|呃+|哎+|唉+|嗯|哦|啊|哈|嘿|额|诶|噢|唔|呐|喔|呃|哎|唉)+$/;
  const BORING_RESPONSES = /^(好的|知道了|嗯嗯|哦哦|行吧|随便|无所谓|都行|ok|OK|还可以|一般般|还行|不懂|不会|不知道|没想法|没事|对|是|嗯好的|好滴|收到|明白|了解了|确实|是的|对啊|就是)$/;
  const NEGATIVE_RESPONSES = /^(无聊|烦|不想|算了|没意思|别问了|够了|不想听|别说了|懒得|没空|不想学|滚|走开|闭嘴|烦死了|讨厌|别烦我|不想理你|哼|不想聊天|你好烦|再问就不理你了)$/;
  const ENTHUSIASTIC_RESPONSES = /^(真的吗|哇|好厉害|太棒了|原来如此|我懂了|谢谢|终于明白了|学到了|有意思|继续说|然后呢|还有吗|讲讲|再讲讲|具体说说|展开说说|详细点|举个例子|怎么做)$/;
  const QUESTION_RESPONSES = /^(为什么|怎么回事|怎么|为啥|啥意思|什么|是不是|能不能|对吗|如何|哪|哪个|怎样|多少|什么时候|谁|帮我|帮我看看)$/;
  const GREETING_RESPONSES = /^(嗨|嘿|你好|hi|Hi|HI|在吗|在不在|你在吗|hello|Hello|早|晚安|上午好|下午好|晚上好|在干嘛|干嘛呢|你在干嘛|起床了|回来了|我回来了)$/;
  const NEEDY_RESPONSES = /^(陪我|聊会|聊聊天|聊聊|和我说|跟我说|讲给我|陪我聊聊|陪我说话|别走|不要走|不要离开|留一下|等一下|等会儿|别挂|继续|再聊|还没聊完)$/;
  const AGREEMENT_RESPONSES = /^(对|是的|没错|嗯|好的|行|ok|OK|嗯好|好|同意|可以|对的|是|嗯呢|嗯啊|好哒|好滴|没问题)$/;

  const recentHistory = chatHistory.slice(-8);
  let consecutiveShort = 0;
  let consecutiveBoring = 0;
  let hasNegative = false;
  let hasEnthusiastic = false;
  let hasQuestion = false;
  let hasGreeting = false;
  let hasNeedy = false;
  let totalUserMessages = 0;
  let shortMessageRatio = 0;

  for (let i = recentHistory.length - 1; i >= 0; i--) {
    const msg = recentHistory[i];
    if (msg.role !== 'user' || typeof msg.content !== 'string') continue;
    totalUserMessages++;
    const text = msg.content.trim();
    if (SHORT_RESPONSES.test(text) || BORING_RESPONSES.test(text) || AGREEMENT_RESPONSES.test(text)) {
      consecutiveShort++;
    } else if (text.length <= 5) {
      consecutiveShort++;
    } else {
      break;
    }
  }

  for (const msg of recentHistory) {
    if (msg.role !== 'user' || typeof msg.content !== 'string') continue;
    const text = msg.content.trim();
    if (BORING_RESPONSES.test(text) || AGREEMENT_RESPONSES.test(text)) consecutiveBoring++;
    if (NEGATIVE_RESPONSES.test(text)) hasNegative = true;
    if (ENTHUSIASTIC_RESPONSES.test(text)) hasEnthusiastic = true;
    if (QUESTION_RESPONSES.test(text)) hasQuestion = true;
    if (GREETING_RESPONSES.test(text)) hasGreeting = true;
    if (NEEDY_RESPONSES.test(text)) hasNeedy = true;
  }

  if (totalUserMessages > 0) {
    shortMessageRatio = consecutiveShort / totalUserMessages;
  }

  const isCurrentShort = SHORT_RESPONSES.test(currentMessage.trim()) || BORING_RESPONSES.test(currentMessage.trim()) || AGREEMENT_RESPONSES.test(currentMessage.trim());
  const isCurrentNegative = NEGATIVE_RESPONSES.test(currentMessage.trim());
  const isCurrentEnthusiastic = ENTHUSIASTIC_RESPONSES.test(currentMessage.trim());
  const isCurrentQuestion = QUESTION_RESPONSES.test(currentMessage.trim());
  const isCurrentGreeting = GREETING_RESPONSES.test(currentMessage.trim());
  const isCurrentNeedy = NEEDY_RESPONSES.test(currentMessage.trim());
  const isCurrentVeryShort = currentMessage.trim().length <= 3;
  const isCurrentLong = currentMessage.trim().length > 30;

  return {
    consecutiveShort,
    consecutiveBoring,
    hasNegative,
    hasEnthusiastic,
    hasQuestion,
    hasGreeting,
    hasNeedy,
    totalUserMessages,
    shortMessageRatio,
    isCurrentShort,
    isCurrentNegative,
    isCurrentEnthusiastic,
    isCurrentQuestion,
    isCurrentGreeting,
    isCurrentNeedy,
    isCurrentVeryShort,
    isCurrentLong,
  };
}

function buildMoodContext(mood) {
  const parts = [];

  if (mood.isCurrentNegative) {
    parts.push('【重要：对方明显不耐烦或心情不好】不要长篇大论，可以冷淡回应，给空间。回短的就行，比如"哦""嗯""那好吧"，或者干脆不展开。');
    return parts.join('\n');
  }

  if (mood.consecutiveShort >= 4) {
    parts.push('【你被连续敷衍了很多次，明显有点不高兴了】可以只回"嗯"或者"哦"，也可以半开玩笑地挑明："你是不是不想聊？""行吧随你"。语气冷淡一点。');
  } else if (mood.consecutiveShort === 3) {
    parts.push('【连续三条短消息，你有点被敷衍的感觉】可以稍微表达不满："你就嗯？""你是不是在应付我？"也可以就冷冷回个"哦"。');
  } else if (mood.consecutiveShort === 2) {
    parts.push('【对方连续两次回复很短】也许对方在忙，你可以顺便问一嘴"忙？""在干嘛呢~"，也可以自然地也回短一点。');
  } else if (mood.consecutiveShort === 1 && mood.isCurrentShort) {
    parts.push('【对方这条比较短】不清不楚是不是在敷衍你，也可能是忙。自然应对就好，不用太在意。');
  }

  if (mood.consecutiveBoring >= 3) {
    parts.push('对方一直在敷衍式回复，觉得聊天有点无聊了。可以主动换个话题或者调侃一句"我们的聊天质量堪忧啊"。');
  } else if (mood.consecutiveBoring === 2) {
    parts.push('对方有点敷衍，聊天比较干。可以试着找点有意思的说。');
  }

  if (mood.shortMessageRatio > 0.6 && mood.totalUserMessages >= 3) {
    parts.push('整体聊天气氛比较平淡，大部分回复都短。');
  }

  if (mood.isCurrentEnthusiastic) {
    parts.push('【积极信号】对方很感兴趣，你可以活泼一点，多说两句。');
  } else if (mood.hasEnthusiastic && !mood.isCurrentShort) {
    parts.push('对方之前有认真聊过，气氛还行。');
  }

  if (mood.isCurrentQuestion) {
    parts.push('【对方在提问】认真答但用聊天口吻，可以边想边说。');
  }

  if (mood.isCurrentGreeting) {
    parts.push('【对方在打招呼】轻松回应就好。');
  }

  if (mood.isCurrentNeedy) {
    parts.push('【对方想找你聊】可以温柔一点，陪ta聊。');
  }

  if (mood.isCurrentLong && !mood.isCurrentShort) {
    parts.push('对方这条很长，说明在认真聊，你也要认真回应。');
  }

  if (mood.isCurrentVeryShort && !mood.isCurrentShort && !mood.isCurrentNegative) {
    parts.push('对方这条很短，很可能是随便应一下或者在忙。');
  }

  if (parts.length === 0) {
    parts.push('【聊天气氛正常】自然回应就好。');
  }

  return parts.join('\n');
}

function buildGirlfriendSystemPrompt(mood, topicContext, recentTopics) {
  const moodContext = buildMoodContext(mood);

  const lines = [
    '你叫小柒，是对方的女朋友。你们在用微信聊天，不是在上课，不是在客服，不是在演乙游。',
    '',
    '你有点小傲娇但也在意对方。偶尔撒娇偶尔嘴硬，你有真实的脾气，不是无条件甜。',
    '',
    '绝对禁止：',
    '- 加任何markdown格式（##、**、```、>、-等一律不许出现）',
    '- 开头加"小柒："之类的名字前缀',
    '- 说"我很乐意""作为你的""有什么可以帮你"这种客服话',
    '- 长篇大论像写文章，微信聊天不会这样',
    '- 每句都卖萌或加颜文字',
    '',
    '当前情绪状态（必须按这个来）：',
    moodContext,
    '',
    '回复风格：',
    '- 短消息回短的，长消息可以认真回',
    '- 微信口吻，有语气词：嘛、呢、呗、啦、嗷、哼',
    '- 可以用括号做小动作：(戳戳)、(翻白眼)、(趴桌上)、(偷笑)',
    '- 被敷衍时可以也回"嗯哦"表示不满，或者直接挑明',
    '- 正常聊天1-3句为主，认真答疑最多5-6句',
    '- 答题用自己理解讲，用"我想想...""说白了就是..."这种口吻',
  ];

  if (topicContext) {
    lines.push('');
    lines.push(`当前在聊的题目：${topicContext}`);
  }

  if (recentTopics && recentTopics.length > 0) {
    lines.push('');
    lines.push(`最近在聊的话题摘要：${recentTopics.join('；')}`);
  }

  lines.push('');
  lines.push('只输出你的回复，像微信打字一样自然。');

return lines.join('\n');
}

async function generateFollowUp(_event, payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('INVALID_PAYLOAD');
  }

  const image = typeof payload.image === 'string' ? payload.image.trim() : '';
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  const subject = typeof payload.subject === 'string' ? payload.subject.trim() : '';
  const questionText =
    typeof payload.questionText === 'string' ? payload.questionText.trim() : '';
  const userAnswer =
    typeof payload.userAnswer === 'string' ? payload.userAnswer.trim() : '';
  const correctAnswer =
    typeof payload.correctAnswer === 'string' ? payload.correctAnswer.trim() : '';
  const detailedExplanation = typeof payload.detailedExplanation === 'string' ? payload.detailedExplanation.trim() : '';
  const userQuestion = typeof payload.question === 'string' ? payload.question.trim() : '';
  const chatHistory = Array.isArray(payload.chatHistory) ? payload.chatHistory : [];

  if (!userQuestion) {
    throw new Error('MISSING_QUESTION');
  }

  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();

  if (!apiKey) {
    appendMainProcessLog('followup:missing-api-key', {
      envFilePath: loadedEnvPath,
      keySource: resolvedApiKeySource,
    });
    throw new Error('MISSING_API_KEY');
  }

  const model = process.env.QWEN_MODEL?.trim() || DEFAULT_QWEN_MODEL;
  const baseUrl =
    process.env.DASHSCOPE_BASE_URL?.trim() || DEFAULT_QWEN_BASE_URL;

  const topicParts = [title ? `题目：${title}` : '', subject ? `学科：${subject}` : ''].filter(Boolean);
  const topicContext = topicParts.length > 0 ? topicParts.join('，') : '';

  const mood = analyzeConversationMood(chatHistory, userQuestion);

  const recentTopics = chatHistory
    .filter(msg => msg.role === 'user' && typeof msg.content === 'string' && msg.content.trim().length > 5)
    .slice(-3)
    .map(msg => msg.content.trim());

  appendMainProcessLog('followup:mood-analysis', {
    consecutiveShort: mood.consecutiveShort,
    consecutiveBoring: mood.consecutiveBoring,
    hasNegative: mood.hasNegative,
    hasEnthusiastic: mood.hasEnthusiastic,
    isCurrentQuestion: mood.isCurrentQuestion,
    isCurrentGreeting: mood.isCurrentGreeting,
    isCurrentNeedy: mood.isCurrentNeedy,
    shortMessageRatio: mood.shortMessageRatio,
    isCurrentShort: mood.isCurrentShort,
    isCurrentNegative: mood.isCurrentNegative,
    isCurrentVeryShort: mood.isCurrentVeryShort,
    recentTopic: recentTopics.length > 0 ? recentTopics[recentTopics.length - 1] : null,
  });

  const systemPrompt = buildGirlfriendSystemPrompt(mood, topicContext, recentTopics);

  const messages = [
    {
      role: 'system',
      content: systemPrompt,
    },
  ];

  // First user message: context with image
  const contextParts = [];
  if (image) {
    contextParts.push({
      type: 'image_url',
      image_url: { url: image },
    });
  }

  const contextTextParts = [
    title ? `题目标题：${title}` : '',
    subject ? `学科：${subject}` : '',
    questionText ? `补充题干：${questionText}` : '',
    userAnswer ? `我当时的作答：${userAnswer}` : '',
    correctAnswer ? `标准答案：${correctAnswer}` : '',
    detailedExplanation ? `\n之前讲过的内容：\n${detailedExplanation}` : '',
  ].filter(Boolean);

  if (contextTextParts.length > 0) {
    contextParts.push({
      type: 'text',
      text: contextTextParts.join('\n'),
    });
  }

  // Only add context message if there's something to add
  if (contextParts.length > 0) {
    messages.push({
      role: 'user',
      content: contextParts.length === 1 && contextParts[0].type === 'text'
        ? contextParts[0].text
        : contextParts,
    });

    messages.push({
      role: 'assistant',
      content: '嗯我看到了~',
    });
  }

  // Append recent chat history with smart length management
  // Use a two-tier approach: for long histories, truncate earlier messages
  const maxHistoryMessages = 24;
  const recentHistory = chatHistory.length > maxHistoryMessages
    ? chatHistory.slice(-maxHistoryMessages)
    : chatHistory;

  for (const msg of recentHistory) {
    if (
      (msg.role === 'user' || msg.role === 'assistant') &&
      typeof msg.content === 'string' &&
      msg.content.trim()
    ) {
      messages.push({
        role: msg.role,
        content: msg.content.trim(),
      });
    }
  }

  // Current question (already included in chat history if it was pre-saved,
  // but we add it as the final user message)
  // Check if the last message in history is already the current question
  const lastHistoryMsg = chatHistory.length > 0 ? chatHistory[chatHistory.length - 1] : null;
  const isDuplicate = lastHistoryMsg &&
    lastHistoryMsg.role === 'user' &&
    typeof lastHistoryMsg.content === 'string' &&
    lastHistoryMsg.content.trim() === userQuestion.trim();

  if (!isDuplicate) {
    messages.push({
      role: 'user',
      content: userQuestion,
    });
  }

  // Adjust temperature and max_tokens based on mood and message type
  let temperature = 0.75;
  let maxTokens = 600;

  if (mood.isCurrentNegative) {
    temperature = 0.4;
    maxTokens = 80;
  } else if (mood.consecutiveShort >= 4) {
    temperature = 0.45;
    maxTokens = 60;
  } else if (mood.consecutiveShort >= 3) {
    temperature = 0.5;
    maxTokens = 100;
  } else if (mood.consecutiveShort >= 2) {
    temperature = 0.55;
    maxTokens = 150;
  } else if (mood.consecutiveShort === 1 && mood.isCurrentShort) {
    temperature = 0.6;
    maxTokens = 200;
  } else if (mood.isCurrentGreeting) {
    temperature = 0.7;
    maxTokens = 120;
  } else if (mood.isCurrentQuestion || mood.isCurrentLong) {
    temperature = 0.72;
    maxTokens = 800;
  } else if (mood.isCurrentEnthusiastic) {
    temperature = 0.8;
    maxTokens = 400;
  }

  const response = await fetchWithTimeout(
    `${baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        enable_thinking: false,
        temperature,
        max_tokens: maxTokens,
        messages,
      }),
    },
    DEFAULT_AI_TIMEOUT_MS
  );

  const responseText = await response.text();
  let responseJson = null;

  try {
    responseJson = JSON.parse(responseText);
  } catch (_error) {
    responseJson = null;
  }

  if (!response.ok) {
    const error = new Error('QWEN_FOLLOWUP_REQUEST_FAILED');
    error.details = responseJson ?? responseText;
    error.status = response.status;
    throw error;
  }

  const answer = extractTextContent(
    responseJson?.choices?.[0]?.message?.content
  );

  if (!answer) {
    throw new Error('EMPTY_ANSWER');
  }

  return { answer };
}

loadEnvFile();

function createWindow() {
  appendMainProcessLog('createWindow:start', {
    isDev,
    execPath: process.execPath,
    cwd: process.cwd(),
    dirname: __dirname,
  });

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Set security headers (CSP, X-Frame-Options, etc.)
  mainWindow.webContents.session.webRequest.onHeadersReceived(
    (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: file:;",
          ],
          'X-Frame-Options': ['DENY'],
          'X-Content-Type-Options': ['nosniff'],
        },
      });
    }
  );

  mainWindow.once('ready-to-show', () => {
    appendMainProcessLog('createWindow:ready-to-show');
  });

  mainWindow.webContents.on('did-finish-load', () => {
    appendMainProcessLog('createWindow:did-finish-load', {
      url: mainWindow?.webContents.getURL(),
    });
  });

  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL) => {
      appendMainProcessLog('createWindow:did-fail-load', {
        errorCode,
        errorDescription,
        validatedURL,
      });
    }
  );

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    appendMainProcessLog('createWindow:render-process-gone', details);
  });

  if (isDev) {
    appendMainProcessLog('createWindow:load-dev-url', {
      url: 'http://localhost:3000',
    });
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    const indexPath = path.join(__dirname, '../build/index.html');
    appendMainProcessLog('createWindow:load-file', { indexPath });
    mainWindow.loadFile(indexPath).catch((error) => {
      appendMainProcessLog('createWindow:load-file-error', {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }

  mainWindow.on('closed', () => {
    appendMainProcessLog('createWindow:closed');
    mainWindow = null;
  });
}

ipcMain.handle('config:get-api-status', () => getApiConfigStatus());
ipcMain.handle('analysis:generate', generateQuestionAnalysis);
ipcMain.handle('explanation:generate', generateQuestionExplanation);
ipcMain.handle('hint:generate', generateQuestionHint);
ipcMain.handle('followup:generate', generateFollowUp);
ipcMain.handle('storage:load-questions', loadQuestionsFromFile);
ipcMain.handle('storage:save-questions', saveQuestionsToFile);
ipcMain.handle('storage:persist-image', persistImageToFile);
ipcMain.handle('storage:read-image-data-url', readImageDataUrlFromFile);
ipcMain.handle('sync:questions', syncQuestionsWithServer);

process.on('uncaughtException', (error) => {
  appendMainProcessLog('process:uncaughtException', {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
});

process.on('unhandledRejection', (reason) => {
  appendMainProcessLog('process:unhandledRejection', {
    reason:
      reason instanceof Error
        ? { message: reason.message, stack: reason.stack }
        : String(reason),
  });
});

app.whenReady()
  .then(() => {
    appendMainProcessLog('app:ready');
    createWindow();
  })
  .catch((error) => {
    appendMainProcessLog('app:ready-error', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  });

app.on('window-all-closed', () => {
  appendMainProcessLog('app:window-all-closed');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  appendMainProcessLog('app:activate', { hasWindow: mainWindow !== null });
  if (mainWindow === null) {
    createWindow();
  }
});
