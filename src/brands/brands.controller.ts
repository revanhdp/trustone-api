import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminController } from '../auth/admin-controller.decorator.js';
import { BrandsService } from './brands.service.js';
import { CreateBrandDto, UpdateBrandDto } from './dto/brand.dto.js';

@ApiTags('public: catalog')
@Controller('brands')
export class BrandsPublicController {
  constructor(private readonly brands: BrandsService) {}

  /** Active brands that have published products. */
  @Get()
  async list() {
    return { data: await this.brands.listPublic() };
  }
}

@AdminController('brands', 'brands')
export class BrandsAdminController {
  constructor(private readonly brands: BrandsService) {}

  @Get()
  async list() {
    return { data: await this.brands.listAll() };
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.brands.get(id) };
  }

  @Post()
  async create(@Body() dto: CreateBrandDto) {
    return { data: await this.brands.create(dto) };
  }

  @Patch(':id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBrandDto) {
    return { data: await this.brands.update(id, dto) };
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.brands.delete(id);
  }
}
