/**
 * DEVELOPMENT ONLY — fills empty contact/website settings with clearly marked DUMMY values
 * so the UI can be built before the official data is provided. Never run this in production.
 *
 *   node --env-file-if-exists=.env scripts/seed-dev-dummy.ts
 *
 * Only settings that are still null are changed; `contact.is_dummy = true` makes the website show a notice.
 * Remove the dummy values by entering the real data in the admin settings (or setting them to null).
 */
import pg from 'pg';

const DUMMY: Record<string, unknown> = {
  // Developer's own test number for WhatsApp click-to-chat; replace with the official number.
  'contact.whatsapp_number': '6281282271323',
  'contact.phone': '+62 800-0000-0000 (DUMMY)',
  'contact.email': 'dummy@example.com',
  'contact.address': 'Alamat DUMMY — ganti melalui pengaturan admin',
  'contact.business_hours': 'DUMMY — Senin–Jumat 08.00–17.00',
  // Taken from the 2026 catalog cover; confirm before going live.
  'site.hero_title': 'Solusi Industri dan Keselamatan',
  'site.hero_subtitle': 'Produk dan dukungan untuk kebutuhan operasional.',
};

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed dummy data in production');
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    let changed = 0;
    for (const [key, value] of Object.entries(DUMMY)) {
      const res = await client.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value WHERE settings.value = 'null'::jsonb`,
        [key, JSON.stringify(value)],
      );
      changed += res.rowCount ?? 0;
    }
    if (changed > 0) {
      await client.query(
        `INSERT INTO settings (key, value) VALUES ('contact.is_dummy', 'true'::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = 'true'::jsonb`,
      );
    }
    await client.query('COMMIT');
    console.log(`Dummy settings: ${changed} value(s) filled.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
