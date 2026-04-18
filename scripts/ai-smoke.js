const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const apiKey = process.env.DASHSCOPE_API_KEY;
const model = process.env.QWEN_MODEL || 'qwen3.6-plus';
const baseUrl =
  process.env.DASHSCOPE_BASE_URL ||
  'https://dashscope.aliyuncs.com/compatible-mode/v1';

if (!apiKey) {
  throw new Error('Missing DASHSCOPE_API_KEY');
}

const testAssetDir = path.resolve(__dirname, '../data/test-assets');
const outputPath = path.join(testAssetDir, 'ai-smoke-results.json');

function fileToDataUrl(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  return `${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

function withDataUrlPrefix(filePath) {
  return `data:${fileToDataUrl(filePath)}`;
}

function buildAnalysisPrompt() {
  return [
    '你是一名中国高中理科老师，擅长针对具体题目进行精确分析。',
    '',
    '请根据用户提供的题目图片进行分析，并严格按照 JSON 格式输出结果。',
    '',
    '【最高优先级要求】',
    '1. 只输出 JSON，不要输出任何解释、注释、markdown、前后缀',
    '2. 所有字段必须存在',
    '3. 所有内容必须结合题目图片中的具体条件，不允许输出泛泛的模板化内容',
    '4. 不允许编造题目中不存在的信息',
    '5. 如果题目部分无法识别，请基于可见信息合理分析',
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
    '- 只能从：数学 / 物理 / 化学 / 生物 中选择',
    '- 必须根据题目实际内容判断',
    '',
    '【2. knowledge_points】',
    '- 提取本题真正考查的核心知识点',
    '- 必须直接对应题目条件，例如函数表达式、物理过程、反应条件等',
    '- 禁止输出泛化词汇，如：函数综合、力学综合',
    '- 最多 3 个',
    '- 使用规范术语，例如：导数判断单调性、牛顿第二定律、化学平衡移动',
    '',
    '【3. common_mistakes】',
    '- 必须针对本题的具体解题过程',
    '- 禁止写“计算错误”“粗心”等无效内容',
    '- 必须写具体错误类型，例如：忽略定义域、分类讨论不完整、受力分析遗漏关键力、实验条件理解错误',
    '- 最多 3 条',
    '',
    '【4. difficulty】',
    '- 评分范围：1~5',
    '- 1 = 很简单',
    '- 2 = 基础题',
    '- 3 = 中等题',
    '- 4 = 较难题',
    '- 5 = 难题',
    '- 必须根据题目复杂度判断，不允许默认给中间值',
    '',
    '【5. cautions】',
    '- 写“解题时必须注意的关键点”',
    '- 必须结合题目条件',
    '- 禁止空话，如：认真审题',
    '- 最多 3 条',
    '',
    '【6. analysis_summary】',
    '- 用一句话总结本题核心考查内容',
    '- 必须具体到方法或题型',
    '- 禁止泛泛描述',
    '',
    '【额外约束】',
    '- 所有数组字段不能为空，至少 1 条',
    '- 不同字段之间不得重复表达',
    '- 如果题目中存在公式、图像、物理量、实验条件，必须在分析中体现',
  ].join('\n');
}

function buildDetailedExplanationPrompt(title, subject) {
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

function cleanExplanationText(text) {
  const LEADING_FILLER_PATTERN =
    /^\s*(你好|同学你好|我们来分析(?:一下)?这道题|下面(?:我们)?来分析这道题|我们来看(?:一下)?这道题|下面给出(?:详细)?讲解|接下来(?:我们)?来分析|下面开始讲解)[：:，,\s]*$/;

  if (!text.trim()) {
    return '';
  }

  const normalizedText = text
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/```/g, '')
    .replace(/`/g, '')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/\*/g, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[ \t]+\n/g, '\n');

  const cleanedLines = normalizedText
    .split('\n')
    .map((line) => line.trim())
    .filter((line, index) => {
      if (index > 2) {
        return true;
      }

      return !LEADING_FILLER_PATTERN.test(line);
    });

  const compactLines = cleanedLines.reduce((result, line) => {
    if (!line) {
      if (result.length === 0 || result[result.length - 1] === '') {
        return result;
      }

      result.push('');
      return result;
    }

    result.push(line);
    return result;
  }, []);

  while (compactLines.length > 0 && compactLines[0] === '') {
    compactLines.shift();
  }

  while (
    compactLines.length > 0 &&
    compactLines[compactLines.length - 1] === ''
  ) {
    compactLines.pop();
  }

  return compactLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
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

async function callQwen(body) {
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  const latencyMs = Date.now() - startedAt;

  let outer = null;
  try {
    outer = JSON.parse(text);
  } catch (_error) {
    outer = null;
  }

  return {
    status: response.status,
    latencyMs,
    text,
    outer,
  };
}

async function runAnalysisCase(fileName) {
  const imagePath = path.join(testAssetDir, fileName);
  const image = withDataUrlPrefix(imagePath);
  const response = await callQwen({
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
  });

  const content = response.outer?.choices?.[0]?.message?.content;
  const jsonString = extractJsonString(
    Array.isArray(content)
      ? content.map((item) => (typeof item?.text === 'string' ? item.text : '')).join('\n')
      : content
  );

  let parsed = null;
  let parseError = null;
  if (jsonString) {
    try {
      parsed = JSON.parse(jsonString);
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    kind: 'analysis',
    fileName,
    status: response.status,
    latencyMs: response.latencyMs,
    parseError,
    parsed,
    preview: typeof jsonString === 'string' ? jsonString.slice(0, 600) : null,
  };
}

async function runExplanationCase(fileName, subjectHint) {
  const imagePath = path.join(testAssetDir, fileName);
  const image = withDataUrlPrefix(imagePath);
  const response = await callQwen({
    model,
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
              url: image,
            },
          },
          {
            type: 'text',
            text: buildDetailedExplanationPrompt(fileName, subjectHint),
          },
        ],
      },
    ],
  });

  const raw = extractTextContent(response.outer?.choices?.[0]?.message?.content);
  const cleaned = cleanExplanationText(raw);

  return {
    kind: 'explanation',
    fileName,
    status: response.status,
    latencyMs: response.latencyMs,
    rawPreview: raw.slice(0, 600),
    cleanedPreview: cleaned.slice(0, 600),
    containsMarkdownMarkers: /```|###|##|#|\*\*/.test(raw),
    cleanedContainsMarkdownMarkers: /```|###|##|#|\*\*/.test(cleaned),
  };
}

async function main() {
  const analysisCases = [
    'math.png',
    'physics.png',
    'chem.png',
    'biology.png',
    'blurry.png',
    'non-question.png',
  ];
  const explanationCases = [
    ['math.png', '数学'],
    ['physics.png', '物理'],
    ['blurry.png', '数学'],
  ];

  const results = {
    generatedAt: new Date().toISOString(),
    model,
    analysisResults: [],
    explanationResults: [],
  };

  for (const fileName of analysisCases) {
    results.analysisResults.push(await runAnalysisCase(fileName));
  }

  for (const [fileName, subjectHint] of explanationCases) {
    results.explanationResults.push(await runExplanationCase(fileName, subjectHint));
  }

  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf8');

  const summary = {
    outputPath,
    analysis: results.analysisResults.map((item) => ({
      fileName: item.fileName,
      status: item.status,
      latencyMs: item.latencyMs,
      subject: item.parsed?.subject ?? null,
      knowledgePointCount: Array.isArray(item.parsed?.knowledge_points)
        ? item.parsed.knowledge_points.length
        : null,
      commonMistakeCount: Array.isArray(item.parsed?.common_mistakes)
        ? item.parsed.common_mistakes.length
        : null,
      cautionCount: Array.isArray(item.parsed?.cautions)
        ? item.parsed.cautions.length
        : null,
      difficulty: item.parsed?.difficulty ?? null,
      parseError: item.parseError,
    })),
    explanation: results.explanationResults.map((item) => ({
      fileName: item.fileName,
      status: item.status,
      latencyMs: item.latencyMs,
      containsMarkdownMarkers: item.containsMarkdownMarkers,
      cleanedContainsMarkdownMarkers: item.cleanedContainsMarkdownMarkers,
      cleanedLength: item.cleanedPreview.length,
    })),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
