import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AppConfigService } from '../config/app-config.service.js';
import { DatabaseService } from '../database/database.service.js';
import { safeOriginalName, validateImage } from '../files/file-validation.js';
import { StorageService } from '../storage/storage.service.js';
import { rethrowPgConflict } from '../common/utils/pg-errors.js';
import { slugify } from '../common/utils/slug.js';
import { emptyToNull } from '../common/utils/sql.js';
import { CategoriesRepository, CategoryRow } from './categories.repository.js';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto.js';

export function toCategory(row: CategoryRow, storage: StorageService) {
  return {
    imageUrl: row.image_key ? storage.publicUrl(row.image_key) : null,
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    productCount: row.product_count,
  };
}

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(
    private readonly repo: CategoriesRepository,
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly config: AppConfigService,
  ) {}

  async listPublic() {
    return (await this.repo.listPublic()).map((r) => {
      const { isActive: _a, sortOrder: _s, ...rest } = toCategory(r, this.storage);
      return rest;
    });
  }

  async listAll() {
    return (await this.repo.listAll()).map((r) => toCategory(r, this.storage));
  }

  async get(id: string) {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('Kategori tidak ditemukan');
    return toCategory(row, this.storage);
  }

  async create(dto: CreateCategoryDto) {
    const slug = dto.slug ?? slugify(dto.name);
    if (!slug) throw new BadRequestException('Slug tidak dapat dibuat dari nama; isi slug secara manual');
    try {
      const id = await this.repo.create({
        name: dto.name,
        slug,
        description: emptyToNull(dto.description),
        sortOrder: dto.sortOrder ?? (await this.repo.nextSortOrder()),
        isActive: dto.isActive ?? true,
      });
      return this.get(id);
    } catch (error) {
      rethrowPgConflict(error);
    }
  }

  async update(id: string, dto: UpdateCategoryDto) {
    try {
      const found = await this.repo.update(id, {
        name: dto.name,
        slug: dto.slug,
        sortOrder: dto.sortOrder,
        isActive: dto.isActive,
        description: dto.description === undefined ? undefined : emptyToNull(dto.description),
      });
      if (!found) throw new NotFoundException('Kategori tidak ditemukan');
      return this.get(id);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      rethrowPgConflict(error);
    }
  }

  async delete(id: string): Promise<void> {
    const used = await this.repo.countProducts(id);
    if (used > 0) {
      throw new ConflictException(
        `Kategori masih dipakai ${used} produk. Pindahkan produk ke kategori lain atau nonaktifkan kategori ini.`,
      );
    }
    if (!(await this.repo.delete(id))) throw new NotFoundException('Kategori tidak ditemukan');
  }

  /** Uploads (or replaces) the category background image. Stored in the public bucket. */
  async setImage(id: string, file: { buffer: Buffer; size: number; originalname?: string } | undefined, adminId: string) {
    if (!file) throw new BadRequestException('File wajib diunggah (field "file")');
    if (!(await this.repo.findById(id))) throw new NotFoundException('Kategori tidak ditemukan');
    const type = validateImage(file, this.config.get('UPLOAD_IMAGE_MAX_MB'));
    const objectKey = `categories/${id}/${randomUUID()}.${type.ext}`;
    await this.storage.putObject('public', objectKey, file.buffer, type.mime);
    let previous: { bucket: string; object_key: string } | null;
    try {
      previous = await this.db.transaction(async (client) => {
        const fileId = await this.repo.insertImageFile(client, {
          originalName: safeOriginalName(file.originalname, `kategori.${type.ext}`),
          objectKey,
          bucket: this.storage.publicBucket,
          mimeType: type.mime,
          sizeBytes: file.size,
          checksum: createHash('sha256').update(file.buffer).digest('hex'),
          uploadedBy: adminId,
        });
        const result = await this.repo.replaceImage(client, id, fileId);
        if (!result.found) throw new NotFoundException('Kategori tidak ditemukan');
        return result.previous;
      });
    } catch (error) {
      await this.removeQuietly(this.storage.publicBucket, objectKey);
      throw error;
    }
    if (previous) await this.removeQuietly(previous.bucket, previous.object_key);
    return this.get(id);
  }

  async removeImage(id: string) {
    const result = await this.db.transaction((client) => this.repo.replaceImage(client, id, null));
    if (!result.found) throw new NotFoundException('Kategori tidak ditemukan');
    if (result.previous) await this.removeQuietly(result.previous.bucket, result.previous.object_key);
    return this.get(id);
  }

  private async removeQuietly(bucket: string, key: string): Promise<void> {
    try {
      await this.storage.removeObject(bucket, key);
    } catch (error) {
      this.logger.warn(`Could not remove object ${bucket}/${key}: ${(error as Error).message}`);
    }
  }
}
