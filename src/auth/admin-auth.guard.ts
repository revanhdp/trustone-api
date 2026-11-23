import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import type { SessionUser } from './sessions.repository.js';

export interface AuthenticatedRequest extends Request {
  admin: SessionUser;
  adminToken: string;
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

/** Protects every admin route: requires a valid, unexpired session of an active admin user. */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(req);
    const user = token ? await this.auth.authenticate(token) : null;
    if (!token || !user) throw new UnauthorizedException('Sesi tidak valid atau sudah berakhir');
    if (user.role !== 'admin') throw new UnauthorizedException('Akses ditolak');
    req.admin = user;
    req.adminToken = token;
    return true;
  }
}
