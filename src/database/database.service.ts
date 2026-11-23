import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import pg from 'pg';
import { AppConfigService } from '../config/app-config.service.js';

// Return NUMERIC (money) as string to avoid floating point; BIGINT stays string too.
// DATE is returned as 'YYYY-MM-DD' string instead of a JS Date in local time.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

/** Anything that can run a parameterized query: the service itself or a transaction client. */
export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<pg.QueryResult<R>>;
}

/**
 * Thin wrapper over a pg Pool. Repositories use it with parameterized SQL only
 * (`$1, $2, ...`); never interpolate user input into SQL text.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: pg.Pool;

  constructor(config: AppConfigService) {
    this.pool = new pg.Pool({
      connectionString: config.get('DATABASE_URL'),
      max: config.get('DATABASE_POOL_MAX'),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    this.pool.on('error', (err) => this.logger.error(`Idle PostgreSQL client error: ${err.message}`));
  }

  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []) {
    return this.pool.query<R>(text, params);
  }

  /** Runs `fn` inside a transaction; rolls back on any thrown error. */
  async transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
