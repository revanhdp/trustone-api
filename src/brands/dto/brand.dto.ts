import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { SLUG_PATTERN } from '../../common/utils/slug.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateBrandDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  /** Generated from the name when omitted. */
  @IsOptional()
  @Matches(SLUG_PATTERN, { message: 'slug hanya boleh huruf kecil, angka, dan tanda hubung' })
  @MaxLength(120)
  slug?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateBrandDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @Matches(SLUG_PATTERN, { message: 'slug hanya boleh huruf kecil, angka, dan tanda hubung' })
  @MaxLength(120)
  slug?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
