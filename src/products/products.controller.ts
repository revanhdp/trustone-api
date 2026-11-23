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
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AdminController } from '../auth/admin-controller.decorator.js';
import { CurrentAdmin } from '../auth/current-admin.decorator.js';
import type { SessionUser } from '../auth/sessions.repository.js';
import {
  AdminProductQueryDto,
  BulkStatusDto,
  CreateProductDto,
  PublicProductQueryDto,
  UpdateDocumentDto,
  UpdateImageDto,
  UpdateProductDto,
  UploadDocumentDto,
  UploadImageDto,
} from './dto/product.dto.js';
import { ProductMediaService } from './product-media.service.js';
import { ProductsService } from './products.service.js';

const FILE_BODY = {
  schema: {
    type: 'object',
    properties: { file: { type: 'string', format: 'binary' } },
    required: ['file'],
  },
};

@ApiTags('public: catalog')
@Controller('products')
export class ProductsPublicController {
  constructor(private readonly products: ProductsService) {}

  /** Published products with search, category/brand filter, sorting and pagination. */
  @Get()
  list(@Query() query: PublicProductQueryDto) {
    return this.products.listPublic(query);
  }

  @Get(':slug')
  async get(@Param('slug') slug: string) {
    return { data: await this.products.getPublic(slug) };
  }

  /** Short-lived (presigned) download URL for a public product document. */
  @Get(':slug/documents/:documentId/url')
  async documentUrl(@Param('slug') slug: string, @Param('documentId', ParseUUIDPipe) documentId: string) {
    return { data: await this.products.publicDocumentUrl(slug, documentId) };
  }
}

@AdminController('products', 'products')
export class ProductsAdminController {
  constructor(
    private readonly products: ProductsService,
    private readonly media: ProductMediaService,
  ) {}

  @Get()
  list(@Query() query: AdminProductQueryDto) {
    return this.products.listAdmin(query);
  }

  @Post('bulk-status')
  @HttpCode(200)
  async bulkStatus(@Body() dto: BulkStatusDto) {
    return { data: await this.products.bulkStatus(dto) };
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.products.getAdmin(id) };
  }

  @Post()
  async create(@Body() dto: CreateProductDto) {
    return { data: await this.products.create(dto) };
  }

  @Patch(':id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    return { data: await this.products.update(id, dto) };
  }

  /** Permanent delete; returns 409 when the product has inquiry/quotation history (archive it instead). */
  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.products.delete(id);
  }

  // ----- images

  @Post(':id/images')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_BODY)
  async uploadImage(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadImageDto,
    @CurrentAdmin() admin: SessionUser,
  ) {
    return { data: await this.media.uploadImage(id, file, dto.altText, admin.user_id) };
  }

  @Patch(':id/images/:imageId')
  async updateImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Body() dto: UpdateImageDto,
  ) {
    return { data: await this.media.updateImage(id, imageId, dto) };
  }

  @Delete(':id/images/:imageId')
  async deleteImage(@Param('id', ParseUUIDPipe) id: string, @Param('imageId', ParseUUIDPipe) imageId: string) {
    return { data: await this.media.deleteImage(id, imageId) };
  }

  // ----- documents

  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_BODY)
  async uploadDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadDocumentDto,
    @CurrentAdmin() admin: SessionUser,
  ) {
    return { data: await this.media.uploadDocument(id, file, dto, admin.user_id) };
  }

  @Patch(':id/documents/:documentId')
  async updateDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: UpdateDocumentDto,
  ) {
    return { data: await this.media.updateDocument(id, documentId, dto) };
  }

  @Delete(':id/documents/:documentId')
  async deleteDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return { data: await this.media.deleteDocument(id, documentId) };
  }

  @Get(':id/documents/:documentId/url')
  async documentUrl(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return { data: await this.products.adminDocumentUrl(id, documentId) };
  }
}
