import { Injectable } from '@nestjs/common';
import type pg from 'pg';
import { DatabaseService, type Queryable } from '../database/database.service.js';
import { likeContains } from '../common/utils/sql.js';
import type { ADMIN_SORTS, ProductStatus, PUBLIC_SORTS } from './dto/product.dto.js';

export type SpecItem = { key: string; value: string | string[] };

export interface ProductCardRow {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  short_description: string | null;
  is_featured: boolean;
  availability_status: string | null;
  category_name: string;
  category_slug: string;
  brand_name: string | null;
  brand_slug: string | null;
  image_key: string | null;
  image_alt: string | null;
}

export interface ProductDetailRow extends ProductCardRow {
  category_id: string;
  brand_id: string | null;
  description: string | null;
  specs: SpecItem[];
  status: ProductStatus;
  needs_review: boolean;
  review_notes: string[];
  source_page: number | null;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface AdminListRow extends ProductCardRow {
  status: ProductStatus;
  needs_review: boolean;
  source_page: number | null;
  updated_at: Date;
}

export interface ImageRow {
  id: string;
  file_id: string;
  object_key: string;
  bucket: string;
  alt_text: string | null;
  sort_order: number;
  is_primary: boolean;
}

export interface DocumentRow {
  id: string;
  file_id: string;
  object_key: string;
  bucket: string;
  original_name: string;
  mime_type: string;
  size_bytes: string;
  title: string;
  document_type: string;
  is_public: boolean;
  sort_order: number;
}

export interface VariantRow {
  id: string;
  name: string;
  sku: string | null;
  attributes: Record<string, string | string[]>;
  sort_order: number;
  is_active: boolean;
}

export interface ProductWrite {
  name: string;
  slug: string;
  sku: string | null;
  brandId: string | null;
  categoryId: string;
  shortDescription: string | null;
  description: string | null;
  specs: SpecItem[];
  availabilityStatus: string | null;
  isFeatured: boolean;
  status: ProductStatus;
  needsReview: boolean;
  reviewNotes: string[];
}

const CARD_COLUMNS = `
  p.id, p.name, p.slug, p.sku, p.short_description, p.is_featured, p.availability_status,
  c.name AS category_name, c.slug AS category_slug,
  b.name AS brand_name, b.slug AS brand_slug,
  img.object_key AS image_key, img.alt_text AS image_alt`;

const CARD_JOINS = `
  JOIN categories c ON c.id = p.category_id
  LEFT JOIN brands b ON b.id = p.brand_id
  LEFT JOIN LATERAL (
    SELECT f.object_key, pi.alt_text
      FROM product_images pi JOIN files f ON f.id = pi.file_id
     WHERE pi.product_id = p.id
     ORDER BY pi.is_primary DESC, pi.sort_order, pi.created_at
     LIMIT 1
  ) img ON true`;

const SEARCH_CONDITION = (param: string) => `(
  p.name ILIKE ${param} ESCAPE '\\' OR p.sku ILIKE ${param} ESCAPE '\\'
  OR b.name ILIKE ${param} ESCAPE '\\' OR p.short_description ILIKE ${param} ESCAPE '\\')`;

// ORDER BY clauses come only from these allowlists, never from user input.
const PUBLIC_ORDER: Record<(typeof PUBLIC_SORTS)[number], string> = {
  name_asc: 'lower(p.name) ASC, p.id',
  name_desc: 'lower(p.name) DESC, p.id',
  newest: 'p.published_at DESC NULLS LAST, p.created_at DESC, p.id',
};

const ADMIN_ORDER: Record<(typeof ADMIN_SORTS)[number], string> = {
  updated_desc: 'p.updated_at DESC, p.id',
  created_desc: 'p.created_at DESC, p.id',
  name_asc: 'lower(p.name) ASC, p.id',
  name_desc: 'lower(p.name) DESC, p.id',
  source_page: 'p.source_page ASC NULLS LAST, p.created_at, p.id',
};

/** Builds "$n" placeholders while collecting parameters. */
class Params {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

@Injectable()
export class ProductsRepository {
  constructor(private readonly db: DatabaseService) {}

  // ---------------------------------------------------------------- public

