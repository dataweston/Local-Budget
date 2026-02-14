import { mkdir, writeFile } from 'fs/promises';
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

export async function storeReceiptFile(input: StoreReceiptFileInput): Promise<StoreReceiptFileResult> {
  const uploadRoot = path.join(process.cwd(), 'public', 'receipts');
  const userDir = path.join(uploadRoot, input.userId);
  await mkdir(userDir, { recursive: true });

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
  const filePath = path.join(userDir, fileName);
  await writeFile(filePath, storedBuffer);

  const relativePath = path.relative(path.join(process.cwd(), 'public'), filePath).replace(/\\/g, '/');
  const publicPath = relativePath.startsWith('..') ? `/receipts/${input.userId}/${fileName}` : `/${relativePath}`;
  const storedSize = storedBuffer.length;

  return {
    filePath,
    publicPath,
    fileType: storedMimeType,
    fileSize: storedSize,
    ocrBuffer: storedBuffer,
    storageMeta: {
      source: input.source,
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
