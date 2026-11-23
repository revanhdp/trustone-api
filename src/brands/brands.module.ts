import { Module } from '@nestjs/common';
import { BrandsAdminController, BrandsPublicController } from './brands.controller.js';
import { BrandsRepository } from './brands.repository.js';
import { BrandsService } from './brands.service.js';

@Module({
  controllers: [BrandsPublicController, BrandsAdminController],
  providers: [BrandsRepository, BrandsService],
  exports: [BrandsService],
})
export class BrandsModule {}
