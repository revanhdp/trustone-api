import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/http-exception.filter.js';

export const API_PREFIX = 'api/v1';

/** Global HTTP setup shared by main.ts and e2e tests. */
export function setupApp(app: INestApplication, corsOrigins: string[], trustProxy = 'loopback'): void {
  const expressApp = app as NestExpressApplication;
  expressApp.set('trust proxy', parseTrustProxy(trustProxy));
  expressApp.disable('x-powered-by');
  app.setGlobalPrefix(API_PREFIX);
  app.use(helmet());
  app.enableCors({ origin: corsOrigins, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
}

function parseTrustProxy(value: string): boolean | number | string {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}
