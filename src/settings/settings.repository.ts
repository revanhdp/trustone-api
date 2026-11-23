import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class SettingsRepository {
  constructor(private readonly db: DatabaseService) {}

  async getMany(keys: readonly string[]): Promise<Record<string, unknown>> {
    const { rows } = await this.db.query<{ key: string; value: unknown }>(
      `SELECT key, value FROM settings WHERE key = ANY($1::text[])`,
      [keys],
    );
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }
}