  async listPublic(f: {
    q?: string;
    category?: string;
    brand?: string;
    featured?: boolean;
    sort: (typeof PUBLIC_SORTS)[number];
    limit: number;
    offset: number;
  }): Promise<{ rows: ProductCardRow[]; total: number }> {
    const p = new Params();
    const where = [`p.status = 'published'`, `p.deleted_at IS NULL`, `c.is_active`];
    if (f.q) where.push(SEARCH_CONDITION(p.add(likeContains(f.q))));
    if (f.category) where.push(`c.slug = ${p.add(f.category)}`);
    if (f.brand) where.push(`b.slug = ${p.add(f.brand)}`);
    if (f.featured !== undefined) where.push(`p.is_featured = ${p.add(f.featured)}`);
    const limit = p.add(f.limit);
    const offset = p.add(f.offset);
    const { rows } = await this.db.query<ProductCardRow & { total: string }>(
      `SELECT ${CARD_COLUMNS}, count(*) OVER() AS total
         FROM products p ${CARD_JOINS}
        WHERE ${where.join(' AND ')}
        ORDER BY ${PUBLIC_ORDER[f.sort]}
        LIMIT ${limit} OFFSET ${offset}`,
      p.values,
    );
    return { rows, total: rows.length > 0 ? Number(rows[0].total) : 0 };
  }

  async findPublishedBySlug(slug: string): Promise<ProductDetailRow | null> {
    const { rows } = await this.db.query<ProductDetailRow>(
      `SELECT ${CARD_COLUMNS}, p.category_id, p.brand_id, p.description, p.specs, p.status, p.needs_review,
              p.review_notes, p.source_page, p.published_at, p.created_at, p.updated_at
         FROM products p ${CARD_JOINS}
        WHERE p.slug = $1 AND p.status = 'published' AND p.deleted_at IS NULL AND c.is_active`,
      [slug],
    );
    return rows[0] ?? null;
  }

  /** Published related products: manual relations first; falls back to the same category. */
  async listPublicRelated(productId: string, categoryId: string, limit: number): Promise<ProductCardRow[]> {
    const { rows } = await this.db.query<ProductCardRow>(
      `WITH manual AS (
         SELECT ${CARD_COLUMNS}, 0 AS grp, r.sort_order AS ord
           FROM product_related r JOIN products p ON p.id = r.related_product_id ${CARD_JOINS}
          WHERE r.product_id = $1 AND p.status = 'published' AND p.deleted_at IS NULL AND c.is_active
       ), same_category AS (
         SELECT ${CARD_COLUMNS}, 1 AS grp, 0 AS ord
           FROM products p ${CARD_JOINS}
          WHERE p.category_id = $2 AND p.id <> $1 AND p.status = 'published' AND p.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM product_related r WHERE r.product_id = $1 AND r.related_product_id = p.id)
          ORDER BY p.is_featured DESC, lower(p.name)
          LIMIT $3
       )
       SELECT * FROM (SELECT * FROM manual UNION ALL SELECT * FROM same_category) x
        ORDER BY grp, ord, lower(name) LIMIT $3`,
      [productId, categoryId, limit],
    );
    return rows;
  }

  // ---------------------------------------------------------------- admin

  async listAdmin(f: {
    q?: string;
    status?: ProductStatus;
    categoryId?: string;
    brandId?: string;
    needsReview?: boolean;
    sort: (typeof ADMIN_SORTS)[number];
    limit: number;
    offset: number;
  }): Promise<{ rows: AdminListRow[]; total: number }> {
    const p = new Params();
    const where = [`p.deleted_at IS NULL`];
    if (f.q) where.push(SEARCH_CONDITION(p.add(likeContains(f.q))));
    if (f.status) where.push(`p.status = ${p.add(f.status)}`);
    if (f.categoryId) where.push(`p.category_id = ${p.add(f.categoryId)}`);
    if (f.brandId) where.push(`p.brand_id = ${p.add(f.brandId)}`);
    if (f.needsReview !== undefined) where.push(`p.needs_review = ${p.add(f.needsReview)}`);
    const limit = p.add(f.limit);
    const offset = p.add(f.offset);
    const { rows } = await this.db.query<AdminListRow & { total: string }>(
      `SELECT ${CARD_COLUMNS}, p.status, p.needs_review, p.source_page, p.updated_at, count(*) OVER() AS total
         FROM products p ${CARD_JOINS}
        WHERE ${where.join(' AND ')}
        ORDER BY ${ADMIN_ORDER[f.sort]}
        LIMIT ${limit} OFFSET ${offset}`,
      p.values,
    );
    return { rows, total: rows.length > 0 ? Number(rows[0].total) : 0 };
  }

