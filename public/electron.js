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
// Keep in sync with src/constants/subjects.ts
const ALLOWED_SUBJECTS = new Set(['物理', '数学', '化学', '生物']);

// Write queue to prevent concurrent file writes and data corruption
let writeQueue = Promise.resolve();

let loadedEnvPath = null;
let resolvedApiKeySource = null;

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

  return path.join(path.dirname(process.execPath), 'data');
}

function getQuestionsStorageFilePath() {
  return path.join(getStorageBaseDirectory(), 'questions.json');
}

function getImagesStorageDirectory() {
  return path.join(getStorageBaseDirectory(), 'images');
}

function getLegacyQuestionsStorageFilePath() {
  return path.join(app.getPath('userData'), 'questions.json');
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
  const legacyStorageFilePath = getLegacyQuestionsStorageFilePath();

  if (
    !fs.existsSync(legacyStorageFilePath) ||
    nextStorageFilePath === legacyStorageFilePath
  ) {
    return;
  }

  try {
    const [nextQuestions, legacyQuestions] = await Promise.all([
      readQuestionsArrayFromFile(nextStorageFilePath),
      readQuestionsArrayFromFile(legacyStorageFilePath),
    ]);

    const shouldUseLegacyData =
      legacyQuestions.length > 0 &&
      (!fs.existsSync(nextStorageFilePath) || nextQuestions.length === 0);

    if (!shouldUseLegacyData) {
      return;
    }

    await fs.promises.mkdir(path.dirname(nextStorageFilePath), {
      recursive: true,
    });
    await fs.promises.copyFile(legacyStorageFilePath, nextStorageFilePath);
  } catch (error) {
    console.warn('Failed to migrate legacy questions storage.', error);
  }
}

