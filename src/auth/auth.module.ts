import { Global, Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { AdminAuthGuard } from './admin-auth.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SessionsRepository } from './sessions.repository.js';

@Global()
@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [AuthService, SessionsRepository, AdminAuthGuard],
  exports: [AuthService, AdminAuthGuard],
})
export class AuthModule {}
