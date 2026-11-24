import { Module } from '@nestjs/common';
import { InquiriesAdminController, InquiriesPublicController } from './inquiries.controller.js';
import { InquiriesRepository } from './inquiries.repository.js';
import { InquiriesService } from './inquiries.service.js';

@Module({
  controllers: [InquiriesPublicController, InquiriesAdminController],
  providers: [InquiriesRepository, InquiriesService],
})
export class InquiriesModule {}
