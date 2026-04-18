# Current Architecture

## Runtime Shape

- Desktop target: Windows Electron app with React renderer.
- Primary persistence: Electron main process writes question data to `data/questions.json`.
- Image persistence: new uploaded images are written to `data/images/` and referenced by file-based `imageRefs`.
- Renderer fallback storage: `localStorage` is kept only as a compatibility fallback when Electron storage is unavailable.
- AI execution path: renderer asks preload API, preload forwards to Electron IPC, main process calls the real Qwen-compatible API.

## Main Modules

### Electron

- `public/electron.js`
  - creates the BrowserWindow
  - loads optional external `.env` / `.env.local`
  - owns file storage for questions and images
  - exposes IPC handlers for storage and AI
  - applies conservative image-file cleanup during saves
- `public/preload.js`
  - exposes `window.electronAPI`
  - bridges AI calls:
    - `generateQuestionAnalysis`
    - `generateQuestionExplanation`
    - `generateQuestionHint`
    - `generateFollowUp`
  - bridges storage calls:
    - `loadQuestions`
    - `saveQuestions`
    - `persistImage`
    - `readImageDataUrl`

### Renderer Services

- `src/services/questionModel.ts`
  - normalizes persisted data
  - keeps legacy display fields (`image`, `noteImages`) aligned with `imageRefs`
- `src/services/questionService.ts`
  - question create/update/soft-delete operations
  - note image replacement/removal
- `src/services/questionImageService.ts`
  - persists new images through Electron when available
  - resolves file images back to data URLs for AI requests
- `src/services/questionAiService.ts`
  - prepares payloads for analysis / explanation / hint / follow-up
  - maps AI responses back into `Question`
- `src/services/reviewService.ts`
  - review count and spaced-review metadata updates
- `src/utils/questionStorage.ts`
  - Electron file storage first
  - `localStorage` fallback second
- `src/utils/qwenClient.ts`
  - Electron-only AI request wrapper
  - browser-side real API fallback is intentionally disabled

## Data Model

- `Question.imageRefs`: canonical question image refs
- `Question.noteImageRefs`: canonical note image refs
- `Question.image`: legacy display field kept for UI compatibility
- `Question.noteImages`: legacy display field kept for UI compatibility
- `Question.deleted` / `deletedAt`: soft-delete tombstone

## Current Image Cleanup Policy

- Removing a single note image:
  - the reference is removed from the question
  - on the next save, Electron deletes the file only if no remaining question record references it
- Soft-deleting a question:
  - the question record is retained
  - its file refs are also retained
  - current policy is intentionally conservative: no image files are deleted at soft-delete time
  - future hard-delete/archive cleanup should use soft-deleted records as the entry point

## Compatibility Layers Still Present

- `localStorage` read/write fallback in the renderer
- legacy `image` / `noteImages` fields for existing UI code and older saved records
- legacy question file migration from old Electron `userData/questions.json`

## Not Finished Yet

- no hard-delete flow for questions
- no background garbage collector for orphaned images
- no sync backend; `syncStatus` is local metadata only
- docs such as `README.md`, `QUICKSTART.md`, `STRUCTURE.md` may still contain older descriptions; this file is the source of truth for the current implementation
