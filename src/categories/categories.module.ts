import { Module } from '@nestjs/common';
import { CategoriesAdminController, CategoriesPublicController } from './categories.controller.js';
import { CategoriesRepository } from './categories.repository.js';
import { CategoriesService } from './categories.service.js';

@Module({
  controllers: [CategoriesPublicController, CategoriesAdminController],
  providers: [CategoriesRepository, CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
