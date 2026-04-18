import { FollowUpMessage } from '../types/question';

const DEFAULT_QWEN_BASE_URL =
  'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_QWEN_MODEL = 'qwen3.6-plus';
const ALLOWED_SUBJECTS = new Set(['物理', '数学', '化学', '生物']);

type AnalysisResponse = {
  subject: string;
  knowledge_points: string[];
  common_mistakes: string[];
  difficulty: 1 | 2 | 3 | 4 | 5;
  cautions: string[];
  analysis_summary: string;
};

type ExplanationResponse = {
  explanation: string;
};

type HintResponse = {
  hint: string;
};

type FollowUpResponse = {
  answer: string;
};

type GenerateImagePayload = {
  image: string;
  title?: string;
  subject?: string;
};

type FollowUpPayload = GenerateImagePayload & {
  detailedExplanation: string;
  chatHistory: FollowUpMessage[];
  question: string;
};

function getBrowserApiKey() {
  return process.env.REACT_APP_DASHSCOPE_API_KEY?.trim() || '';
}

function getBaseUrl() {
  return (
    process.env.REACT_APP_DASHSCOPE_BASE_URL?.trim() || DEFAULT_QWEN_BASE_URL
  );
}

function getModel() {
  return process.env.REACT_APP_QWEN_MODEL?.trim() || DEFAULT_QWEN_MODEL;
}

function canUseBrowserFallback() {
  return Boolean(getBrowserApiKey());
}

function extractJsonString(content: unknown) {
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

function extractTextContent(content: unknown) {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((item) => {
      if (typeof item === 'string') {
        return item;
      }

      if (item && typeof item === 'object' && typeof item.text === 'string') {
        return item.text;
      }

      return '';
    })
    .join('\n')
    .trim();
}

function normalizeStringArray(value: unknown, maxLength: number) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, maxLength);
}

function ensureNonEmptyArray(items: string[], fallbackItem: string) {
  return items.length > 0 ? items : [fallbackItem];
}

function clampDifficulty(value: unknown): 1 | 2 | 3 | 4 | 5 {
  const difficulty = Number(value);

  if (!Number.isInteger(difficulty)) {
    return 3;
  }

  return Math.min(5, Math.max(1, difficulty)) as 1 | 2 | 3 | 4 | 5;
}

function normalizeAnalysisPayload(payload: unknown): AnalysisResponse {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('INVALID_JSON');
  }

  const rawPayload = payload as Record<string, unknown>;

  const normalizedSubject =
    typeof rawPayload.subject === 'string' &&
    ALLOWED_SUBJECTS.has(rawPayload.subject.trim())
      ? rawPayload.subject.trim()
      : '数学';

  return {
    subject: normalizedSubject,
    knowledge_points: ensureNonEmptyArray(
      normalizeStringArray(rawPayload.knowledge_points, 5),
      '需结合题面进一步确认核心知识点'
    ),
    common_mistakes: ensureNonEmptyArray(
      normalizeStringArray(rawPayload.common_mistakes, 5),
      '需结合题目条件检查关键步骤是否遗漏'
    ),
    difficulty: clampDifficulty(rawPayload.difficulty),
    cautions: ensureNonEmptyArray(
      normalizeStringArray(rawPayload.cautions, 5),
      '需结合题面条件核对已知量与约束条件'
    ),
    analysis_summary:
      typeof rawPayload.analysis_summary === 'string' &&
      rawPayload.analysis_summary.trim()
        ? rawPayload.analysis_summary.trim()
        : '需结合题面进一步确认本题的核心考查点。',
  };
}

function normalizeHintText(text: string) {
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

function buildDetailedExplanationPrompt(payload: GenerateImagePayload) {
  const title =
    typeof payload.title === 'string' && payload.title.trim()
      ? payload.title.trim()
      : '未命名题目';
  const subject =
    typeof payload.subject === 'string' && payload.subject.trim()
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
  ].join('\n');
}

function buildHintPrompt(title?: string, subject?: string) {
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
    '',
    '输出目标：',
    '帮助学生继续独立思考，而不是直接看答案。',
    '',
    `题目标题：${title || '未命名题目'}`,
    `预估学科：${subject || '未识别学科'}`,
  ].join('\n');
}

