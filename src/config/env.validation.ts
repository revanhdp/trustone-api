import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  validateSync,
} from 'class-validator';

const toBoolean = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? ['1', 'true', 'yes'].includes(value.toLowerCase()) : value;
const toInt = ({ value }: { value: unknown }) => (typeof value === 'string' ? Number.parseInt(value, 10) : value);

/** Environment variables read by the api. See `.env.example` at the repository root. */
export class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: 'development' | 'test' | 'production' = 'development';

  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(65535)
  API_PORT = 4000;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(100)
  DATABASE_POOL_MAX = 10;

  /** Comma-separated list of allowed browser origins. */
  @IsString()
  CORS_ORIGINS = 'http://localhost:3000';

  @IsString()
  @IsNotEmpty()
  STORAGE_ENDPOINT: string;

  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(65535)
  STORAGE_PORT = 9000;

  @Transform(toBoolean)
  @IsBoolean()
  STORAGE_USE_SSL = false;

  @IsString()
  @IsNotEmpty()
  STORAGE_ACCESS_KEY: string;

  @IsString()
  @IsNotEmpty()
  STORAGE_SECRET_KEY: string;

  @IsString()
  STORAGE_REGION = 'us-east-1';

  @IsString()
  @IsNotEmpty()
  STORAGE_PUBLIC_BUCKET: string;

  @IsString()
  @IsNotEmpty()
  STORAGE_PRIVATE_BUCKET: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  STORAGE_PUBLIC_BASE_URL?: string;

  @Transform(toBoolean)
  @IsBoolean()
  STORAGE_AUTO_CREATE_BUCKETS = false;

  @Transform(toInt)
  @IsInt()
  @Min(30)
  @Max(3600)
  STORAGE_PRESIGNED_TTL_SECONDS = 300;

  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(720)
  AUTH_SESSION_TTL_HOURS = 12;

  /**
   * Express "trust proxy" setting, so rate limiting sees the real client IP behind the web BFF / reverse proxy.
   * Examples: "loopback", "1" (one hop), "10.0.0.0/8". Use "false" when the api is reached directly.
   */
  @IsString()
  TRUST_PROXY = 'loopback';

  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(50)
  UPLOAD_IMAGE_MAX_MB = 5;

  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(100)
  UPLOAD_DOCUMENT_MAX_MB = 20;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, { exposeDefaultValues: true });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors
      .map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${details}`);
  }
  return validated;
}
