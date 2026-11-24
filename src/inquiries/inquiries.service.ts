import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { pageMeta } from '../common/dto/pagination.dto.js';
import { emptyToNull } from '../common/utils/sql.js';
import type { SessionUser } from '../auth/sessions.repository.js';
import type { AdminInquiryQueryDto, CreateInquiryDto, UpdateInquiryDto } from './dto/inquiry.dto.js';
import {
  InquiriesRepository,
  type InquiryItemRow,
  type InquiryRow,
  type NewInquiryItem,
} from './inquiries.repository.js';

/** Normalizes Indonesian phone input to `+62…` (digits only after the plus). */
export function normalizeWhatsapp(raw: string): string | null {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith('8')) digits = `62${digits}`;
  return /^[0-9]{8,16}$/.test(digits) ? `+${digits}` : null;
}

export function formatReferenceCode(year: number, sequence: number): string {
  return `INQ-${year}-${String(sequence).padStart(6, '0')}`;
}

const toItem = (r: InquiryItemRow) => ({
  id: r.id,
  productId: r.product_id,
  productSlug: r.product_slug,
  variantId: r.variant_id,
  productName: r.product_name_snapshot,
  sku: r.sku_snapshot,
  variantName: r.variant_name_snapshot,
  quantity: r.quantity,
  customerNote: r.customer_note,
});

const toInquiry = (r: InquiryRow) => ({
  id: r.id,
  referenceCode: r.reference_code,
  customerName: r.customer_name,
  companyName: r.company_name,
  whatsappNumber: r.whatsapp_number,
  email: r.email,
  generalNote: r.general_note,
  internalNote: r.internal_note,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

@Injectable()
export class InquiriesService {
  constructor(private readonly repo: InquiriesRepository) {}

  /**
   * Saves the inquiry with product snapshots. Only published products can be requested; the
   * response intentionally omits internal fields (internal note, ids of other customers' data).
   */
  async createPublic(dto: CreateInquiryDto) {
    const whatsapp = normalizeWhatsapp(dto.whatsappNumber);
    if (!whatsapp) throw new BadRequestException({ message: 'Nomor WhatsApp tidak valid', details: { field: 'whatsappNumber' } });

    // Same product + variant listed twice → one line with summed quantity.
    const merged = new Map<string, Pick<CreateInquiryDto['items'][number], 'productId' | 'variantId' | 'quantity' | 'customerNote'>>();
    for (const item of dto.items) {
      const key = `${item.productId}:${item.variantId ?? ''}`;
      const existing = merged.get(key);
      if (existing) existing.quantity = Math.min(100_000, existing.quantity + item.quantity);
      else merged.set(key, { productId: item.productId, variantId: item.variantId, quantity: item.quantity, customerNote: item.customerNote });
    }
    const lines = [...merged.values()];

    const year = new Date().getFullYear();
    const result = await this.repo.database.transaction(async (tx) => {
      const products = new Map(
        (await this.repo.publishedProducts(tx, [...new Set(lines.map((l) => l.productId))])).map((p) => [p.id, p]),
      );
      const variantIds = [...new Set(lines.flatMap((l) => (l.variantId ? [l.variantId] : [])))];
      const variants = new Map((await this.repo.activeVariants(tx, variantIds)).map((v) => [v.id, v]));

      const unavailable: string[] = [];
      const items: NewInquiryItem[] = [];
      for (const line of lines) {
        const product = products.get(line.productId);
        const variant = line.variantId ? variants.get(line.variantId) : undefined;
        if (!product || (line.variantId && (!variant || variant.product_id !== line.productId))) {
          unavailable.push(line.productId);
          continue;
        }
        items.push({
          productId: product.id,
          variantId: variant?.id ?? null,
          productName: product.name,
          sku: variant?.sku ?? product.sku,
          variantName: variant?.name ?? null,
          quantity: line.quantity,
          customerNote: emptyToNull(line.customerNote),
        });
      }
      if (unavailable.length > 0) {
        throw new BadRequestException({
          message: 'Sebagian produk sudah tidak tersedia di katalog',
          details: { productIds: unavailable },
        });
      }

      const sequence = await this.repo.nextCounter(tx, 'inquiry', String(year));
      const inquiry = await this.repo.insertInquiry(tx, {
        referenceCode: formatReferenceCode(year, sequence),
        customerName: dto.customerName,
        companyName: emptyToNull(dto.companyName),
        whatsappNumber: whatsapp,
        email: emptyToNull(dto.email),
        generalNote: emptyToNull(dto.generalNote),
      });
      await this.repo.insertItems(tx, inquiry.id, items);
      await this.repo.audit(tx, {
        entityId: inquiry.id,
        action: 'created',
        actorUserId: null,
        actorType: 'customer',
        data: { itemCount: items.length },
      });
      return { inquiry, items };
    });

    return {
      referenceCode: result.inquiry.reference_code,
      createdAt: result.inquiry.created_at,
      customerName: result.inquiry.customer_name,
      companyName: result.inquiry.company_name,
      items: result.items.map((i) => ({
        productName: i.productName,
        sku: i.sku,
        variantName: i.variantName,
        quantity: i.quantity,
        customerNote: i.customerNote,
      })),
    };
  }

  async listAdmin(q: AdminInquiryQueryDto) {
    const [{ rows, total }, counts] = await Promise.all([
      this.repo.list({ status: q.status, q: emptyToNull(q.q) ?? undefined, page: q.page, pageSize: q.pageSize }),
      this.repo.statusCounts(),
    ]);
    return {
      data: rows.map((r) => ({ ...toInquiry(r), itemCount: r.item_count, totalQuantity: r.total_quantity })),
      meta: { ...pageMeta(q.page, q.pageSize, total), statusCounts: counts },
    };
  }

  async getAdmin(id: string) {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('Permintaan tidak ditemukan');
    return { ...toInquiry(row), items: (await this.repo.itemsOf(id)).map(toItem) };
  }

  async update(id: string, dto: UpdateInquiryDto, admin: SessionUser) {
    await this.repo.database.transaction(async (tx) => {
      const current = await this.repo.findById(id, tx);
      if (!current) throw new NotFoundException('Permintaan tidak ditemukan');
      const internalNote = dto.internalNote === undefined ? undefined : emptyToNull(dto.internalNote);
      await this.repo.update(tx, id, { status: dto.status, internalNote });
      if (dto.status && dto.status !== current.status) {
        await this.repo.audit(tx, {
          entityId: id,
          action: 'status_changed',
          actorUserId: admin.user_id,
          actorType: 'admin',
          data: { from: current.status, to: dto.status },
        });
      }
      if (internalNote !== undefined && internalNote !== current.internal_note) {
        await this.repo.audit(tx, { entityId: id, action: 'internal_note_changed', actorUserId: admin.user_id, actorType: 'admin' });
      }
    });
    return this.getAdmin(id);
  }
}
