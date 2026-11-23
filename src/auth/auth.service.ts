import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { AppConfigService } from '../config/app-config.service.js';
import { UsersRepository } from '../users/users.repository.js';
import { dummyPasswordHash, verifyPassword } from './password.js';
import { SessionsRepository, SessionUser } from './sessions.repository.js';

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    private readonly config: AppConfigService,
  ) {}

  async login(email: string, password: string, meta: { ip: string | null; userAgent: string | null }) {
    const user = await this.users.findByEmail(email);
    // Always run a hash verification so response time does not reveal whether the email exists.
    const valid = await verifyPassword(password, user?.password_hash ?? (await dummyPasswordHash()));
    if (!user || !valid || !user.is_active) {
      throw new UnauthorizedException('Email atau password salah');
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.get('AUTH_SESSION_TTL_HOURS') * 3_600_000);
    await this.sessions.create({ userId: user.id, tokenHash: hashToken(token), expiresAt, ...meta });
    await this.users.touchLogin(user.id);
    void this.sessions.deleteExpired().catch(() => undefined);

    return {
      token,
      expiresAt: expiresAt.toISOString(),
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    };
  }

  async authenticate(token: string): Promise<SessionUser | null> {
    if (!token || token.length > 200) return null;
    return this.sessions.findValid(hashToken(token));
  }

  async logout(token: string): Promise<void> {
    await this.sessions.delete(hashToken(token));
  }
}
