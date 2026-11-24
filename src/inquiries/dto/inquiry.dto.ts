import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const INQUIRY_STATUSES = ['new', 'contacted', 'in_discussion', 'quoted', 'closed', 'cancelled'] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export const MAX_INQUIRY_ITEMS = 50;

export class InquiryItemDto {
  @IsUUID()
  productId: string;

  @IsOptional()
  @IsUUID()
  variantId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  quantity: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  customerNote?: string;
}

export class CreateInquiryDto {
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'Nama minimal 2 karakter' })
  @MaxLength(120)
  customerName: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(160)
  companyName?: string;

  /** Indonesian format is accepted (0812…, +62 812…, 62812…); stored normalized as +62…. */
  @Transform(trim)
  @IsString()
  @Matches(/^\+?[0-9][0-9\s\-().]{6,24}$/, { message: 'Nomor WhatsApp tidak valid' })
  whatsappNumber: string;

  @IsOptional()
  @Transform(trim)
  @IsEmail({}, { message: 'Format email tidak valid' })
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  generalNote?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Daftar permintaan masih kosong' })
  @ArrayMaxSize(MAX_INQUIRY_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => InquiryItemDto)
  items: InquiryItemDto[];
}

export class AdminInquiryQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(INQUIRY_STATUSES)
  status?: InquiryStatus;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class UpdateInquiryDto {
  @IsOptional()
  @IsIn(INQUIRY_STATUSES)
  status?: InquiryStatus;

  /** Admin-only note; null/empty clears it. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(4000)
  internalNote?: string;
}