function loadEnvFile() {
  const candidatePaths = [
    path.resolve(path.dirname(process.execPath), '.env'),
    path.resolve(process.resourcesPath || '', '.env'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(__dirname, '../.env'),
    path.resolve(__dirname, '../.env.local'),
  ];

  for (const envPath of candidatePaths) {
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const result = dotenv.config({
      path: envPath,
      override: false,
      quiet: true,
    });

    if (
      !result.error &&
      result.parsed &&
      Object.keys(result.parsed).length > 0
    ) {
      loadedEnvPath = envPath;
    }
  }

  normalizeApiKeyNames();
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
    return typeof value === 'string' && value.trim().length > 0;
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
    keyConfigured: typeof key === 'string' && key.trim().length > 0,
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
    await retainSoftDeletedQuestionImages(nextValue);

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

  return enqueueWrite(async () => {
    const imagesDirectory = getImagesStorageDirectory();
    await fs.promises.mkdir(imagesDirectory, { recursive: true });

    const extension = getImageExtension(parsed.mimeType);
    const imageId = createResourceId(`img-${kind}`);
    const fileName = `${imageId}.${extension}`;
    const filePath = path.join(imagesDirectory, fileName);

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

async function retainSoftDeletedQuestionImages(questions) {
  const softDeletedQuestionCount = Array.isArray(questions)
    ? questions.filter(
        (question) =>
          question &&
          typeof question === 'object' &&
          question.deleted === true
      ).length
    : 0;

  if (softDeletedQuestionCount === 0) {
    return;
  }

  // Current strategy: soft-deleted questions keep their file refs.
  // Future hard-delete/archive cleanup should use these tombstones as the entry point.
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

function buildAnalysisPrompt() {
  return [
    '你是一名中国高中理科老师，擅长针对具体题目进行精确分析。',
    '',
    '请根据用户提供的题目图片进行分析，并严格按照 JSON 格式输出结果。',
    '',
    '【最高优先级要求】',
    '1. 只输出 JSON，不要输出任何解释、注释、markdown、前后缀。',
    '2. 所有字段必须存在。',
    '3. 所有内容必须结合题目图片中的具体条件，不允许输出泛化、模板化内容。',
    '4. 不允许编造题目中不存在的信息。',
    '5. 如果题目部分无法识别，请基于可见信息尽量合理分析。',
    '',
    '输出格式：',
    '{',
    '  "subject": "",',
    '  "knowledge_points": [],',
    '  "common_mistakes": [],',
    '  "difficulty": 1,',
    '  "cautions": [],',
    '  "analysis_summary": ""',
    '}',
    '',
    '字段要求：',
    '【1. subject】',
    '- 只能从：数学 / 物理 / 化学 / 生物 中选择。',
    '- 必须根据题目实际内容判断。',
    '',
    '【2. knowledge_points】',
    '- 提取本题真正考查的核心知识点。',
    '- 必须直接对应题目条件，例如函数表达式、物理过程、反应条件、实验装置或图示信息。',
    '- 使用规范术语，不要写“综合题”“基础知识”这类空词。',
    '- 常规题给 2 到 3 条；只有在题目明显更复杂时才给 4 到 5 条。',
    '- 每一条都必须具体、可执行、互不重复。',
    '- 宁可少写，也不要为了凑数量加入重复或低质量内容。',
    '',
    '【3. common_mistakes】',
    '- 必须写“这道题最容易犯的具体错误”，要能直接对应解题过程。',
    '- 禁止写“粗心”“计算错误”“审题不清”这类泛化空话。',
    '- 每一条都必须具体、可执行、互不重复，例如忽略定义域、受力分析遗漏关键力、误把某一状态当平衡状态。',
    '- 常规题给 2 到 3 条；复杂题最多 4 到 5 条。',
    '- 宁可少写，也不要为了凑数量输出低质量内容。',
    '',
    '【4. difficulty】',
    '- 评分范围是 1 到 5。',
    '- 1 = 很简单，2 = 基础题，3 = 中等题，4 = 较难题，5 = 难题。',
    '- 必须根据题目复杂度判断，不允许默认给中间值。',
    '',
    '【5. cautions】',
    '- 写“解题时必须注意的关键点”，语气像老师的批注提醒。',
    '- 必须结合题目中的隐藏条件、关键限制、系统选择、边界条件、实验条件或图像信息。',
    '- 禁止写“注意计算”“认真审题”这类废话。',
    '- 常规题给 2 到 3 条；复杂题最多 4 到 5 条。',
    '- 每条都必须具体、可执行、互不重复。',
    '',
    '【6. analysis_summary】',
    '- 用一句话总结本题核心考查内容。',
    '- 必须具体到方法、定律、模型或题型，不要泛泛描述。',
    '',
    '【额外约束】',
    '- 所有数组字段不能为空，至少给 1 条。',
    '- 不同字段之间不要重复表达同一个意思。',
    '- 如果题目中存在公式、图像、物理量、实验条件或关键限定语，分析中必须体现这些具体信息。',
    '- knowledge_points、common_mistakes、cautions 三类内容遵循“质量优先、数量弹性”的原则：常规 2 到 3 条，复杂题最多 4 到 5 条，宁可少写也不要写废话。',
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
    '- 语言要清晰，适合高中生理解',
    '- 每一步都要说明“为什么这样做”',
    '- 不要只给结论，重点讲过程',
    '- 如果题目条件不完整或图片不清晰，要明确指出不确定之处',
    '- 不要编造不存在的条件',
    '- 除公式和变量外，禁止出现英文',
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
  const normalizedSubject =
    typeof payload.subject === 'string' &&
    ALLOWED_SUBJECTS.has(payload.subject.trim())
      ? payload.subject.trim()
      : '数学';
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
  const analysisSummary =
    typeof payload.analysis_summary === 'string' &&
    payload.analysis_summary.trim()
      ? payload.analysis_summary.trim()
      : '需结合题面进一步确认本题的核心考查点。';
  return {
    subject: normalizedSubject,
    knowledge_points: knowledgePoints,
    common_mistakes: commonMistakes,
    difficulty: clampDifficulty(payload.difficulty),
    cautions,
    analysis_summary: analysisSummary,
  };
}

async function generateQuestionAnalysis(_event, payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('INVALID_PAYLOAD');
  }

  const image = typeof payload.image === 'string' ? payload.image.trim() : '';

  if (!image) {
    throw new Error('MISSING_IMAGE');
  }

  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();

  if (!apiKey) {
    throw new Error('MISSING_API_KEY');
  }

  const model = process.env.QWEN_MODEL?.trim() || DEFAULT_QWEN_MODEL;
  const baseUrl =
    process.env.DASHSCOPE_BASE_URL?.trim() || DEFAULT_QWEN_BASE_URL;

  appendMainProcessLog('analysis:generate:start', {
    model,
    imagePrefix: image.slice(0, 32),
    imageLength: image.length,
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
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: image,
                },
              },
              {
                type: 'text',
                text: buildAnalysisPrompt(),
              },
            ],
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
      subject: normalized.subject,
      knowledgePointsCount: normalized.knowledge_points.length,
      commonMistakesCount: normalized.common_mistakes.length,
      cautionsCount: normalized.cautions.length,
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

  if (!image) {
    throw new Error('MISSING_IMAGE');
  }

  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();

  if (!apiKey) {
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
              '你是一名中国高中理科老师，擅长给学生讲清楚解题过程。',
              '回答必须是自然、完整的简体中文。',
              '严禁输出英文句子、英文段落或中英夹杂解释。',
              '只有公式、变量、单位、函数名中允许保留必要字母。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: image,
                },
              },
              {
                type: 'text',
                text: buildDetailedExplanationPrompt(payload),
              },
            ],
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

  if (!image) {
    throw new Error('MISSING_IMAGE');
  }

  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();

  if (!apiKey) {
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
            content: '你是一名中国高中理科老师，擅长用简短提示点拨学生继续思考。',
          },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: image,
                },
              },
              {
                type: 'text',
                text: [buildHintPrompt(), '', `题目标题：${title || '未命名题目'}`, `预估学科：${subject || '未识别学科'}`].join('\n'),
              },
            ],
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

