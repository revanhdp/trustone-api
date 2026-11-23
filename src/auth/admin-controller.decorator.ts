import { applyDecorators, Controller, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from './admin-auth.guard.js';

/** Controller under /admin/<path>, protected by AdminAuthGuard. */
export function AdminController(path: string, tag: string) {
  return applyDecorators(
    Controller(`admin/${path}`),
    UseGuards(AdminAuthGuard),
    ApiBearerAuth(),
    ApiTags(`admin: ${tag}`),
  );
}