async function requestQwen(body: Record<string, unknown>) {
  const apiKey = getBrowserApiKey();

  if (!apiKey) {
    throw new Error('MISSING_API_KEY');
  }

  const response = await fetch(`${getBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: getModel(),
      ...body,
    }),
  });

  const responseText = await response.text();
  let responseJson: any = null;

  try {
    responseJson = JSON.parse(responseText);
  } catch (_error) {
    responseJson = null;
  }

  if (!response.ok) {
    const error = new Error('QWEN_BROWSER_REQUEST_FAILED');
    (error as Error & { status?: number; details?: unknown }).status =
      response.status;
    (error as Error & { status?: number; details?: unknown }).details =
      responseJson ?? responseText;
    throw error;
  }

  return responseJson;
}

async function fallbackGenerateAnalysis(
  payload: GenerateImagePayload
): Promise<AnalysisResponse> {
  const responseJson = await requestQwen({
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
              url: payload.image,
            },
          },
          {
            type: 'text',
            text: buildAnalysisPrompt(),
          },
        ],
      },
    ],
  });

  const content = responseJson?.choices?.[0]?.message?.content;
  const jsonString = extractJsonString(
    Array.isArray(content)
      ? content
          .map((item: any) => (typeof item?.text === 'string' ? item.text : ''))
          .join('\n')
      : content
  );

  if (!jsonString) {
    throw new Error('INVALID_JSON');
  }

  return normalizeAnalysisPayload(JSON.parse(jsonString));
}

async function fallbackGenerateExplanation(
  payload: GenerateImagePayload
): Promise<ExplanationResponse> {
  const responseJson = await requestQwen({
    enable_thinking: true,
    temperature: 0.4,
    messages: [
      {
        role: 'system',
        content: '你是一名中国高中理科老师，擅长给学生讲清楚解题过程。',
      },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: payload.image,
            },
          },
          {
            type: 'text',
            text: buildDetailedExplanationPrompt(payload),
          },
        ],
      },
    ],
  });

  const explanation = extractTextContent(
    responseJson?.choices?.[0]?.message?.content
  );

  if (!explanation) {
    throw new Error('EMPTY_EXPLANATION');
  }

  return { explanation };
}

async function fallbackGenerateHint(
  payload: GenerateImagePayload
): Promise<HintResponse> {
  const responseJson = await requestQwen({
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
              url: payload.image,
            },
          },
          {
            type: 'text',
            text: buildHintPrompt(payload.title, payload.subject),
          },
        ],
      },
    ],
  });

  const hint = normalizeHintText(
    extractTextContent(responseJson?.choices?.[0]?.message?.content)
  );

  if (!hint) {
    throw new Error('EMPTY_HINT');
  }

  return { hint };
}

async function fallbackGenerateFollowUp(
  payload: FollowUpPayload
): Promise<FollowUpResponse> {
  const messages: Array<Record<string, unknown>> = [
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
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: {
            url: payload.image,
          },
        },
        {
          type: 'text',
          text: [
            `题目标题：${payload.title || '未命名题目'}`,
            `学科：${payload.subject || '未识别学科'}`,
            payload.detailedExplanation
              ? `\n已有详解：\n${payload.detailedExplanation}`
              : '',
            '\n请基于以上题目和详解内容，回答学生的追问。',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
    },
    {
      role: 'assistant',
      content: '好的，我已了解这道题的题目和详解内容，请提出你的问题。',
    },
  ];

  for (const msg of payload.chatHistory.slice(-10)) {
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

  messages.push({
    role: 'user',
    content: payload.question,
  });

  const responseJson = await requestQwen({
    enable_thinking: true,
    temperature: 0.4,
    messages,
  });

  const answer = extractTextContent(responseJson?.choices?.[0]?.message?.content);

  if (!answer) {
    throw new Error('EMPTY_ANSWER');
  }

  return { answer };
}

async function invokeWithFallback<T>(
  electronCall: (() => Promise<T>) | undefined,
  browserCall: () => Promise<T>
) {
  if (electronCall) {
    try {
      return await electronCall();
    } catch (error) {
      if (!canUseBrowserFallback() || !shouldFallbackToBrowser(error)) {
        throw error;
      }

      console.error('Electron AI request failed, falling back to browser request.', error);
      return browserCall();
    }
  }

  return browserCall();
}

function shouldFallbackToBrowser(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message || '';

  return (
    message === 'ELECTRON_API_UNAVAILABLE' ||
    message.includes('No handler registered') ||
    message.includes('electronAPI') ||
    message.includes('ipc') ||
    message.includes('invoke')
  );
}

export function generateQuestionAnalysisRequest(
  payload: GenerateImagePayload
): Promise<AnalysisResponse> {
  return invokeWithFallback(
    window.electronAPI?.generateQuestionAnalysis
      ? () => window.electronAPI!.generateQuestionAnalysis({ image: payload.image })
      : undefined,
    () => fallbackGenerateAnalysis(payload)
  );
}

export function generateQuestionExplanationRequest(
  payload: GenerateImagePayload
): Promise<ExplanationResponse> {
  return invokeWithFallback(
    window.electronAPI?.generateQuestionExplanation
      ? () =>
          window.electronAPI!.generateQuestionExplanation({
            image: payload.image,
            title: payload.title || '',
            subject: payload.subject || '',
          })
      : undefined,
    () => fallbackGenerateExplanation(payload)
  );
}

export function generateQuestionHintRequest(
  payload: GenerateImagePayload
): Promise<HintResponse> {
  return invokeWithFallback(
    window.electronAPI?.generateQuestionHint
      ? () =>
          window.electronAPI!.generateQuestionHint({
            image: payload.image,
            title: payload.title || '',
            subject: payload.subject || '',
          })
      : undefined,
    () => fallbackGenerateHint(payload)
  );
}

export function generateFollowUpRequest(
  payload: FollowUpPayload
): Promise<FollowUpResponse> {
  return invokeWithFallback(
    window.electronAPI?.generateFollowUp
      ? () =>
          window.electronAPI!.generateFollowUp({
            image: payload.image,
            title: payload.title || '',
            subject: payload.subject || '',
            detailedExplanation: payload.detailedExplanation,
            chatHistory: payload.chatHistory,
            question: payload.question,
          })
      : undefined,
    () => fallbackGenerateFollowUp(payload)
  );
}
