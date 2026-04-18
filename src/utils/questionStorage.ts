import { normalizeQuestions } from '../services/questionModel';
import { Question } from '../types/question';

const STORAGE_KEY = 'wrong-question-assistant/questions';

export async function loadQuestions(): Promise<Question[]> {
  if (typeof window === 'undefined') {
    return [];
  }

  if (window.electronAPI?.loadQuestions) {
    try {
      const savedQuestions = await window.electronAPI.loadQuestions();
      return normalizeQuestions(savedQuestions);
    } catch (error) {
      console.warn('Failed to load questions from Electron storage.', error);
    }
  }

  const rawValue = window.localStorage.getItem(STORAGE_KEY);

  if (!rawValue) {
    return [];
  }

  try {
    return normalizeQuestions(JSON.parse(rawValue));
  } catch (error) {
    console.warn('Failed to parse saved questions.', error);
    alert('本地错题数据解析失败，数据可能已损坏。请检查浏览器 localStorage 中的备份。');
    return [];
  }
}

export async function saveQuestions(questions: Question[]): Promise<void> {
  if (typeof window === 'undefined') {
    return;
  }

  if (window.electronAPI?.saveQuestions) {
    const result = await window.electronAPI.saveQuestions(questions);
    if (result.success) {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(questions));
  } catch (error) {
    console.warn('Failed to save questions to localStorage.', error);
  }
}
