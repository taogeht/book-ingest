import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { generateBundle, checkExportReadiness } from '@/lib/export/bundle';
import { logError } from '@/lib/logger';

export const maxDuration = 60;

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) return new NextResponse('Unauthorized', { status: 401 });
  const { id } = await ctx.params;
  try {
    const readiness = await checkExportReadiness(id);
    if (!readiness.ready) {
      return NextResponse.json(
        { error: 'Not ready', reasons: readiness.reasons },
        { status: 400 },
      );
    }
    const result = await generateBundle(id);
    return NextResponse.json(result);
  } catch (err) {
    logError(err, 'api-export');
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
