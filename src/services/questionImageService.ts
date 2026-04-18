import { ImageRef, Question } from '../types/question';
import { createInlineImageRef } from './questionModel';

interface PersistImageOptions {
  now?: string;
}

export async function persistQuestionImage(
  dataUrl: string,
  kind: ImageRef['kind'],
  options: PersistImageOptions = {}
): Promise<ImageRef> {
  const timestamp = options.now || new Date().toISOString();

  if (typeof window !== 'undefined' && window.electronAPI?.persistImage) {
    return window.electronAPI.persistImage({
      dataUrl,
      kind,
      createdAt: timestamp,
    });
  }

  return createInlineImageRef(dataUrl, kind, timestamp);
}

export async function resolveQuestionImageForAi(question: Question): Promise<string> {
  const normalizedImage = question.image.trim();

  if (!normalizedImage) {
    throw new Error('MISSING_IMAGE');
  }

  if (normalizedImage.startsWith('data:image/')) {
    return normalizedImage;
  }

  if (normalizedImage.startsWith('file://')) {
    if (!window.electronAPI?.readImageDataUrl) {
      throw new Error('UNSUPPORTED_IMAGE_SOURCE');
    }

    return window.electronAPI.readImageDataUrl({
      uri: normalizedImage,
    });
  }

  if (normalizedImage.startsWith('blob:')) {
    const response = await fetch(normalizedImage);

    if (!response.ok) {
      throw new Error('IMAGE_FETCH_FAILED');
    }

    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.startsWith('image/')) {
      throw new Error('INVALID_CONTENT_TYPE');
    }

    const blob = await response.blob();

    if (blob.size > 10 * 1024 * 1024) {
      throw new Error('IMAGE_TOO_LARGE');
    }

    return readBlobAsDataUrl(blob);
  }

  throw new Error('UNSUPPORTED_IMAGE_SOURCE');
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('IMAGE_CONVERSION_FAILED'));
    };

    reader.onerror = () => {
      reject(new Error('IMAGE_CONVERSION_FAILED'));
    };

    reader.readAsDataURL(blob);
  });
}
