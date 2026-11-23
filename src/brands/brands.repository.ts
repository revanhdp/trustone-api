import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

export interface BrandRow {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  product_count: number;
}

@Injectable()
export class BrandsRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Active brands that have at least one published product. */
  async listPublic(): Promise<BrandRow[]> {
    const { rows } = await this.db.query<BrandRow>(
      `SELECT b.id, b.name, b.slug, b.is_active, count(p.id)::int AS product_count
         FROM brands b
         JOIN products p ON p.brand_id = b.id AND p.status = 'published' AND p.deleted_at IS NULL
        WHERE b.is_active
        GROUP BY b.id
        ORDER BY lower(b.name)`,
    );
    return rows;
  }

  async listAll(): Promise<BrandRow[]> {
    const { rows } = await this.db.query<BrandRow>(
      `SELECT b.id, b.name, b.slug, b.is_active,
              (SELECT count(*)::int FROM products p WHERE p.brand_id = b.id AND p.deleted_at IS NULL) AS product_count
         FROM brands b ORDER BY lower(b.name)`,
    );
    return rows;
  }

  async findById(id: string): Promise<BrandRow | null> {
    const { rows } = await this.db.query<BrandRow>(
      `SELECT b.id, b.name, b.slug, b.is_active,
              (SELECT count(*)::int FROM products p WHERE p.brand_id = b.id AND p.deleted_at IS NULL) AS product_count
         FROM brands b WHERE b.id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async create(input: { name: string; slug: string; isActive: boolean }): Promise<string> {
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO brands (name, slug, is_active) VALUES ($1, $2, $3) RETURNING id`,
      [input.name, input.slug, input.isActive],
    );
    return rows[0].id;
  }

  async update(id: string, input: { name?: string; slug?: string; isActive?: boolean }): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE brands SET name = COALESCE($2, name), slug = COALESCE($3, slug), is_active = COALESCE($4, is_active)
        WHERE id = $1`,
      [id, input.name ?? null, input.slug ?? null, input.isActive ?? null],
    );
    return (rowCount ?? 0) > 0;
  }

  async countProducts(id: string): Promise<number> {
    const { rows } = await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM products WHERE brand_id = $1`, [id]);
    return rows[0].n;
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.db.query(`DELETE FROM brands WHERE id = $1`, [id]);
    return (rowCount ?? 0) > 0;
  }
}
