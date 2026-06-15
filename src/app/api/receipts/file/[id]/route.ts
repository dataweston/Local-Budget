import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { readReceiptFile } from '@/lib/receipt-storage';

/**
 * Serve a receipt file to its owner. Replaces the old unauthenticated
 * /public/receipts/<userId>/<file> paths.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const receipt = await db.receipt.findFirst({
    where: { id: params.id, userId: session.user.id },
    select: { filePath: true, fileType: true, fileName: true },
  });

  if (!receipt) {
    return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });
  }

  try {
    const buffer = await readReceiptFile(receipt.filePath);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': receipt.fileType || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${receipt.fileName.replace(/"/g, '')}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Failed to read receipt file:', error);
    return NextResponse.json({ error: 'Receipt file unavailable' }, { status: 404 });
  }
}
