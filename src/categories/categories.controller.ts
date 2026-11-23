import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { AdminController } from '../auth/admin-controller.decorator.js';
import { CurrentAdmin } from '../auth/current-admin.decorator.js';
import type { SessionUser } from '../auth/sessions.repository.js';
import { CategoriesService } from './categories.service.js';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto.js';

@ApiTags('public: catalog')
@Controller('categories')
export class CategoriesPublicController {
  constructor(private readonly categories: CategoriesService) {}

  /** Active categories with the number of published products. */
  @Get()
  async list() {
    return { data: await this.categories.listPublic() };
  }
}

@AdminController('categories', 'categories')
export class CategoriesAdminController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  async list() {
    return { data: await this.categories.listAll() };
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.categories.get(id) };
  }

  @Post()
  async create(@Body() dto: CreateCategoryDto) {
    return { data: await this.categories.create(dto) };
  }

  @Patch(':id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) {
    return { data: await this.categories.update(id, dto) };
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.categories.delete(id);
  }

  /** Background image for category tiles/banners (JPEG/PNG/WebP). Replaces the previous image. */
  @Post(':id/image')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { files: 1, fileSize: 50 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  async setImage(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentAdmin() admin: SessionUser,
  ) {
    return { data: await this.categories.setImage(id, file, admin.user_id) };
  }

  @Delete(':id/image')
  async removeImage(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.categories.removeImage(id) };
  }
}
