import { Module } from '@nestjs/common';
import { CatalogImportService } from '../catalog-import/catalog-import.service.js';
import { AppConfigModule } from '../config/app-config.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { UsersModule } from '../users/users.module.js';

/** Minimal module for command-line tasks (no HTTP server, no storage). */
@Module({
  imports: [AppConfigModule, DatabaseModule, UsersModule],
  providers: [CatalogImportService],
})
export class CliModule {}
