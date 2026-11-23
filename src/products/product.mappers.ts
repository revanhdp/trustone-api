import type { StorageService } from '../storage/storage.service.js';
import type { DocumentRow, ImageRow, ProductCardRow, VariantRow } from './products.repository.js';

export function toCard(r: ProductCardRow, storage: StorageService) {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    sku: r.sku,
    shortDescription: r.short_description,
    isFeatured: r.is_featured,
    availabilityStatus: r.availability_status,
    category: { name: r.category_name, slug: r.category_slug },
    brand: r.brand_name ? { name: r.brand_name, slug: r.brand_slug } : null,
    image: r.image_key ? { url: storage.publicUrl(r.image_key), alt: r.image_alt ?? r.name } : null,
  };
}

export function toImage(r: ImageRow, storage: StorageService) {
  return {
    id: r.id,
    url: storage.publicUrl(r.object_key),
    altText: r.alt_text,
    sortOrder: r.sort_order,
    isPrimary: r.is_primary,
  };
}

export function toDocument(r: DocumentRow) {
  return {
    id: r.id,
    title: r.title,
    documentType: r.document_type,
    fileName: r.original_name,
    mimeType: r.mime_type,
    sizeBytes: Number(r.size_bytes),
    isPublic: r.is_public,
    sortOrder: r.sort_order,
  };
}

export function toVariant(r: VariantRow) {
  return { id: r.id, name: r.name, sku: r.sku, attributes: r.attributes, isActive: r.is_active };
}
