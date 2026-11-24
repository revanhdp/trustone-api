import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminController } from '../auth/admin-controller.decorator.js';
import { CurrentAdmin } from '../auth/current-admin.decorator.js';
import type { SessionUser } from '../auth/sessions.repository.js';
import { AdminInquiryQueryDto, CreateInquiryDto, UpdateInquiryDto } from './dto/inquiry.dto.js';
import { InquiriesService } from './inquiries.service.js';

@ApiTags('public: inquiries')
@Controller('inquiries')
export class InquiriesPublicController {
  constructor(private readonly inquiries: InquiriesService) {}

  /** Customer submits the "Daftar Permintaan". Stricter rate limit: 10 requests / minute / IP. */
  @Post()
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async create(@Body() dto: CreateInquiryDto) {
    return { data: await this.inquiries.createPublic(dto) };
  }
}

@AdminController('inquiries', 'inquiries')
export class InquiriesAdminController {
  constructor(private readonly inquiries: InquiriesService) {}

  @Get()
  list(@Query() query: AdminInquiryQueryDto) {
    return this.inquiries.listAdmin(query);
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.inquiries.getAdmin(id) };
  }

  @Patch(':id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateInquiryDto, @CurrentAdmin() admin: SessionUser) {
    return { data: await this.inquiries.update(id, dto, admin) };
  }
}
