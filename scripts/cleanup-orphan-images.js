const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

const projectRoot = path.resolve(__dirname, '..');
const dataDirectory = path.join(projectRoot, 'data');
const questionsFilePath = path.join(dataDirectory, 'questions.json');
const imagesDirectory = path.join(dataDirectory, 'images');
const shouldApply = process.argv.includes('--apply');

function readQuestions() {
  if (!fs.existsSync(questionsFilePath)) {
    return [];
  }

  try {
    const rawValue = fs.readFileSync(questionsFilePath, 'utf8');
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function isFileImageUri(value) {
  return typeof value === 'string' && /^file:\/\//i.test(value);
}

function resolveImageFilePath(uri) {
  const resolvedPath = path.resolve(
    uri.startsWith('file://') ? fileURLToPath(uri) : uri
  );
  const relativePath = path.relative(path.resolve(imagesDirectory), resolvedPath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return null;
  }

  return resolvedPath;
}

function addFilePath(uri, referencedPaths) {
  if (!isFileImageUri(uri)) {
    return;
  }

  const filePath = resolveImageFilePath(uri);
  if (filePath) {
    referencedPaths.add(filePath);
  }
}

function addRefs(refs, referencedPaths) {
  if (!Array.isArray(refs)) {
    return;
  }

  for (const ref of refs) {
    if (ref && typeof ref === 'object') {
      addFilePath(ref.uri, referencedPaths);
    }
  }
}

function collectReferencedFilePaths(questions) {
  const referencedPaths = new Set();

  for (const question of questions) {
    if (!question || typeof question !== 'object') {
      continue;
    }

    addFilePath(question.image, referencedPaths);

    if (Array.isArray(question.noteImages)) {
      for (const noteImage of question.noteImages) {
        addFilePath(noteImage, referencedPaths);
      }
    }

    addRefs(question.imageRefs, referencedPaths);
    addRefs(question.noteImageRefs, referencedPaths);
  }

  return referencedPaths;
}

function collectImageFiles() {
  if (!fs.existsSync(imagesDirectory)) {
    return [];
  }

  return fs.readdirSync(imagesDirectory)
    .map((fileName) => path.join(imagesDirectory, fileName))
    .filter((filePath) => fs.statSync(filePath).isFile());
}

function main() {
  const questions = readQuestions();
  const referencedPaths = collectReferencedFilePaths(questions);
  const orphanedFiles = collectImageFiles().filter(
    (filePath) => !referencedPaths.has(path.resolve(filePath))
  );

  if (orphanedFiles.length === 0) {
    console.log('No orphaned image files found.');
    return;
  }

  console.log(`Found ${orphanedFiles.length} orphaned image file(s):`);
  for (const filePath of orphanedFiles) {
    console.log(`- ${filePath}`);
  }

  if (!shouldApply) {
    console.log('Dry run only. Re-run with --apply to delete these files.');
    return;
  }

  for (const filePath of orphanedFiles) {
    fs.unlinkSync(filePath);
  }

  console.log(`Deleted ${orphanedFiles.length} orphaned image file(s).`);
}

main();
