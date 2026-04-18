import { cleanExplanationText } from './cleanExplanationText';

test('cleans markdown markers and filler lines from explanation text', () => {
  const rawText = `
你好：
### 题型判断
**这是一道函数题**

\`\`\`markdown
## 解题思路
先看定义域
\`\`\`

> 详细步骤

1. 设出函数解析式
2. 代入条件求解

### 方法总结
`;

  expect(cleanExplanationText(rawText)).toBe(
    [
      '题型判断',
      '这是一道函数题',
      '详细步骤',
      '',
      '1. 设出函数解析式',
      '2. 代入条件求解',
      '方法总结',
    ].join('\n')
  );
});

test('keeps numbered steps and collapses excessive blank lines', () => {
  const rawText = `
我们来分析这道题：
1. 第一步


2. 第二步`;

  expect(cleanExplanationText(rawText)).toBe('1. 第一步\n\n2. 第二步');
});

test('removes single markdown symbols without affecting numbered lines', () => {
  const rawText = `
题型判断：
* 数学
> 解题思路：
\`先观察已知条件\`
1. 第一步
2. 第二步`;

  expect(cleanExplanationText(rawText)).toBe(
    [
      '题型判断：',
      '数学',
      '解题思路：',
      '先观察已知条件',
      '1. 第一步',
      '2. 第二步',
    ].join('\n')
  );
});
