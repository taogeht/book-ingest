import { NextResponse } from 'next/server';
import { db, detectedUnits } from '@/lib/db';
import { and, eq } from 'drizzle-orm';
import { isAuthenticated } from '@/lib/auth';
import { logError } from '@/lib/logger';

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; unitId: string }> },
) {
  if (!(await isAuthenticated())) return new NextResponse('Unauthorized', { status: 401 });
  const { id: projectId, unitId } = await ctx.params;
  try {
    const body = (await req.json()) as Partial<{
      reviewed: boolean;
      unitTitle: string;
      startPage: number;
      endPage: number;
    }>;
    await db
      .update(detectedUnits)
      .set({
        reviewed: body.reviewed ?? undefined,
        unitTitle: body.unitTitle ?? undefined,
        startPage: body.startPage ?? undefined,
        endPage: body.endPage ?? undefined,
      })
      .where(and(eq(detectedUnits.id, unitId), eq(detectedUnits.projectId, projectId)));
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError(err, 'api-units-patch');
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
