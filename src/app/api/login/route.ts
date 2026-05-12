import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSession, sessionCookieOptions, verifyEnvPassword, SESSION_COOKIE } from '@/lib/auth';
import { logError } from '@/lib/logger';

export async function POST(req: Request) {
  try {
    const { password } = (await req.json()) as { password?: string };
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: 'Password required' }, { status: 400 });
    }
    const ok = await verifyEnvPassword(password);
    if (!ok) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }
    const token = await createSession();
    const jar = await cookies();
    jar.set(SESSION_COOKIE, token, sessionCookieOptions());
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError(err, 'api-login');
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
