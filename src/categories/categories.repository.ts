import { Injectable } from '@nestjs/common';
import type pg from 'pg';
import { DatabaseService } from '../database/database.service.js';

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  product_count: number;
  image_key: string | null;
  created_at: Date;
  updated_at: Date;
}

const SELECT = `
  SELECT c.id, c.name, c.slug, c.description, c.sort_order, c.is_active, c.created_at, c.updated_at,
         (SELECT f.object_key FROM files f WHERE f.id = c.image_file_id) AS image_key`;

@Injectable()
export class CategoriesRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Active categories with their number of published products. */
  async listPublic(): Promise<CategoryRow[]> {
    const { rows } = await this.db.query<CategoryRow>(
      `${SELECT},
         (SELECT count(*)::int FROM products p
           WHERE p.category_id = c.id AND p.status = 'published' AND p.deleted_at IS NULL) AS product_count
         FROM categories c WHERE c.is_active ORDER BY c.sort_order, c.name`,
    );
    return rows;
  }

  /** All categories with their number of (non-deleted) products in any status. */
  async listAll(): Promise<CategoryRow[]> {
    const { rows } = await this.db.query<CategoryRow>(
      `${SELECT},
         (SELECT count(*)::int FROM products p WHERE p.category_id = c.id AND p.deleted_at IS NULL) AS product_count
         FROM categories c ORDER BY c.sort_order, c.name`,
    );
    return rows;
  }

  async findById(id: string): Promise<CategoryRow | null> {
    const { rows } = await this.db.query<CategoryRow>(
      `${SELECT},
         (SELECT count(*)::int FROM products p WHERE p.category_id = c.id AND p.deleted_at IS NULL) AS product_count
         FROM categories c WHERE c.id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async nextSortOrder(): Promise<number> {
    const { rows } = await this.db.query<{ next: number }>(
      `SELECT COALESCE(max(sort_order), 0) + 10 AS next FROM categories`,
    );
    return rows[0].next;
  }

  async create(input: { name: string; slug: string; description: string | null; sortOrder: number; isActive: boolean }) {
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO categories (name, slug, description, sort_order, is_active) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [input.name, input.slug, input.description, input.sortOrder, input.isActive],
    );
    return rows[0].id;
  }

  async update(
    id: string,
    input: { name?: string; slug?: string; description?: string | null; sortOrder?: number; isActive?: boolean },
  ): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE categories SET
         name = COALESCE($2, name),
         slug = COALESCE($3, slug),
         description = CASE WHEN $4::boolean THEN $5 ELSE description END,
         sort_order = COALESCE($6, sort_order),
         is_active = COALESCE($7, is_active)
       WHERE id = $1`,
      [
        id,
        input.name ?? null,
        input.slug ?? null,
        input.description !== undefined,
        input.description ?? null,
        input.sortOrder ?? null,
        input.isActive ?? null,
      ],
    );
    return (rowCount ?? 0) > 0;
  }

  /** Counts every product (including archived and soft-deleted) that still references the category. */
  async countProducts(id: string): Promise<number> {
    const { rows } = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM products WHERE category_id = $1`,
      [id],
    );
    return rows[0].n;
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.db.query(`DELETE FROM categories WHERE id = $1`, [id]);
    return (rowCount ?? 0) > 0;
  }

  async insertImageFile(
    client: pg.PoolClient,
    f: { originalName: string; objectKey: string; bucket: string; mimeType: string; sizeBytes: number; checksum: string; uploadedBy: string },
  ): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO files (original_name, object_key, bucket, mime_type, size_bytes, checksum_sha256, visibility, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'public', $7) RETURNING id`,
      [f.originalName, f.objectKey, f.bucket, f.mimeType, f.sizeBytes, f.checksum, f.uploadedBy],
    );
    return rows[0].id;
  }

  /** Points the category at a new image file (or none). Returns the previous file so the caller can delete it. */
  async replaceImage(
    client: pg.PoolClient,
    categoryId: string,
    fileId: string | null,
  ): Promise<{ found: boolean; previous: { id: string; bucket: string; object_key: string } | null }> {
    const { rows } = await client.query<{ id: string | null; bucket: string | null; object_key: string | null }>(
      `SELECT f.id, f.bucket, f.object_key FROM categories c LEFT JOIN files f ON f.id = c.image_file_id
        WHERE c.id = $1 FOR UPDATE OF c`,
      [categoryId],
    );
    if (rows.length === 0) return { found: false, previous: null };
    await client.query(`UPDATE categories SET image_file_id = $2 WHERE id = $1`, [categoryId, fileId]);
    const prev = rows[0];
    if (prev.id) await client.query(`DELETE FROM files WHERE id = $1`, [prev.id]);
    return {
      found: true,
      previous: prev.id && prev.bucket && prev.object_key ? { id: prev.id, bucket: prev.bucket, object_key: prev.object_key } : null,
    };
  }
}
