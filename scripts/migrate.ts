/**
 * Forward-only SQL migration runner.
 *
 *   node --env-file-if-exists=.env scripts/migrate.ts up      apply pending migrations
 *   node --env-file-if-exists=.env scripts/migrate.ts status  list applied / pending
 *
 * - Migrations are `migrations/NNNN_name.sql`, applied in lexical order.
 * - Each file runs in its own transaction and is recorded in `schema_migrations`
 *   together with a SHA-256 checksum. Editing an applied file is reported as an error.
 * - A PostgreSQL advisory lock prevents two runners from migrating concurrently.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations');
const LOCK_KEY = 74_231_001; // arbitrary, project-specific advisory lock id
const FILE_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;

interface MigrationFile {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

async function loadMigrations(): Promise<MigrationFile[]> {
  const entries = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const files: MigrationFile[] = [];
  for (const name of entries) {
    const match = FILE_PATTERN.exec(name);
    if (!match) throw new Error(`Invalid migration file name: ${name} (expected NNNN_snake_case.sql)`);
    const sql = await readFile(join(MIGRATIONS_DIR, name), 'utf8');
    files.push({ version: match[1], name, sql, checksum: createHash('sha256').update(sql).digest('hex') });
  }
  const versions = new Set<string>();
  for (const f of files) {
    if (versions.has(f.version)) throw new Error(`Duplicate migration version ${f.version}`);
    versions.add(f.version);
  }
  return files;
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'up';
  if (!['up', 'status'].includes(command)) throw new Error(`Unknown command "${command}" (use up | status)`);
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     text PRIMARY KEY,
        name        text NOT NULL,
        checksum    text NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )`);
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);

    const files = await loadMigrations();
    const { rows } = await client.query<{ version: string; name: string; checksum: string }>(
      'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
    );
    const applied = new Map(rows.map((r) => [r.version, r]));

    for (const row of rows) {
      const file = files.find((f) => f.version === row.version);
      if (!file) throw new Error(`Applied migration ${row.name} is missing from ${MIGRATIONS_DIR}`);
      if (file.checksum !== row.checksum) {
        throw new Error(`Migration ${row.name} was modified after being applied. Create a new migration instead.`);
      }
    }

    const pending = files.filter((f) => !applied.has(f.version));

    if (command === 'status') {
      for (const f of files) console.log(`${applied.has(f.version) ? '[applied]' : '[pending]'} ${f.name}`);
      console.log(`${pending.length} pending migration(s).`);
      return;
    }

    for (const file of pending) {
      process.stdout.write(`Applying ${file.name} ... `);
      await client.query('BEGIN');
      try {
        await client.query(file.sql);
        await client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
          file.version,
          file.name,
          file.checksum,
        ]);
        await client.query('COMMIT');
        console.log('done');
      } catch (error) {
        await client.query('ROLLBACK');
        console.log('FAILED');
        throw error;
      }
    }
    console.log(pending.length === 0 ? 'Database is up to date.' : `Applied ${pending.length} migration(s).`);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