  async findById(id: string, q: Queryable = this.db): Promise<ProductDetailRow | null> {
    const { rows } = await q.query<ProductDetailRow>(
      `SELECT ${CARD_COLUMNS}, p.category_id, p.brand_id, p.description, p.specs, p.status, p.needs_review,
              p.review_notes, p.source_page, p.published_at, p.created_at, p.updated_at
         FROM products p ${CARD_JOINS}
        WHERE p.id = $1 AND p.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  }

  async listAdminRelated(productId: string): Promise<Array<{ id: string; name: string; slug: string; status: string }>> {
    const { rows } = await this.db.query<{ id: string; name: string; slug: string; status: string }>(
      `SELECT p.id, p.name, p.slug, p.status
         FROM product_related r JOIN products p ON p.id = r.related_product_id
        WHERE r.product_id = $1 AND p.deleted_at IS NULL
        ORDER BY r.sort_order`,
      [productId],
    );
    return rows;
  }

  async slugTaken(slug: string, exceptId?: string, q: Queryable = this.db): Promise<boolean> {
    const { rows } = await q.query(`SELECT 1 FROM products WHERE slug = $1 AND ($2::uuid IS NULL OR id <> $2)`, [
      slug,
      exceptId ?? null,
    ]);
    return rows.length > 0;
  }

  async insert(client: pg.PoolClient, w: ProductWrite): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO products (name, slug, sku, brand_id, category_id, short_description, description, specs,
                             availability_status, is_featured, status, needs_review, review_notes, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13,
               CASE WHEN $11 = 'published' THEN now() END)
       RETURNING id`,
      [
        w.name,
        w.slug,
        w.sku,
        w.brandId,
        w.categoryId,
        w.shortDescription,
        w.description,
        JSON.stringify(w.specs),
        w.availabilityStatus,
        w.isFeatured,
        w.status,
        w.needsReview,
        w.reviewNotes,
      ],
    );
    return rows[0].id;
  }

  async update(client: pg.PoolClient, id: string, w: ProductWrite): Promise<void> {
    await client.query(
      `UPDATE products SET
         name = $2, slug = $3, sku = $4, brand_id = $5, category_id = $6, short_description = $7,
         description = $8, specs = $9::jsonb, availability_status = $10, is_featured = $11, status = $12,
         needs_review = $13, review_notes = $14,
         published_at = CASE WHEN $12 = 'published' AND published_at IS NULL THEN now() ELSE published_at END
       WHERE id = $1`,
      [
        id,
        w.name,
        w.slug,
        w.sku,
        w.brandId,
        w.categoryId,
        w.shortDescription,
        w.description,
        JSON.stringify(w.specs),
        w.availabilityStatus,
        w.isFeatured,
        w.status,
        w.needsReview,
        w.reviewNotes,
      ],
    );
  }