async function generateFollowUp(_event, payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('INVALID_PAYLOAD');
  }

  const image = typeof payload.image === 'string' ? payload.image.trim() : '';
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  const subject = typeof payload.subject === 'string' ? payload.subject.trim() : '';
  const detailedExplanation = typeof payload.detailedExplanation === 'string' ? payload.detailedExplanation.trim() : '';
  const userQuestion = typeof payload.question === 'string' ? payload.question.trim() : '';
  const chatHistory = Array.isArray(payload.chatHistory) ? payload.chatHistory : [];

  if (!userQuestion) {
    throw new Error('MISSING_QUESTION');
  }

  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();

  if (!apiKey) {
    throw new Error('MISSING_API_KEY');
  }

  const model = process.env.QWEN_MODEL?.trim() || DEFAULT_QWEN_MODEL;
  const baseUrl =
    process.env.DASHSCOPE_BASE_URL?.trim() || DEFAULT_QWEN_BASE_URL;

  // Build messages with context
  const messages = [
    {
      role: 'system',
      content: [
        '你是一名中国高中理科老师，正在针对一道具体的错题为学生答疑。',
        '要求：',
        '1. 输出必须是纯文本，不要使用 markdown 格式',
        '2. 不要使用任何特殊符号，包括：###、##、#、**、*、```、>、- 等',
        '3. 回答要具体，结合题目和之前的详解内容',
        '4. 语言清晰，适合高中生理解',
        '5. 不要重复已有的详解内容，针对学生的问题给出有针对性的回答',
        '6. 全文必须使用简体中文，不允许输出英文句子、英文段落或中英夹杂解释',
        '7. 只有公式、变量、单位、函数名中允许保留必要字母，除此之外一律用中文',
      ].join('\n'),
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
  contextParts.push({
    type: 'text',
    text: [
      `题目标题：${title || '未命名题目'}`,
      `学科：${subject || '未识别学科'}`,
      detailedExplanation ? `\n已有详解：\n${detailedExplanation}` : '',
      '\n请基于以上题目和详解内容，回答学生的追问。',
    ].filter(Boolean).join('\n'),
  });

  messages.push({
    role: 'user',
    content: contextParts,
  });

  messages.push({
    role: 'assistant',
    content: '好的，我已了解这道题的题目和详解内容，请提出你的问题。',
  });

  // Append chat history (limit to last 10 messages to avoid token overflow)
  const recentHistory = chatHistory.slice(-10);
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

  // Current question
  messages.push({
    role: 'user',
    content: userQuestion,
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
