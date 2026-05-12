import { NextResponse } from 'next/server';
import { db, ingestionProjects } from '@/lib/db';
import { isAuthenticated } from '@/lib/auth';
import { logError } from '@/lib/logger';

export async function POST(req: Request) {
  if (!(await isAuthenticated())) return new NextResponse('Unauthorized', { status: 401 });
  try {
    const { name, curriculumName, targetLevel, language } = (await req.json()) as {
      name?: string;
      curriculumName?: string;
      targetLevel?: number | null;
      language?: string;
    };
    if (!name || !curriculumName) {
      return NextResponse.json({ error: 'name and curriculumName required' }, { status: 400 });
    }
    const [row] = await db
      .insert(ingestionProjects)
      .values({
        name,
        curriculumName,
        targetLevel: targetLevel ?? null,
        language: language || 'en',
      })
      .returning({ id: ingestionProjects.id });
    return NextResponse.json({ id: row.id });
  } catch (err) {
    logError(err, 'api-projects-post');
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
