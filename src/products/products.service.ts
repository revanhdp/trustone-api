import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { pageMeta } from '../common/dto/pagination.dto.js';
import { rethrowPgConflict } from '../common/utils/pg-errors.js';
import { slugify } from '../common/utils/slug.js';
import { emptyToNull } from '../common/utils/sql.js';
import { DatabaseService } from '../database/database.service.js';
import { StorageService } from '../storage/storage.service.js';
import {
  AdminProductQueryDto,
  BulkStatusDto,
  CreateProductDto,
  PublicProductQueryDto,
  UpdateProductDto,
} from './dto/product.dto.js';
import { toCard, toDocument, toImage, toVariant } from './product.mappers.js';
import { ProductDetailRow, ProductsRepository, ProductWrite, SpecItem } from './products.repository.js';

const RELATED_LIMIT = 4;

function cleanSpecs(specs: Array<{ key: string; value: string | string[] }>): SpecItem[] {
  return specs
    .map((s) => ({
      key: s.key.trim(),
      value: Array.isArray(s.value) ? s.value.map((v) => v.trim()).filter(Boolean) : s.value.trim(),
    }))
    .filter((s) => s.key && (Array.isArray(s.value) ? s.value.length > 0 : s.value !== ''));
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly repo: ProductsRepository,
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
  ) {}

  // ---------------------------------------------------------------- public

  async listPublic(q: PublicProductQueryDto) {
    const pageSize = Math.min(q.pageSize, 48);
    const { rows, total } = await this.repo.listPublic({
      q: q.q || undefined,
      category: q.category,
      brand: q.brand,
      featured: q.featured,
      sort: q.sort,
      limit: pageSize,
      offset: (q.page - 1) * pageSize,
    });
    return { data: rows.map((r) => toCard(r, this.storage)), meta: pageMeta(q.page, pageSize, total) };
  }

  async getPublic(slug: string) {
    const row = await this.repo.findPublishedBySlug(slug);
    if (!row) throw new NotFoundException('Produk tidak ditemukan');
    const [images, documents, variants, related] = await Promise.all([
      this.repo.listImages(row.id),
      this.repo.listDocuments(row.id, true),
      this.repo.listVariants(row.id, true),
      this.repo.listPublicRelated(row.id, row.category_id, RELATED_LIMIT),
    ]);
    const { isFeatured: _f, ...card } = toCard(row, this.storage);
    return {
      ...card,
      description: row.description,
      specs: row.specs,
      images: images.map((i) => {
        const { sortOrder: _s, ...img } = toImage(i, this.storage);
        return img;
      }),
      documents: documents.map((d) => {
        const { isPublic: _p, sortOrder: _s, ...doc } = toDocument(d);
        return doc;
      }),
      variants: variants.map((v) => {
        const { isActive: _a, ...variant } = toVariant(v);
        return variant;
      }),
      related: related.map((r) => toCard(r, this.storage)),
    };
  }

  /** Short-lived download URL for a public document of a published product. */
  async publicDocumentUrl(slug: string, documentId: string) {
    const productId = await this.repo.findPublishedIdBySlug(slug);
    const doc = productId ? await this.repo.findDocument(productId, documentId) : null;
    if (!doc || !doc.is_public) throw new NotFoundException('Dokumen tidak ditemukan');
    return this.documentUrl(doc.object_key, doc.original_name);
  }

  // ---------------------------------------------------------------- admin

  async listAdmin(q: AdminProductQueryDto) {
    const { rows, total } = await this.repo.listAdmin({
      q: q.q || undefined,
      status: q.status,
      categoryId: q.categoryId,
      brandId: q.brandId,
      needsReview: q.needsReview,
      sort: q.sort,
      limit: q.pageSize,
      offset: (q.page - 1) * q.pageSize,
    });
    return {
      data: rows.map((r) => ({
        ...toCard(r, this.storage),
        status: r.status,
        needsReview: r.needs_review,
        sourcePage: r.source_page,
        updatedAt: r.updated_at,
      })),
      meta: pageMeta(q.page, q.pageSize, total),
    };
  }

  async getAdmin(id: string) {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('Produk tidak ditemukan');
    return this.toAdminDetail(row);
  }

  private async toAdminDetail(row: ProductDetailRow) {
    const [images, documents, variants, related] = await Promise.all([
      this.repo.listImages(row.id),
      this.repo.listDocuments(row.id, false),
      this.repo.listVariants(row.id, false),
      this.repo.listAdminRelated(row.id),
    ]);
    return {
      ...toCard(row, this.storage),
      categoryId: row.category_id,
      brandId: row.brand_id,
      description: row.description,
      specs: row.specs,
      status: row.status,
      needsReview: row.needs_review,
      reviewNotes: row.review_notes,
      sourcePage: row.source_page,
      publishedAt: row.published_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      images: images.map((i) => toImage(i, this.storage)),
      documents: documents.map(toDocument),
      variants: variants.map(toVariant),
      related,
    };
  }

  async create(dto: CreateProductDto) {
    await this.assertReferences(dto.categoryId, dto.brandId);
    const slug = dto.slug ?? (await this.uniqueSlug(dto.name));
    const write: ProductWrite = {
      name: dto.name,
      slug,
      sku: emptyToNull(dto.sku),
      brandId: dto.brandId ?? null,
      categoryId: dto.categoryId,
      shortDescription: emptyToNull(dto.shortDescription),
      description: emptyToNull(dto.description),
      specs: cleanSpecs(dto.specs ?? []),
      availabilityStatus: emptyToNull(dto.availabilityStatus),
      isFeatured: dto.isFeatured ?? false,
      status: dto.status ?? 'draft',
      needsReview: dto.needsReview ?? false,
      reviewNotes: [],
    };
    const related = await this.validRelated(dto.relatedProductIds);
    try {
      const id = await this.db.transaction(async (client) => {
        const newId = await this.repo.insert(client, write);
        if (dto.variants) await this.repo.replaceVariants(client, newId, this.cleanVariants(dto.variants));
        if (related) await this.repo.replaceRelated(client, newId, related);
        return newId;
      });
      return this.getAdmin(id);
    } catch (error) {
      rethrowPgConflict(error);
    }
  }

  async update(id: string, dto: UpdateProductDto) {
    const current = await this.repo.findById(id);
    if (!current) throw new NotFoundException('Produk tidak ditemukan');
    if (dto.categoryId !== undefined || dto.brandId !== undefined) {
      await this.assertReferences(dto.categoryId ?? current.category_id, dto.brandId);
    }
    const write: ProductWrite = {
      name: dto.name ?? current.name,
      slug: dto.slug ?? current.slug,
      sku: dto.sku !== undefined ? emptyToNull(dto.sku) : current.sku,
      brandId: dto.brandId !== undefined ? dto.brandId : current.brand_id,
      categoryId: dto.categoryId ?? current.category_id,
      shortDescription:
        dto.shortDescription !== undefined ? emptyToNull(dto.shortDescription) : current.short_description,
      description: dto.description !== undefined ? emptyToNull(dto.description) : current.description,
      specs: dto.specs !== undefined ? cleanSpecs(dto.specs) : current.specs,
      availabilityStatus:
        dto.availabilityStatus !== undefined ? emptyToNull(dto.availabilityStatus) : current.availability_status,
      isFeatured: dto.isFeatured ?? current.is_featured,
      status: dto.status ?? current.status,
      needsReview: dto.needsReview ?? current.needs_review,
      reviewNotes: dto.reviewNotes ?? current.review_notes,
    };
    const related = await this.validRelated(dto.relatedProductIds, id);
    try {
      await this.db.transaction(async (client) => {
        await this.repo.update(client, id, write);
        if (dto.variants) await this.repo.replaceVariants(client, id, this.cleanVariants(dto.variants));
        if (related) await this.repo.replaceRelated(client, id, related);
      });
    } catch (error) {
      rethrowPgConflict(error);
    }
    return this.getAdmin(id);
  }

  /**
   * Deletes a product permanently, unless it appears in inquiries/quotations:
   * then it must be archived instead, so history stays readable.
   */
  async delete(id: string): Promise<void> {
    if (!(await this.repo.productExists(id))) throw new NotFoundException('Produk tidak ditemukan');
    if (await this.repo.isReferencedByInquiriesOrQuotations(id)) {
      throw new ConflictException('Produk sudah memiliki riwayat inquiry/quotation. Arsipkan produk, jangan dihapus.');
    }
    const files = await this.db.transaction((client) => this.repo.delete(client, id));
    await Promise.allSettled(files.map((f) => this.storage.removeObject(f.bucket, f.object_key)));
  }

  async bulkStatus(dto: BulkStatusDto) {
    const updated = await this.repo.bulkStatus([...new Set(dto.ids)], dto.status);
    return { updated };
  }

  async adminDocumentUrl(productId: string, documentId: string) {
    const doc = await this.repo.findDocument(productId, documentId);
    if (!doc) throw new NotFoundException('Dokumen tidak ditemukan');
    return this.documentUrl(doc.object_key, doc.original_name);
  }

  // ---------------------------------------------------------------- helpers

  private async documentUrl(objectKey: string, fileName: string) {
    const ttl = 300;
    return {
      url: await this.storage.presignedGetUrl(objectKey, fileName),
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
  }

  private cleanVariants(variants: NonNullable<CreateProductDto['variants']>) {
    return variants.map((v) => ({
      name: v.name,
      sku: emptyToNull(v.sku),
      attributes: v.attributes ?? {},
      isActive: v.isActive ?? true,
    }));
  }

  private async assertReferences(categoryId: string, brandId: string | null | undefined): Promise<void> {
    if (!(await this.repo.categoryExists(categoryId))) throw new BadRequestException('Kategori tidak ditemukan');
    if (brandId && !(await this.repo.brandExists(brandId))) throw new BadRequestException('Brand tidak ditemukan');
  }

  private async validRelated(ids: string[] | undefined, selfId?: string): Promise<string[] | undefined> {
    if (ids === undefined) return undefined;
    const unique = [...new Set(ids)];
    if (selfId && unique.includes(selfId)) throw new BadRequestException('Produk tidak bisa terkait dengan dirinya sendiri');
    const existing = new Set(await this.repo.existingIds(unique));
    const missing = unique.filter((x) => !existing.has(x));
    if (missing.length > 0) throw new BadRequestException(`Produk terkait tidak ditemukan: ${missing.join(', ')}`);
    return unique;
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name) || 'produk';
    for (let i = 1; i < 1000; i++) {
      const candidate = i === 1 ? base : `${base}-${i}`;
      if (!(await this.repo.slugTaken(candidate))) return candidate;
    }
    throw new ConflictException('Tidak dapat membuat slug unik; isi slug secara manual');
  }
}
