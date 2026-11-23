import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: 'admin';
  is_active: boolean;
  last_login_at: Date | null;
}

@Injectable()
export class UsersRepository {
  constructor(private readonly db: DatabaseService) {}

  async findByEmail(email: string): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>(
      `SELECT id, name, email, password_hash, role, is_active, last_login_at
         FROM users WHERE lower(email) = lower($1)`,
      [email],
    );
    return rows[0] ?? null;
  }

  async create(input: { name: string; email: string; passwordHash: string; role: 'admin' }): Promise<string> {
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.name, input.email, input.passwordHash, input.role],
    );
    return rows[0].id;
  }

  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await this.db.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [id, passwordHash]);
  }

  async touchLogin(id: string): Promise<void> {
    await this.db.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [id]);
  }
}