  async replaceVariants(
    client: pg.PoolClient,
    productId: string,
    variants: Array<{ name: string; sku: string | null; attributes: Record<string, unknown>; isActive: boolean }>,
  ): Promise<void> {
    await client.query(`DELETE FROM product_variants WHERE product_id = $1`, [productId]);
    for (const [i, v] of variants.entries()) {
      await client.query(
        `INSERT INTO product_variants (product_id, name, sku, attributes, sort_order, is_active)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
        [productId, v.name, v.sku, JSON.stringify(v.attributes), i, v.isActive],
      );
    }
  }

  async replaceRelated(client: pg.PoolClient, productId: string, relatedIds: string[]): Promise<void> {
    await client.query(`DELETE FROM product_related WHERE product_id = $1`, [productId]);
    for (const [i, relatedId] of relatedIds.entries()) {
      await client.query(
        `INSERT INTO product_related (product_id, related_product_id, sort_order) VALUES ($1, $2, $3)`,
        [productId, relatedId, i],
      );
    }
  }

  async existingIds(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const { rows } = await this.db.query<{ id: string }>(
      `SELECT id FROM products WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [ids],
    );
    return rows.map((r) => r.id);
  }

  async categoryExists(id: string): Promise<boolean> {
    const { rows } = await this.db.query(`SELECT 1 FROM categories WHERE id = $1`, [id]);
    return rows.length > 0;
  }

  async brandExists(id: string): Promise<boolean> {
    const { rows } = await this.db.query(`SELECT 1 FROM brands WHERE id = $1`, [id]);
    return rows.length > 0;
  }

  async isReferencedByInquiriesOrQuotations(id: string): Promise<boolean> {
    const { rows } = await this.db.query(
      `SELECT 1 WHERE EXISTS (SELECT 1 FROM inquiry_items WHERE product_id = $1)
                   OR EXISTS (SELECT 1 FROM quotation_items WHERE product_id = $1)`,
      [id],
    );
    return rows.length > 0;
  }

  /** Hard delete. Returns the files that belonged to the product so the caller can remove the objects. */
  async delete(client: pg.PoolClient, id: string): Promise<Array<{ id: string; bucket: string; object_key: string }>> {
    const { rows: files } = await client.query<{ id: string; bucket: string; object_key: string }>(
      `SELECT f.id, f.bucket, f.object_key FROM files f
        WHERE f.id IN (SELECT file_id FROM product_images WHERE product_id = $1
                       UNION SELECT file_id FROM product_documents WHERE product_id = $1)`,
      [id],
    );
    await client.query(`DELETE FROM products WHERE id = $1`, [id]);
    if (files.length > 0) {
      await client.query(`DELETE FROM files WHERE id = ANY($1::uuid[])`, [files.map((f) => f.id)]);
    }
    return files;
  }

  async bulkStatus(ids: string[], status: ProductStatus): Promise<number> {
    const { rowCount } = await this.db.query(
      `UPDATE products SET status = $2,
              published_at = CASE WHEN $2 = 'published' AND published_at IS NULL THEN now() ELSE published_at END
        WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [ids, status],
    );
    return rowCount ?? 0;
  }

  // ---------------------------------------------------------------- media

  async listImages(productId: string): Promise<ImageRow[]> {
    const { rows } = await this.db.query<ImageRow>(
      `SELECT pi.id, pi.file_id, f.object_key, f.bucket, pi.alt_text, pi.sort_order, pi.is_primary
         FROM product_images pi JOIN files f ON f.id = pi.file_id
        WHERE pi.product_id = $1
        ORDER BY pi.is_primary DESC, pi.sort_order, pi.created_at`,
      [productId],
    );
    return rows;
  }

  async listDocuments(productId: string, publicOnly: boolean): Promise<DocumentRow[]> {
    const { rows } = await this.db.query<DocumentRow>(
      `SELECT d.id, d.file_id, f.object_key, f.bucket, f.original_name, f.mime_type, f.size_bytes,
              d.title, d.document_type, d.is_public, d.sort_order
         FROM product_documents d JOIN files f ON f.id = d.file_id
        WHERE d.product_id = $1 AND (NOT $2 OR d.is_public)
        ORDER BY d.sort_order, d.created_at`,
      [productId, publicOnly],
    );
    return rows;
  }

  async listVariants(productId: string, activeOnly: boolean): Promise<VariantRow[]> {
    const { rows } = await this.db.query<VariantRow>(
      `SELECT id, name, sku, attributes, sort_order, is_active FROM product_variants
        WHERE product_id = $1 AND (NOT $2 OR is_active) ORDER BY sort_order, name`,
      [productId, activeOnly],
    );
    return rows;
  }

  async insertFile(
    client: pg.PoolClient,
    f: {
      originalName: string;
      objectKey: string;
      bucket: string;
      mimeType: string;
      sizeBytes: number;
      checksum: string;
      visibility: 'public' | 'private';
      uploadedBy: string | null;
    },
  ): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO files (original_name, object_key, bucket, mime_type, size_bytes, checksum_sha256, visibility, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [f.originalName, f.objectKey, f.bucket, f.mimeType, f.sizeBytes, f.checksum, f.visibility, f.uploadedBy],
    );
    return rows[0].id;
  }

  async insertImage(client: pg.PoolClient, productId: string, fileId: string, altText: string | null): Promise<string> {
    // Lock the product row so concurrent uploads agree on which image becomes primary.
    await client.query(`SELECT 1 FROM products WHERE id = $1 FOR UPDATE`, [productId]);
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO product_images (product_id, file_id, alt_text, sort_order, is_primary)
       SELECT $1, $2, $3,
              COALESCE((SELECT max(sort_order) + 1 FROM product_images WHERE product_id = $1), 0),
              NOT EXISTS (SELECT 1 FROM product_images WHERE product_id = $1 AND is_primary)
       RETURNING id`,
      [productId, fileId, altText],
    );
    return rows[0].id;
  }

  async updateImage(
    client: pg.PoolClient,
    productId: string,
    imageId: string,
    u: { altText?: string | null; isPrimary?: boolean; sortOrder?: number },
  ): Promise<boolean> {
    if (u.isPrimary) {
      await client.query(`UPDATE product_images SET is_primary = false WHERE product_id = $1 AND id <> $2`, [
        productId,
        imageId,
      ]);
    }
    const { rowCount } = await client.query(
      `UPDATE product_images SET
         alt_text = CASE WHEN $3::boolean THEN $4 ELSE alt_text END,
         is_primary = COALESCE($5, is_primary),
         sort_order = COALESCE($6, sort_order)
       WHERE id = $2 AND product_id = $1`,
      [productId, imageId, u.altText !== undefined, u.altText ?? null, u.isPrimary ?? null, u.sortOrder ?? null],
    );
    return (rowCount ?? 0) > 0;
  }

  /** Deletes an image (and its file row); promotes the next image to primary if needed. */
  async deleteImage(
    client: pg.PoolClient,
    productId: string,
    imageId: string,
  ): Promise<{ bucket: string; object_key: string } | null> {
    const { rows } = await client.query<{ file_id: string; is_primary: boolean; bucket: string; object_key: string }>(
      `DELETE FROM product_images pi USING files f
        WHERE pi.id = $2 AND pi.product_id = $1 AND f.id = pi.file_id
        RETURNING pi.file_id, pi.is_primary, f.bucket, f.object_key`,
      [productId, imageId],
    );
    const deleted = rows[0];
    if (!deleted) return null;
    await client.query(`DELETE FROM files WHERE id = $1`, [deleted.file_id]);
    if (deleted.is_primary) {
      await client.query(
        `UPDATE product_images SET is_primary = true
          WHERE id = (SELECT id FROM product_images WHERE product_id = $1 ORDER BY sort_order, created_at LIMIT 1)`,
        [productId],
      );
    }
    return { bucket: deleted.bucket, object_key: deleted.object_key };
  }

  async insertDocument(
    client: pg.PoolClient,
    productId: string,
    fileId: string,
    d: { title: string; documentType: string; isPublic: boolean },
  ): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO product_documents (product_id, file_id, title, document_type, is_public, sort_order)
       SELECT $1, $2, $3, $4, $5, COALESCE((SELECT max(sort_order) + 1 FROM product_documents WHERE product_id = $1), 0)
       RETURNING id`,
      [productId, fileId, d.title, d.documentType, d.isPublic],
    );
    return rows[0].id;
  }

  async updateDocument(
    productId: string,
    documentId: string,
    u: { title?: string; documentType?: string; isPublic?: boolean; sortOrder?: number },
  ): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE product_documents SET
         title = COALESCE($3, title), document_type = COALESCE($4, document_type),
         is_public = COALESCE($5, is_public), sort_order = COALESCE($6, sort_order)
       WHERE id = $2 AND product_id = $1`,
      [productId, documentId, u.title ?? null, u.documentType ?? null, u.isPublic ?? null, u.sortOrder ?? null],
    );
    return (rowCount ?? 0) > 0;
  }

