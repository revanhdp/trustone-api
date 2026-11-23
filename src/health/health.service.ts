import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { StorageService } from '../storage/storage.service.js';

export type ComponentStatus = 'up' | 'down';

export interface HealthReport {
  status: 'ok' | 'degraded';
  checks: { database: ComponentStatus; storage: ComponentStatus };
  timestamp: string;
}

const TIMEOUT_MS = 3_000;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
  ]);
}

@Injectable()
export class HealthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
  ) {}

  async check(): Promise<HealthReport> {
    const [database, storage] = await Promise.all([
      withTimeout(this.database.ping()).then(
        () => 'up' as const,
        () => 'down' as const,
      ),
      withTimeout(this.storage.ping()).then(
        () => 'up' as const,
        () => 'down' as const,
      ),
    ]);
    return {
      status: database === 'up' && storage === 'up' ? 'ok' : 'degraded',
      checks: { database, storage },
      timestamp: new Date().toISOString(),
    };
  }
}
