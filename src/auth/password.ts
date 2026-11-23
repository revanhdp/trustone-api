import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const argon2Async = promisify(argon2);

// OWASP recommended minimum for Argon2id: m=19 MiB, t=2, p=1.
const PARAMS = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;

export const PASSWORD_MIN_LENGTH = 12;

/** Hashes a password with Argon2id (Node built-in) into a PHC string. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await argon2Async('argon2id', { message: password, nonce: salt, ...PARAMS });
  return `$argon2id$v=19$m=${PARAMS.memory},t=${PARAMS.passes},p=${PARAMS.parallelism}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

/** Verifies a password against a PHC string produced by hashPassword (constant-time compare). */
export async function verifyPassword(password: string, phc: string): Promise<boolean> {
  const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(phc);
  if (!match) return false;
  const [, m, t, p, saltB64, hashB64] = match;
  const expected = Buffer.from(hashB64, 'base64url');
  const actual = await argon2Async('argon2id', {
    message: password,
    nonce: Buffer.from(saltB64, 'base64url'),
    memory: Number(m),
    passes: Number(t),
    parallelism: Number(p),
    tagLength: expected.length,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Pre-computed hash used to keep login timing similar when the email does not exist.
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}
