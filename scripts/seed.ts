/**
 * Idempotent reference-data seed (safe to run repeatedly):
 *   - the 28 initial categories from the 2026 catalog (inserted only if the slug is missing,
 *     so admin edits to name/order/status are never overwritten)
 *   - website settings with placeholder values (inserted only if the key is missing)
 *
 *   node --env-file-if-exists=.env scripts/seed.ts
 *
 * Products are NOT seeded here: catalog data is imported separately after review
 * (see data/catalog/README.md).
 */
import pg from 'pg';

const CATEGORIES: Array<[slug: string, name: string]> = [
  ['field-uniform-activewear', 'Field Uniform & Activewear'],
  ['rescue-protective-wear', 'Rescue & Protective Wear'],
  ['drone-pemadam-kebakaran', 'Drone Pemadam Kebakaran'],
  ['manpack-surveillance', 'Manpack Surveillance'],
  ['aegis-intelligence-pole', 'Aegis Intelligence Pole'],
  ['wipers-spill-control', 'Wipers & Spill Control'],
  ['perlindungan-kimia', 'Perlindungan Kimia'],
  ['perlindungan-kepala', 'Perlindungan Kepala'],
  ['perlindungan-mata-wajah', 'Perlindungan Mata & Wajah'],
  ['sarung-tangan-sekali-pakai', 'Sarung Tangan Sekali Pakai'],
  ['sarung-tangan-kerja', 'Sarung Tangan Kerja'],
  ['hot-metal-equipment', 'Hot Metal Equipment'],
  ['perlindungan-pernapasan', 'Perlindungan Pernapasan'],
  ['perlindungan-jatuh', 'Perlindungan Jatuh'],
  ['perlindungan-pendengaran', 'Perlindungan Pendengaran'],
  ['perlindungan-kaki', 'Perlindungan Kaki'],
  ['polymer-material', 'Polymer Material'],
  ['rescue-equipment', 'Rescue Equipment'],
  ['scba-airline', 'SCBA & Airline'],
  ['lockout-tagout', 'Lockout/Tagout'],
  ['chemical-spill', 'Chemical Spill'],
  ['chemical-equipment', 'Chemical Equipment'],
  ['electrical-equipment', 'Electrical Equipment'],
  ['chemical-pump', 'Chemical Pump'],
  ['other-equipment', 'Other Equipment'],
  ['body-protection', 'Body Protection'],
  ['fire-protection', 'Fire Protection'],
  ['traffic-control', 'Traffic Control'],
];

// null = not provided yet by the business owner; the admin fills these in the settings page.
const SETTINGS: Record<string, unknown> = {
  'company.name': 'Trustone Borneo Indonesia',
  'company.logo_file_id': null,
  'company.about': null,
  'contact.whatsapp_number': null,
  'contact.phone': null,
  'contact.email': null,
  'contact.address': null,
  'contact.business_hours': null,
  'contact.is_dummy': false,
  'site.hero_title': null,
  'site.hero_subtitle': null,
  'site.footer_text': null,
  'catalog.show_prices': false,
  // Initial, configurable default — confirm the real policy with the business owner.
  'quotation.default_validity_days': 14,
  'quotation.default_terms': null,
};

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    let categories = 0;
    for (const [index, [slug, name]] of CATEGORIES.entries()) {
      const res = await client.query(
        `INSERT INTO categories (name, slug, sort_order) VALUES ($1, $2, $3)
         ON CONFLICT (slug) DO NOTHING`,
        [name, slug, (index + 1) * 10],
      );
      categories += res.rowCount ?? 0;
    }
    let settings = 0;
    for (const [key, value] of Object.entries(SETTINGS)) {
      const res = await client.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING`,
        [key, JSON.stringify(value)],
      );
      settings += res.rowCount ?? 0;
    }
    await client.query('COMMIT');
    console.log(`Seed done: ${categories} new categor(ies), ${settings} new setting(s).`);
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
