import { Injectable } from '@nestjs/common';
import { DatabaseService, type Queryable } from '../database/database.service.js';
import { likeContains } from '../common/utils/sql.js';
import type { InquiryStatus } from './dto/inquiry.dto.js';

export interface InquiryRow {
  id: string;
  reference_code: string;
  customer_name: string;
  company_name: string | null;
  whatsapp_number: string;
  email: string | null;
  general_note: string | null;
  internal_note: string | null;
  status: InquiryStatus;
  created_at: Date;
  updated_at: Date;
}

export interface InquiryItemRow {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  product_name_snapshot: string;
  sku_snapshot: string | null;
  variant_name_snapshot: string | null;
  quantity: number;
  customer_note: string | null;
  product_slug: string | null;
}

export interface ProductSnapshotRow {
  id: string;
  name: string;
  sku: string | null;
}

export interface VariantSnapshotRow {
  id: string;
  product_id: string;
  name: string;
  sku: string | null;
}

export interface NewInquiryItem {
  productId: string;
  variantId: string | null;
  productName: string;
  sku: string | null;
  variantName: string | null;
  quantity: number;
  customerNote: string | null;
}

@Injectable()
export class InquiriesRepository {
  constructor(private readonly db: DatabaseService) {}

  get database(): DatabaseService {
    return this.db;
  }

  async publishedProducts(tx: Queryable, ids: string[]): Promise<ProductSnapshotRow[]> {
    const { rows } = await tx.query<ProductSnapshotRow>(
      `SELECT id, name, sku FROM products
        WHERE id = ANY($1::uuid[]) AND status = 'published' AND deleted_at IS NULL`,
      [ids],
    );
    return rows;
  }

  async activeVariants(tx: Queryable, ids: string[]): Promise<VariantSnapshotRow[]> {
    if (ids.length === 0) return [];
    const { rows } = await tx.query<VariantSnapshotRow>(
      `SELECT id, product_id, name, sku FROM product_variants WHERE id = ANY($1::uuid[]) AND is_active`,
      [ids],
    );
    return rows;
  }

  /** Concurrency-safe next number for `scope` in `period` (single atomic upsert). */
  async nextCounter(tx: Queryable, scope: string, period: string): Promise<number> {
    const { rows } = await tx.query<{ last_value: number }>(
      `INSERT INTO document_counters (scope, period, last_value) VALUES ($1, $2, 1)
       ON CONFLICT (scope, period) DO UPDATE SET last_value = document_counters.last_value + 1
       RETURNING last_value`,
      [scope, period],
    );
    return rows[0].last_value;
  }

  async insertInquiry(
    tx: Queryable,
    v: {
      referenceCode: string;
      customerName: string;
      companyName: string | null;
      whatsappNumber: string;
      email: string | null;
      generalNote: string | null;
    },
  ): Promise<InquiryRow> {
    const { rows } = await tx.query<InquiryRow>(
      `INSERT INTO inquiries (reference_code, customer_name, company_name, whatsapp_number, email, general_note)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [v.referenceCode, v.customerName, v.companyName, v.whatsappNumber, v.email, v.generalNote],
    );
    return rows[0];
  }

  async insertItems(tx: Queryable, inquiryId: string, items: NewInquiryItem[]): Promise<void> {
    for (const [index, item] of items.entries()) {
      await tx.query(
        `INSERT INTO inquiry_items
           (inquiry_id, product_id, variant_id, product_name_snapshot, sku_snapshot, variant_name_snapshot,
            quantity, customer_note, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [inquiryId, item.productId, item.variantId, item.productName, item.sku, item.variantName, item.quantity, item.customerNote, index],
      );
    }
  }

  async audit(
    tx: Queryable,
    entry: { entityId: string; action: string; actorUserId: string | null; actorType: 'admin' | 'customer' | 'system'; data?: unknown },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, actor_user_id, actor_type, data)
       VALUES ('inquiry', $1, $2, $3, $4, $5::jsonb)`,
      [entry.entityId, entry.action, entry.actorUserId, entry.actorType, JSON.stringify(entry.data ?? {})],
    );
  }

  async list(opts: { status?: InquiryStatus; q?: string; page: number; pageSize: number }) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.status) {
      params.push(opts.status);
      where.push(`i.status = $${params.length}`);
    }
    if (opts.q) {
      params.push(likeContains(opts.q));
      const p = `$${params.length}`;
      where.push(
        `(i.reference_code ILIKE ${p} ESCAPE '\\' OR i.customer_name ILIKE ${p} ESCAPE '\\'
          OR i.company_name ILIKE ${p} ESCAPE '\\' OR i.whatsapp_number ILIKE ${p} ESCAPE '\\')`,
      );
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number(
      (await this.db.query<{ n: string }>(`SELECT count(*) AS n FROM inquiries i ${whereSql}`, params)).rows[0].n,
    );
    params.push(opts.pageSize, (opts.page - 1) * opts.pageSize);
    const { rows } = await this.db.query<InquiryRow & { item_count: number; total_quantity: number }>(
      `SELECT i.*,
              (SELECT count(*)::int FROM inquiry_items ii WHERE ii.inquiry_id = i.id) AS item_count,
              (SELECT COALESCE(sum(quantity), 0)::int FROM inquiry_items ii WHERE ii.inquiry_id = i.id) AS total_quantity
         FROM inquiries i ${whereSql}
        ORDER BY i.created_at DESC, i.id
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { rows, total };
  }

  async statusCounts(): Promise<Record<string, number>> {
    const { rows } = await this.db.query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n FROM inquiries GROUP BY status`,
    );
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  }

  async findById(id: string, tx: Queryable = this.db): Promise<InquiryRow | null> {
    const { rows } = await tx.query<InquiryRow>(`SELECT * FROM inquiries WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }

  async itemsOf(inquiryId: string, tx: Queryable = this.db): Promise<InquiryItemRow[]> {
    const { rows } = await tx.query<InquiryItemRow>(
      `SELECT ii.id, ii.product_id, ii.variant_id, ii.product_name_snapshot, ii.sku_snapshot,
              ii.variant_name_snapshot, ii.quantity, ii.customer_note, p.slug AS product_slug
         FROM inquiry_items ii
         LEFT JOIN products p ON p.id = ii.product_id AND p.deleted_at IS NULL
        WHERE ii.inquiry_id = $1
        ORDER BY ii.sort_order`,
      [inquiryId],
    );
    return rows;
  }

  async update(
    tx: Queryable,
    id: string,
    patch: { status?: InquiryStatus; internalNote?: string | null },
  ): Promise<InquiryRow | null> {
    const sets: string[] = [];
    const params: unknown[] = [id];
    if (patch.status !== undefined) {
      params.push(patch.status);
      sets.push(`status = $${params.length}`);
    }
    if (patch.internalNote !== undefined) {
      params.push(patch.internalNote);
      sets.push(`internal_note = $${params.length}`);
    }
    if (sets.length === 0) return this.findById(id, tx);
    const { rows } = await tx.query<InquiryRow>(`UPDATE inquiries SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
    return rows[0] ?? null;
  }
}
