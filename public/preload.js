const { contextBridge, ipcRenderer } = require('electron');

// 通过 contextBridge 暴露一组白名单 IPC 通道给渲染进程（window.electronAPI）。
// 只转发下列固定通道，不暴露任意 ipcRenderer，保持上下文隔离下的最小攻击面。

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
  syncQuestions: (questions) => ipcRenderer.invoke('sync:questions', questions),
  onSyncProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('sync:progress', listener);
    return () => ipcRenderer.removeListener('sync:progress', listener);
  },
  onBeforeClose: (callback) => {
    const listener = (_event, request) => {
      const requestId = request?.requestId;
      Promise.resolve()
        .then(() => callback())
        .then(
          () => ipcRenderer.send('storage:close-ready', { ok: true, requestId }),
          (error) =>
            ipcRenderer.send('storage:close-ready', {
              ok: false,
              requestId,
              message: error instanceof Error ? error.message : String(error),
            })
        );
    };
    ipcRenderer.on('storage:before-close', listener);
    return () => ipcRenderer.removeListener('storage:before-close', listener);
  },
});
