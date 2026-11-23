import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client } from 'minio';
import { AppConfigService } from '../config/app-config.service.js';

export type FileVisibility = 'public' | 'private';

/**
 * S3-compatible object storage (MinIO). Credentials stay on the server:
 * browsers only ever receive public object URLs or short-lived presigned URLs.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: Client;

  constructor(private readonly config: AppConfigService) {
    this.client = new Client({
      endPoint: config.get('STORAGE_ENDPOINT'),
      port: config.get('STORAGE_PORT'),
      useSSL: config.get('STORAGE_USE_SSL'),
      accessKey: config.get('STORAGE_ACCESS_KEY'),
      secretKey: config.get('STORAGE_SECRET_KEY'),
      region: config.get('STORAGE_REGION'),
    });
  }

  get publicBucket(): string {
    return this.config.get('STORAGE_PUBLIC_BUCKET');
  }

  get privateBucket(): string {
    return this.config.get('STORAGE_PRIVATE_BUCKET');
  }

  bucketFor(visibility: FileVisibility): string {
    return visibility === 'public' ? this.publicBucket : this.privateBucket;
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.get('STORAGE_AUTO_CREATE_BUCKETS')) return;
    try {
      await this.ensureBuckets();
    } catch (error) {
      // Do not crash the api when storage is down; /health reports it.
      this.logger.error(`Could not prepare storage buckets: ${(error as Error).message}`);
    }
  }

  /** Creates both buckets if missing; the public bucket gets anonymous read-only access to objects. */
  async ensureBuckets(): Promise<void> {
    const region = this.config.get('STORAGE_REGION');
    for (const bucket of [this.publicBucket, this.privateBucket]) {
      if (!(await this.client.bucketExists(bucket))) {
        await this.client.makeBucket(bucket, region);
        this.logger.log(`Created bucket ${bucket}`);
      }
    }
    const publicReadPolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${this.publicBucket}/*`],
        },
      ],
    };
    await this.client.setBucketPolicy(this.publicBucket, JSON.stringify(publicReadPolicy));
  }

  /** Throws when storage is unreachable or a bucket is missing. */
  async ping(): Promise<void> {
    for (const bucket of [this.publicBucket, this.privateBucket]) {
      if (!(await this.client.bucketExists(bucket))) throw new Error(`Bucket ${bucket} does not exist`);
    }
  }

  publicUrl(objectKey: string): string | null {
    const base = this.config.get('STORAGE_PUBLIC_BASE_URL');
    if (!base) return null;
    return `${base.replace(/\/+$/, '')}/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
  }

  async putObject(visibility: FileVisibility, objectKey: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.putObject(this.bucketFor(visibility), objectKey, body, body.length, {
      'Content-Type': contentType,
      // Public catalog images are immutable (new upload = new key), so they can be cached long.
      ...(visibility === 'public' ? { 'Cache-Control': 'public, max-age=31536000, immutable' } : {}),
    });
  }

  async removeObject(bucket: string, objectKey: string): Promise<void> {
    await this.client.removeObject(bucket, objectKey);
  }

  async objectExists(bucket: string, objectKey: string): Promise<boolean> {
    try {
      await this.client.statObject(bucket, objectKey);
      return true;
    } catch {
      return false;
    }
  }

  presignedGetUrl(objectKey: string, downloadName?: string): Promise<string> {
    const headers = downloadName
      ? { 'response-content-disposition': `attachment; filename="${downloadName.replace(/["\\\r\n]/g, '_')}"` }
      : undefined;
    return this.client.presignedGetObject(
      this.privateBucket,
      objectKey,
      this.config.get('STORAGE_PRESIGNED_TTL_SECONDS'),
      headers,
    );
  }
}
