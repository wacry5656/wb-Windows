import { createLegacyFollowUpId } from './followUpChatIds';

describe('createLegacyFollowUpId', () => {
  test('matches the Android UTF-8 canonical SHA-256 vector', () => {
    expect(
      createLegacyFollowUpId({
        questionId: 'question-跨端-01',
        role: '用户',
        content: '这道题为什么要先移项？',
        createdAtMillis: 1712345678901,
        sourceIndex: 3,
      })
    ).toBe(
      'legacy-followup-9419bc3bb888bc3cb57ddc49dc74bb8e6db72e5d4819bf5500efbbcf383b68fc'
    );
  });
});
