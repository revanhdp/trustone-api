import { type ExtractedProduct, planImport } from './catalog-import.service.js';

const base: ExtractedProduct = {
  source_page: 3,
  category_slug: 'field-uniform-activewear',
  name: 'PDL Tangan Panjang',
  sku: null,
  brand: null,
  brand_source: null,
  short_description: null,
  description: null,
  attributes: {},
  variants: [],
  image_hint: null,
  review_notes: [],
};

describe('planImport', () => {
  it('creates stable, unique import keys for repeated names on the same page', () => {
    const plan = planImport([base, { ...base }, { ...base, source_page: 4 }]);
    expect(plan.map((p) => p.importKey)).toEqual([
      'catalog-2026:p3:pdl-tangan-panjang',
      'catalog-2026:p3:pdl-tangan-panjang:2',
      'catalog-2026:p4:pdl-tangan-panjang',
    ]);
  });

  it('clears SKUs that are not unique in the catalog and explains why', () => {
    const plan = planImport([
      { ...base, sku: '001' },
      { ...base, name: 'Coverall', sku: '001' },
      { ...base, name: 'Wypall L20', sku: '96232' },
    ]);
    expect(plan.map((p) => p.sku)).toEqual([null, null, '96232']);
    expect(plan[0].notes.some((n) => n.includes('"001"'))).toBe(true);
  });

  it('keeps the extraction review notes and flags logo-only brands', () => {
    const [item] = planImport([{ ...base, brand: 'MSA', brand_source: 'logo', review_notes: ['cek warna'] }]);
    expect(item.notes).toContain('Brand "MSA" dibaca dari logo pada katalog.');
    expect(item.notes).toContain('cek warna');
  });
});
