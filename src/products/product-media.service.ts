import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AppConfigService } from '../config/app-config.service.js';
import { DatabaseService } from '../database/database.service.js';
import { safeOriginalName, validateImage, validatePdf } from '../files/file-validation.js';
import { StorageService } from '../storage/storage.service.js';
import { UpdateDocumentDto, UpdateImageDto, UploadDocumentDto } from './dto/product.dto.js';
import { toDocument, toImage } from './product.mappers.js';
import { ProductsRepository } from './products.repository.js';

export interface UploadedFile {
  buffer: Buffer;
  size: number;
  originalname?: string;
}

/** Product images (public bucket) and documents (private bucket). */
@Injectable()
export class ProductMediaService {
  private readonly logger = new Logger(ProductMediaService.name);

  constructor(
    private readonly repo: ProductsRepository,
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly config: AppConfigService,
  ) {}

  async uploadImage(productId: string, file: UploadedFile | undefined, altText: string | undefined, adminId: string) {
    await this.assertProduct(productId);
    const upload = this.requireFile(file);
    const type = validateImage(upload, this.config.get('UPLOAD_IMAGE_MAX_MB'));
    const objectKey = `products/${productId}/images/${randomUUID()}.${type.ext}`;
    await this.storage.putObject('public', objectKey, upload.buffer, type.mime);
    try {
      await this.db.transaction(async (client) => {
        const fileId = await this.repo.insertFile(client, {
          originalName: safeOriginalName(upload.originalname, `image.${type.ext}`),
          objectKey,
          bucket: this.storage.publicBucket,
          mimeType: type.mime,
          sizeBytes: upload.size,
          checksum: createHash('sha256').update(upload.buffer).digest('hex'),
          visibility: 'public',
          uploadedBy: adminId,
        });
        await this.repo.insertImage(client, productId, fileId, altText?.trim() || null);
      });
    } catch (error) {
      await this.removeQuietly(this.storage.publicBucket, objectKey);
      throw error;
    }
    return this.images(productId);
  }

  async updateImage(productId: string, imageId: string, dto: UpdateImageDto) {
    const found = await this.db.transaction((client) =>
      this.repo.updateImage(client, productId, imageId, {
        altText: dto.altText === undefined ? undefined : dto.altText?.trim() || null,
        isPrimary: dto.isPrimary === false ? undefined : dto.isPrimary,
        sortOrder: dto.sortOrder,
      }),
    );
    if (!found) throw new NotFoundException('Gambar tidak ditemukan');
    return this.images(productId);
  }

  async deleteImage(productId: string, imageId: string) {
    const removed = await this.db.transaction((client) => this.repo.deleteImage(client, productId, imageId));
    if (!removed) throw new NotFoundException('Gambar tidak ditemukan');
    await this.removeQuietly(removed.bucket, removed.object_key);
    return this.images(productId);
  }

  async uploadDocument(productId: string, file: UploadedFile | undefined, dto: UploadDocumentDto, adminId: string) {
    await this.assertProduct(productId);
    const upload = this.requireFile(file);
    const type = validatePdf(upload, this.config.get('UPLOAD_DOCUMENT_MAX_MB'));
    const objectKey = `products/${productId}/documents/${randomUUID()}.${type.ext}`;
    await this.storage.putObject('private', objectKey, upload.buffer, type.mime);
    try {
      await this.db.transaction(async (client) => {
        const fileId = await this.repo.insertFile(client, {
          originalName: safeOriginalName(upload.originalname, 'dokumen.pdf'),
          objectKey,
          bucket: this.storage.privateBucket,
          mimeType: type.mime,
          sizeBytes: upload.size,
          checksum: createHash('sha256').update(upload.buffer).digest('hex'),
          visibility: 'private',
          uploadedBy: adminId,
        });
        await this.repo.insertDocument(client, productId, fileId, {
          title: dto.title,
          documentType: dto.documentType ?? 'other',
          isPublic: dto.isPublic ?? false,
        });
      });
    } catch (error) {
      await this.removeQuietly(this.storage.privateBucket, objectKey);
      throw error;
    }
    return this.documents(productId);
  }

  async updateDocument(productId: string, documentId: string, dto: UpdateDocumentDto) {
    if (!(await this.repo.updateDocument(productId, documentId, dto))) {
      throw new NotFoundException('Dokumen tidak ditemukan');
    }
    return this.documents(productId);
  }

  async deleteDocument(productId: string, documentId: string) {
    const removed = await this.db.transaction((client) => this.repo.deleteDocument(client, productId, documentId));
    if (!removed) throw new NotFoundException('Dokumen tidak ditemukan');
    await this.removeQuietly(removed.bucket, removed.object_key);
    return this.documents(productId);
  }

  private async images(productId: string) {
    return (await this.repo.listImages(productId)).map((i) => toImage(i, this.storage));
  }

  private async documents(productId: string) {
    return (await this.repo.listDocuments(productId, false)).map(toDocument);
  }

  private async assertProduct(productId: string): Promise<void> {
    if (!(await this.repo.productExists(productId))) throw new NotFoundException('Produk tidak ditemukan');
  }

  private requireFile(file: UploadedFile | undefined): UploadedFile {
    if (!file) throw new NotFoundException('File wajib diunggah (field "file")');
    return file;
  }

  private async removeQuietly(bucket: string, key: string): Promise<void> {
    try {
      await this.storage.removeObject(bucket, key);
    } catch (error) {
      this.logger.warn(`Could not remove object ${bucket}/${key}: ${(error as Error).message}`);
    }
  }
}
