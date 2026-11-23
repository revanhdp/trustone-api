import { Injectable } from '@nestjs/common';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type pg from 'pg';
import { slugify } from '../common/utils/slug.js';
import { DatabaseService } from '../database/database.service.js';

type AttrValue = string | string[];

export interface ExtractedProduct {
  source_page: number;
  category_slug: string;
  name: string;
  sku: string | null;
  brand: string | null;
  brand_source: 'text' | 'logo' | null;
  short_description: string | null;
  description: string | null;
  attributes: Record<string, AttrValue>;
  variants: Array<{ name: string; sku: string | null; attributes: Record<string, AttrValue> }>;
  image_hint: string | null;
  review_notes: string[];
}

export interface ImportPlanItem {
  importKey: string;
  product: ExtractedProduct;
  sku: string | null;
  notes: string[];
}

export interface ImportResult {
  total: number;
  inserted: number;
  skipped: number;
  brandsCreated: number;
}

const SOURCE = 'catalog-2026';

/**
 * Pure planning step: stable import keys, SKU de-duplication and review notes.
 * Exported for unit tests.
 */
export function planImport(products: ExtractedProduct[]): ImportPlanItem[] {
  const skuCount = new Map<string, number>();
  for (const p of products) {
    const sku = p.sku?.trim().toLowerCase();
    if (sku) skuCount.set(sku, (skuCount.get(sku) ?? 0) + 1);
  }
  const keyCount = new Map<string, number>();
  return products.map((p) => {
    const baseKey = `${SOURCE}:p${p.source_page}:${slugify(p.name) || 'produk'}`;
    const n = (keyCount.get(baseKey) ?? 0) + 1;
    keyCount.set(baseKey, n);
    const importKey = n === 1 ? baseKey : `${baseKey}:${n}`;

    const notes = [`Diimpor dari katalog PDF 2026 halaman ${p.source_page}; periksa sebelum dipublikasikan.`];
    let sku = p.sku?.trim() || null;
    if (sku && (skuCount.get(sku.toLowerCase()) ?? 0) > 1) {
      notes.push(`SKU di katalog "${sku}" dipakai beberapa produk, sehingga dikosongkan. Isi SKU yang benar.`);
      sku = null;
    }
    if (p.brand && p.brand_source === 'logo') notes.push(`Brand "${p.brand}" dibaca dari logo pada katalog.`);
    if (p.image_hint) notes.push(`Foto produk ada di katalog hlm. ${p.source_page} (${p.image_hint}); unggah lewat admin.`);
    notes.push(...p.review_notes);
    return { importKey, product: p, sku, notes };
  });
}

/** Idempotent import of extracted catalog data: existing rows (same import key) are never touched. */
@Injectable()
export class CatalogImportService {
  constructor(private readonly db: DatabaseService) {}

  async loadDirectory(dir: string): Promise<ExtractedProduct[]> {
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
    const products: ExtractedProduct[] = [];
    for (const f of files) {
      const parsed = JSON.parse(await readFile(join(dir, f), 'utf8')) as { products: ExtractedProduct[] };
      products.push(...parsed.products);
    }
    return products.sort((a, b) => a.source_page - b.source_page);
  }

  async run(products: ExtractedProduct[]): Promise<ImportResult> {
    const plan = planImport(products);
    return this.db.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(74231002)');
      const categories = await this.categoryIds(client);
      const brands = await this.brandIds(client);
      let brandsCreated = 0;
      let inserted = 0;

      for (const item of plan) {
        const p = item.product;
        const categoryId = categories.get(p.category_slug);
        if (!categoryId) throw new Error(`Unknown category slug "${p.category_slug}" (${p.name}). Run db:seed first.`);

        const exists = await client.query('SELECT 1 FROM products WHERE import_key = $1', [item.importKey]);
        if (exists.rows.length > 0) continue;

        let brandId: string | null = null;
        if (p.brand?.trim()) {
          const key = p.brand.trim().toLowerCase();
          brandId = brands.get(key) ?? null;
          if (!brandId) {
            brandId = await this.createBrand(client, p.brand.trim());
            brands.set(key, brandId);
            brandsCreated++;
          }
        }

        const notes = [...item.notes];
        let sku = item.sku;
        if (sku && (await this.skuTaken(client, sku))) {
          notes.push(`SKU "${sku}" sudah dipakai produk lain di database, sehingga dikosongkan.`);
          sku = null;
        }

        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO products (name, slug, sku, brand_id, category_id, short_description, description, specs,
                                 status, needs_review, review_notes, source_page, import_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'draft', true, $9, $10, $11)
           ON CONFLICT (import_key) DO NOTHING
           RETURNING id`,
          [
            p.name.trim(),
            await this.uniqueSlug(client, p.name),
            sku,
            brandId,
            categoryId,
            p.short_description?.trim() || null,
            p.description?.trim() || null,
            JSON.stringify(Object.entries(p.attributes ?? {}).map(([key, value]) => ({ key, value }))),
            notes,
            p.source_page,
            item.importKey,
          ],
        );
        const productId = rows[0]?.id;
        if (!productId) continue;
        inserted++;

        for (const [i, v] of (p.variants ?? []).entries()) {
          const variantSku = v.sku?.trim() || null;
          const taken =
            variantSku !== null &&
            (await client.query('SELECT 1 FROM product_variants WHERE lower(sku) = lower($1)', [variantSku])).rows
              .length > 0;
          await client.query(
            `INSERT INTO product_variants (product_id, name, sku, attributes, sort_order) VALUES ($1, $2, $3, $4::jsonb, $5)`,
            [productId, v.name.trim(), taken ? null : variantSku, JSON.stringify(v.attributes ?? {}), i],
          );
        }
      }
      return { total: plan.length, inserted, skipped: plan.length - inserted, brandsCreated };
    });
  }

  private async categoryIds(client: pg.PoolClient): Promise<Map<string, string>> {
    const { rows } = await client.query<{ id: string; slug: string }>('SELECT id, slug FROM categories');
    return new Map(rows.map((r) => [r.slug, r.id]));
  }

  private async brandIds(client: pg.PoolClient): Promise<Map<string, string>> {
    const { rows } = await client.query<{ id: string; name: string }>('SELECT id, name FROM brands');
    return new Map(rows.map((r) => [r.name.toLowerCase(), r.id]));
  }

  private async createBrand(client: pg.PoolClient, name: string): Promise<string> {
    const base = slugify(name) || 'brand';
    for (let i = 1; ; i++) {
      const slug = i === 1 ? base : `${base}-${i}`;
      const taken = await client.query('SELECT 1 FROM brands WHERE slug = $1', [slug]);
      if (taken.rows.length === 0) {
        const { rows } = await client.query<{ id: string }>(
          'INSERT INTO brands (name, slug) VALUES ($1, $2) RETURNING id',
          [name, slug],
        );
        return rows[0].id;
      }
    }
  }

  private async skuTaken(client: pg.PoolClient, sku: string): Promise<boolean> {
    const { rows } = await client.query(
      'SELECT 1 FROM products WHERE lower(sku) = lower($1) AND deleted_at IS NULL',
      [sku],
    );
    return rows.length > 0;
  }

  private async uniqueSlug(client: pg.PoolClient, name: string): Promise<string> {
    const base = slugify(name) || 'produk';
    for (let i = 1; ; i++) {
      const slug = i === 1 ? base : `${base}-${i}`;
      const { rows } = await client.query('SELECT 1 FROM products WHERE slug = $1', [slug]);
      if (rows.length === 0) return slug;
    }
  }
}
