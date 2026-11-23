import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { rethrowPgConflict } from '../common/utils/pg-errors.js';
import { slugify } from '../common/utils/slug.js';
import { BrandRow, BrandsRepository } from './brands.repository.js';
import { CreateBrandDto, UpdateBrandDto } from './dto/brand.dto.js';

const toBrand = (r: BrandRow) => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  isActive: r.is_active,
  productCount: r.product_count,
});

@Injectable()
export class BrandsService {
  constructor(private readonly repo: BrandsRepository) {}

  async listPublic() {
    return (await this.repo.listPublic()).map(({ id, name, slug, product_count }) => ({
      id,
      name,
      slug,
      productCount: product_count,
    }));
  }

  async listAll() {
    return (await this.repo.listAll()).map(toBrand);
  }

  async get(id: string) {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('Brand tidak ditemukan');
    return toBrand(row);
  }

  async create(dto: CreateBrandDto) {
    const slug = dto.slug ?? slugify(dto.name);
    if (!slug) throw new BadRequestException('Slug tidak dapat dibuat dari nama; isi slug secara manual');
    try {
      return this.get(await this.repo.create({ name: dto.name, slug, isActive: dto.isActive ?? true }));
    } catch (error) {
      rethrowPgConflict(error);
    }
  }

  async update(id: string, dto: UpdateBrandDto) {
    try {
      if (!(await this.repo.update(id, dto))) throw new NotFoundException('Brand tidak ditemukan');
      return this.get(id);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      rethrowPgConflict(error);
    }
  }

  async delete(id: string): Promise<void> {
    const used = await this.repo.countProducts(id);
    if (used > 0) {
      throw new ConflictException(`Brand masih dipakai ${used} produk. Ganti brand produk tersebut atau nonaktifkan brand ini.`);
    }
    if (!(await this.repo.delete(id))) throw new NotFoundException('Brand tidak ditemukan');
  }
}
