import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateBy,
  ValidateNested,
  type ValidationOptions,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { SLUG_PATTERN } from '../../common/utils/slug.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const PRODUCT_STATUSES = ['draft', 'published', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

const isSpecValue = (v: unknown) =>
  (typeof v === 'string' && v.length <= 2000) ||
  (Array.isArray(v) && v.length <= 50 && v.every((x) => typeof x === 'string' && x.length <= 500));

/** A spec value: string, or array of strings. */
function IsSpecValue(options?: ValidationOptions) {
  return ValidateBy(
    { name: 'isSpecValue', validator: { validate: isSpecValue, defaultMessage: () => 'value harus teks atau daftar teks' } },
    options,
  );
}

/** Object whose values are strings or string arrays (variant attributes). */
function IsAttributeMap(options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isAttributeMap',
      validator: {
        validate: (v: unknown) =>
          typeof v === 'object' &&
          v !== null &&
          !Array.isArray(v) &&
          Object.keys(v).length <= 50 &&
          Object.entries(v).every(([k, val]) => k.length > 0 && k.length <= 100 && isSpecValue(val)),
        defaultMessage: () => 'attributes harus objek dengan nilai teks atau daftar teks',
      },
    },
    options,
  );
}

export class SpecItemDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  key: string;

  /** Text or list of texts, e.g. "ABS" or ["White", "Yellow"]. */
  @IsSpecValue()
  value: string | string[];
}

export class VariantDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  sku?: string | null;

  @IsOptional()
  @IsObject()
  @IsAttributeMap()
  attributes?: Record<string, string | string[]>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class ProductFieldsDto {
  @IsOptional()
  @Matches(SLUG_PATTERN, { message: 'slug hanya boleh huruf kecil, angka, dan tanda hubung' })
  @MaxLength(120)
  slug?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  sku?: string | null;

  @IsOptional()
  @IsUUID()
  brandId?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  shortDescription?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string | null;

  /** Ordered specification list; replaces the existing list when provided. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SpecItemDto)
  specs?: SpecItemDto[];

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  availabilityStatus?: string | null;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsIn(PRODUCT_STATUSES)
  status?: ProductStatus;

  @IsOptional()
  @IsBoolean()
  needsReview?: boolean;

  /** Replaces all variants when provided. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => VariantDto)
  variants?: VariantDto[];

  /** Manually related products (in display order); replaces the list when provided. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  relatedProductIds?: string[];
}

export class CreateProductDto extends ProductFieldsDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  name: string;

  @IsUUID()
  categoryId: string;
}

export class UpdateProductDto extends ProductFieldsDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  name?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  /** Review notes left from the catalog import; send [] to clear. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  reviewNotes?: string[];
}

export class BulkStatusDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];

  @IsIn(PRODUCT_STATUSES)
  status: ProductStatus;
}

const toBool = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

export const PUBLIC_SORTS = ['name_asc', 'name_desc', 'newest'] as const;

export class PublicProductQueryDto extends PaginationQueryDto {
  /** Search in name, SKU, brand, and short description. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  /** Category slug. */
  @IsOptional()
  @Matches(SLUG_PATTERN)
  category?: string;

  /** Brand slug. */
  @IsOptional()
  @Matches(SLUG_PATTERN)
  brand?: string;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  featured?: boolean;

  @IsOptional()
  @IsIn(PUBLIC_SORTS)
  sort: (typeof PUBLIC_SORTS)[number] = 'name_asc';
}

export const ADMIN_SORTS = ['updated_desc', 'created_desc', 'name_asc', 'name_desc', 'source_page'] as const;

export class AdminProductQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(PRODUCT_STATUSES)
  status?: ProductStatus;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  brandId?: string;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  needsReview?: boolean;

  @IsOptional()
  @IsIn(ADMIN_SORTS)
  sort: (typeof ADMIN_SORTS)[number] = 'updated_desc';
}

export class UpdateImageDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  altText?: string | null;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export const DOCUMENT_TYPES = ['datasheet', 'manual', 'certificate', 'other'] as const;

export class UploadDocumentDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsIn(DOCUMENT_TYPES)
  documentType?: (typeof DOCUMENT_TYPES)[number];

  /** multipart sends strings: "true" / "false". */
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isPublic?: boolean;
}

export class UpdateDocumentDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsIn(DOCUMENT_TYPES)
  documentType?: (typeof DOCUMENT_TYPES)[number];

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UploadImageDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  altText?: string;
}
