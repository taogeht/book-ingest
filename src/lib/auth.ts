import { cookies } from 'next/headers';
import { db, systemSettings } from './db';
import { eq } from 'drizzle-orm';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { SESSION_COOKIE } from './auth-constants';

export { SESSION_COOKIE };
const SESSION_TOKEN_HASH_KEY = 'session_token_hash';
const SESSION_TTL_DAYS = 30;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function constantTimeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export async function verifyEnvPassword(plain: string): Promise<boolean> {
  const expected = process.env.INGEST_PASSWORD;
  if (!expected) throw new Error('INGEST_PASSWORD is not set');
  if (plain.length !== expected.length) return false;
  return constantTimeEquals(plain, expected);
}

export async function createSession(): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  await db
    .insert(systemSettings)
    .values({ key: SESSION_TOKEN_HASH_KEY, value: tokenHash })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: tokenHash, updatedAt: new Date() },
    });
  return token;
}

export async function validateSessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const row = await db.query.systemSettings.findFirst({
    where: eq(systemSettings.key, SESSION_TOKEN_HASH_KEY),
  });
  if (!row) return false;
  return constantTimeEquals(hashToken(token), row.value);
}

export async function destroySession(): Promise<void> {
  await db.delete(systemSettings).where(eq(systemSettings.key, SESSION_TOKEN_HASH_KEY));
}

export async function getSessionToken(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value;
}

export async function isAuthenticated(): Promise<boolean> {
  const token = await getSessionToken();
  return validateSessionToken(token);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * SESSION_TTL_DAYS,
  };
}
