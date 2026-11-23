/**
 * Imports the extracted PDF catalog data as draft products that need review.
 * Safe to run repeatedly: products already imported (same import key) are skipped, admin edits are kept.
 *
 *   pnpm catalog:import [directory]   (default: data/catalog/extracted)
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { resolve } from 'node:path';
import { CatalogImportService } from '../catalog-import/catalog-import.service.js';
import { CliModule } from './cli.module.js';

async function main(): Promise<void> {
  const dir = resolve(process.argv[2] ?? 'data/catalog/extracted');
  const app = await NestFactory.createApplicationContext(CliModule, { logger: ['error'] });
  try {
    const service = app.get(CatalogImportService);
    const products = await service.loadDirectory(dir);
    const result = await service.run(products);
    console.log(
      `Import selesai dari ${dir}: ${result.inserted} produk baru, ${result.skipped} dilewati (sudah ada), ` +
        `${result.brandsCreated} brand baru. Semua produk baru berstatus draft dan perlu direview.`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  Logger.error(error instanceof Error ? error.message : String(error), 'import-catalog');
  process.exitCode = 1;
});
