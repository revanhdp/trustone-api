import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

export interface SessionUser {
  session_id: string;
  user_id: string;
  name: string;
  email: string;
  role: 'admin';
}

@Injectable()
export class SessionsRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(input: {
    userId: string;
    tokenHash: Buffer;
    expiresAt: Date;
    ip: string | null;
    userAgent: string | null;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO admin_sessions (user_id, token_hash, expires_at, ip, user_agent) VALUES ($1, $2, $3, $4, $5)`,
      [input.userId, input.tokenHash, input.expiresAt, input.ip, input.userAgent],
    );
  }

  /** Active session of an active user, or null. Also records last use. */
  async findValid(tokenHash: Buffer): Promise<SessionUser | null> {
    const { rows } = await this.db.query<SessionUser>(
      `UPDATE admin_sessions s SET last_used_at = now()
         FROM users u
        WHERE s.token_hash = $1 AND s.expires_at > now() AND u.id = s.user_id AND u.is_active
        RETURNING s.id AS session_id, u.id AS user_id, u.name, u.email, u.role`,
      [tokenHash],
    );
    return rows[0] ?? null;
  }

  async delete(tokenHash: Buffer): Promise<void> {
    await this.db.query(`DELETE FROM admin_sessions WHERE token_hash = $1`, [tokenHash]);
  }

  async deleteExpired(): Promise<void> {
    await this.db.query(`DELETE FROM admin_sessions WHERE expires_at <= now()`);
  }
}
