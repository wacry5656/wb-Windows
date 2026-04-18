const { contextBridge, ipcRenderer } = require('electron');

// 这里可以暴露安全的 API 给主进程使用
// 目前不暴露任何 API，因为这个阶段只做基础 UI

contextBridge.exposeInMainWorld('electronAPI', {
  getApiConfigStatus: () => ipcRenderer.invoke('config:get-api-status'),
  generateQuestionAnalysis: (payload) =>
    ipcRenderer.invoke('analysis:generate', payload),
  generateQuestionExplanation: (payload) =>
    ipcRenderer.invoke('explanation:generate', payload),
  generateQuestionHint: (payload) => ipcRenderer.invoke('hint:generate', payload),
  generateFollowUp: (payload) =>
    ipcRenderer.invoke('followup:generate', payload),
  loadQuestions: () => ipcRenderer.invoke('storage:load-questions'),
  saveQuestions: (questions) => ipcRenderer.invoke('storage:save-questions', questions),
  persistImage: (payload) => ipcRenderer.invoke('storage:persist-image', payload),
  readImageDataUrl: (payload) => ipcRenderer.invoke('storage:read-image-data-url', payload),
});
