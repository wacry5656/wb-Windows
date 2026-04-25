export const SUBJECTS = ['数学', '物理', '化学', '生物'] as const;

export type Subject = (typeof SUBJECTS)[number];

export const DEFAULT_SUBJECT: Subject = '数学';

export function isSubject(value: string): value is Subject {
  return SUBJECTS.includes(value as Subject);
}
