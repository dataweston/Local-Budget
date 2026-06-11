import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authorizeServiceRequest } from '@/lib/service-auth';
import { buildPnlReport } from '@/lib/pnl';

export const dynamic = 'force-dynamic';

/**
 * GET /api/integration/v1/pnl?year=2026
 *
 * Profit & loss summary using the same classification method as
 * local-effort-app's generate-local-budget-pnl.cjs, so both repos report
 * identical numbers. Bearer-token authenticated via INTEGRATION_API_TOKEN.
 */
export async function GET(req: NextRequest) {
  const auth = authorizeServiceRequest(req, process.env.INTEGRATION_API_TOKEN, 'INTEGRATION_API_TOKEN');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const yearParam = req.nextUrl.searchParams.get('year');
  const year = yearParam ? Number(yearParam) : new Date().getUTCFullYear();
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
  }

  const report = await buildPnlReport(db, year);
  return NextResponse.json({ report });
}
