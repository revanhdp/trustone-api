import { ConflictException } from '@nestjs/common';

interface PgError {
  code?: string;
  constraint?: string;
}

const UNIQUE_MESSAGES: Record<string, string> = {
  categories_slug_key: 'Slug kategori sudah dipakai',
  brands_slug_key: 'Slug brand sudah dipakai',
  brands_name_lower_uq: 'Nama brand sudah ada',
  products_slug_key: 'Slug produk sudah dipakai',
  products_sku_uq: 'SKU sudah dipakai produk lain',
  product_variants_sku_uq: 'SKU varian sudah dipakai',
  users_email_lower_uq: 'Email sudah terdaftar',
};

/** Converts known PostgreSQL constraint violations into 409 responses; rethrows anything else. */
export function rethrowPgConflict(error: unknown): never {
  const e = error as PgError;
  if (e?.code === '23505') {
    throw new ConflictException(UNIQUE_MESSAGES[e.constraint ?? ''] ?? 'Data duplikat');
  }
  if (e?.code === '23503') {
    throw new ConflictException('Data masih direferensikan oleh data lain');
  }
  throw error;
}
