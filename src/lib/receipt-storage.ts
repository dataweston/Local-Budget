import { mkdir, writeFile, readFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

type StoreReceiptFileInput = {
  userId: string;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
  source: 'upload' | 'email' | 'api';
};

type StoreReceiptFileResult = {
  filePath: string;
  publicPath: string;
  fileType: string;
  fileSize: number;
  ocrBuffer: Buffer;
  storageMeta: {
    source: string;
    storage: 'blob' | 'local';
    optimized: boolean;
    originalFileName: string;
    originalMimeType: string;
    originalSize: number;
    storedMimeType: string;
    storedSize: number;
    compressionRatio: number;
  };
};

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
]);

function sanitizeFileSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

function isImageMimeType(mimeType: string): boolean {
  return IMAGE_MIME_TYPES.has(mimeType.toLowerCase());
}

function extensionForMimeType(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'application/pdf':
      return 'pdf';
    case 'image/webp':
      return 'webp';
    case 'image/png':
      return 'png';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    default:
      return 'bin';
  }
}

async function optimizeImageForArchive(buffer: Buffer): Promise<{
  optimizedBuffer: Buffer;
  optimizedMimeType: string;
  optimized: boolean;
}> {
  try {
    const sharp = require('sharp') as any;
    const optimizedBuffer = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 72, effort: 5 })
      .toBuffer();
    if (optimizedBuffer.length >= buffer.length) {
      return {
        optimizedBuffer: buffer,
        optimizedMimeType: 'image/jpeg',
        optimized: false,
      };
    }
    return {
      optimizedBuffer,
      optimizedMimeType: 'image/webp',
      optimized: true,
    };
  } catch {
    return {
      optimizedBuffer: buffer,
      optimizedMimeType: 'image/jpeg',
      optimized: false,
    };
  }
}

function localUploadRoot(): string {
  return path.join(process.cwd(), 'uploads', 'receipts');
}

function usingBlobStorage(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export async function storeReceiptFile(input: StoreReceiptFileInput): Promise<StoreReceiptFileResult> {
  const originalSize = input.buffer.length;
  let storedBuffer = input.buffer;
  let storedMimeType = input.mimeType;
  let optimized = false;

  if (isImageMimeType(input.mimeType)) {
    const optimizedImage = await optimizeImageForArchive(input.buffer);
    storedBuffer = optimizedImage.optimizedBuffer;
    storedMimeType = optimizedImage.optimizedMimeType;
    optimized = optimizedImage.optimized;
  }

  const now = Date.now();
  const safeBaseName = sanitizeFileSegment(path.parse(input.originalName).name || 'invoice');
  const ext = extensionForMimeType(storedMimeType);
  const fileName = `${safeBaseName}_${now}_${randomUUID().slice(0, 8)}.${ext}`;
  const storedSize = storedBuffer.length;

  let filePath: string;
  let storage: 'blob' | 'local';

  if (usingBlobStorage()) {
    const { put } = await import('@vercel/blob');
    const blob = await put(`receipts/${input.userId}/${fileName}`, storedBuffer, {
      access: 'public',
      contentType: storedMimeType,
      addRandomSuffix: true,
    });
    filePath = blob.url;
    storage = 'blob';
  } else {
    const userDir = path.join(localUploadRoot(), input.userId);
    await mkdir(userDir, { recursive: true });
    const absolutePath = path.join(userDir, fileName);
    await writeFile(absolutePath, storedBuffer);
    // Store a relative key so records survive a move of the project directory.
    filePath = path.join('uploads', 'receipts', input.userId, fileName).replace(/\\/g, '/');
    storage = 'local';
  }

  return {
    filePath,
    // Files are no longer placed under public/; they are served with an
    // ownership check via /api/receipts/file/[id].
    publicPath: filePath,
    fileType: storedMimeType,
    fileSize: storedSize,
    ocrBuffer: storedBuffer,
    storageMeta: {
      source: input.source,
      storage,
      optimized,
      originalFileName: input.originalName,
      originalMimeType: input.mimeType,
      originalSize,
      storedMimeType,
      storedSize,
      compressionRatio: originalSize > 0 ? Number((storedSize / originalSize).toFixed(4)) : 1,
    },
  };
}

/**
 * Read back a stored receipt file from whichever backend holds it.
 * Supports blob URLs, the relative local key written by storeReceiptFile,
 * and the legacy absolute/public paths written by earlier versions.
 */
export async function readReceiptFile(filePath: string): Promise<Buffer> {
  if (/^https?:\/\//i.test(filePath)) {
    const response = await fetch(filePath);
    if (!response.ok) {
      throw new Error(`Failed to fetch receipt file (${response.status})`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  const candidates: string[] = [];
  if (path.isAbsolute(filePath)) {
    candidates.push(filePath);
  } else {
    candidates.push(path.join(process.cwd(), filePath));
    // Legacy publicPath values look like "/receipts/<userId>/<file>".
    const trimmed = filePath.replace(/^[/\\]+/, '');
    candidates.push(path.join(process.cwd(), 'public', trimmed));
    candidates.push(path.join(process.cwd(), 'uploads', trimmed));
  }

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return await readFile(candidate);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Receipt file not found: ${filePath}`);
}