  async deleteDocument(
    client: pg.PoolClient,
    productId: string,
    documentId: string,
  ): Promise<{ bucket: string; object_key: string } | null> {
    const { rows } = await client.query<{ file_id: string; bucket: string; object_key: string }>(
      `DELETE FROM product_documents d USING files f
        WHERE d.id = $2 AND d.product_id = $1 AND f.id = d.file_id
        RETURNING d.file_id, f.bucket, f.object_key`,
      [productId, documentId],
    );
    const deleted = rows[0];
    if (!deleted) return null;
    await client.query(`DELETE FROM files WHERE id = $1`, [deleted.file_id]);
    return { bucket: deleted.bucket, object_key: deleted.object_key };
  }

  async findDocument(productId: string, documentId: string): Promise<DocumentRow | null> {
    const { rows } = await this.db.query<DocumentRow>(
      `SELECT d.id, d.file_id, f.object_key, f.bucket, f.original_name, f.mime_type, f.size_bytes,
              d.title, d.document_type, d.is_public, d.sort_order
         FROM product_documents d JOIN files f ON f.id = d.file_id
        WHERE d.product_id = $1 AND d.id = $2`,
      [productId, documentId],
    );
    return rows[0] ?? null;
  }

  async productExists(id: string): Promise<boolean> {
    const { rows } = await this.db.query(`SELECT 1 FROM products WHERE id = $1 AND deleted_at IS NULL`, [id]);
    return rows.length > 0;
  }

  async findPublishedIdBySlug(slug: string): Promise<string | null> {
    const { rows } = await this.db.query<{ id: string }>(
      `SELECT p.id FROM products p JOIN categories c ON c.id = p.category_id
        WHERE p.slug = $1 AND p.status = 'published' AND p.deleted_at IS NULL AND c.is_active`,
      [slug],
    );
    return rows[0]?.id ?? null;
  }
}
