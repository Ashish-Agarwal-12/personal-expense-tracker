import crypto from 'node:crypto';
import type { Collection } from 'mongodb';

/**
 * Single-user password login.
 * The session cookie is `<expiry>.<hmac>`; the HMAC key mixes in a hash of the password,
 * so changing APP_PASSWORD logs out every existing session.
 */

const COOKIE = 'sid';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest();

export interface Auth {
  passwordMatches(candidate: unknown): boolean;
  /** Set-Cookie header value for a new session. */
  sessionCookie(): string;
  /** Set-Cookie header value that logs out. */
  clearCookie(): string;
  isAuthed(cookieHeader: string | null): boolean;
}

export function createAuth({ password, secret, secureCookies }: { password: string; secret: string; secureCookies: boolean }): Auth {
  if (!password || password.length < 8) throw new Error('APP_PASSWORD must be set and at least 8 characters');
  if (!secret || secret.length < 16) throw new Error('SESSION_SECRET must be set and at least 16 characters');

  const passwordHash = sha256(password);
  const key = crypto.createHmac('sha256', secret).update(passwordHash).digest();
  const sign = (payload: string) => crypto.createHmac('sha256', key).update(payload).digest('base64url');
  const attrs = `Path=/; HttpOnly; SameSite=Strict${secureCookies ? '; Secure' : ''}`;

  function valid(token: string | null): boolean {
    if (!token) return false;
    const [exp, sig] = token.split('.');
    if (!exp || !sig || !/^\d+$/.test(exp)) return false;
    const expected = Buffer.from(sign(exp));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return false;
    return Number(exp) > Date.now();
  }

  function readCookie(header: string | null): string | null {
    for (const part of (header || '').split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === COOKIE) return decodeURIComponent(v.join('='));
    }
    return null;
  }

  return {
    passwordMatches(candidate) {
      if (typeof candidate !== 'string') return false;
      return crypto.timingSafeEqual(sha256(candidate), passwordHash);
    },
    sessionCookie() {
      const exp = String(Date.now() + SESSION_MS);
      return `${COOKIE}=${exp}.${sign(exp)}; Max-Age=${SESSION_MS / 1000}; ${attrs}`;
    },
    clearCookie() {
      return `${COOKIE}=; Max-Age=0; ${attrs}`;
    },
    isAuthed(cookieHeader) {
      return valid(readCookie(cookieHeader));
    },
  };
}

export interface LoginLimiter {
  blocked(ip: string): Promise<boolean>;
  fail(ip: string): Promise<void>;
  reset(ip: string): Promise<void>;
}

/**
 * Login attempt limiter: `max` failures per IP per window.
 * Stored in MongoDB (collection `login_attempts`, auto-expired by a TTL index) so the limit
 * holds across all serverless instances, not just the one that saw the attempts.
 */
export function createLoginLimiter(
  collection: Collection<{ _id: string; count: number; expireAt: Date }>,
  { max = 10, windowMs = 15 * 60 * 1000 } = {},
): LoginLimiter {
  return {
    async blocked(ip) {
      const h = await collection.findOne({ _id: ip, expireAt: { $gt: new Date() } });
      return !!h && h.count >= max;
    },
    async fail(ip) {
      const now = new Date();
      const r = await collection.updateOne({ _id: ip, expireAt: { $gt: now } }, { $inc: { count: 1 } });
      if (!r.matchedCount) {
        await collection.replaceOne({ _id: ip }, { count: 1, expireAt: new Date(now.getTime() + windowMs) }, { upsert: true });
      }
    },
    async reset(ip) {
      await collection.deleteOne({ _id: ip });
    },
  };
}
