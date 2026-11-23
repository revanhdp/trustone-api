import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AppConfigService } from '../config/app-config.service.js';
import { ProductMediaService } from './product-media.service.js';
import { ProductsAdminController, ProductsPublicController } from './products.controller.js';
import { ProductsRepository } from './products.repository.js';
import { ProductsService } from './products.service.js';

@Module({
  imports: [
    // Hard upper bound for any upload in this module; exact per-type limits are enforced in ProductMediaService.
    MulterModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        storage: memoryStorage(),
        limits: {
          files: 1,
          fields: 10,
          fileSize: Math.max(config.get('UPLOAD_IMAGE_MAX_MB'), config.get('UPLOAD_DOCUMENT_MAX_MB')) * 1024 * 1024,
        },
      }),
    }),
  ],
  controllers: [ProductsPublicController, ProductsAdminController],
  providers: [ProductsRepository, ProductsService, ProductMediaService],
})
export class ProductsModule {}
