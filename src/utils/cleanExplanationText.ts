const LEADING_FILLER_PATTERN =
  /^\s*(你好|同学你好|我们来分析(?:一下)?这道题|下面(?:我们)?来分析这道题|我们来看(?:一下)?这道题|下面给出(?:详细)?讲解|接下来(?:我们)?来分析|下面开始讲解)[：:，,\s]*$/;

export function cleanExplanationText(text: string): string {
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

  const compactLines = cleanedLines.reduce<string[]>((result, line) => {
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
