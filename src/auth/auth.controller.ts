import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AdminAuthGuard, type AuthenticatedRequest } from './admin-auth.guard.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';

@ApiTags('admin: auth')
@Controller('admin/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Admin login. Returns an opaque session token (send as Bearer).' })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const ua = req.headers['user-agent'];
    return { data: await this.auth.login(dto.email, dto.password, { ip: req.ip ?? null, userAgent: ua?.slice(0, 500) ?? null }) };
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  async logout(@Req() req: AuthenticatedRequest): Promise<void> {
    await this.auth.logout(req.adminToken);
  }

  @Get('me')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  me(@Req() req: AuthenticatedRequest) {
    const { user_id, name, email, role } = req.admin;
    return { data: { id: user_id, name, email, role } };
  }
}
