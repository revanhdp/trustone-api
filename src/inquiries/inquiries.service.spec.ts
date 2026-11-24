import { formatReferenceCode, normalizeWhatsapp } from './inquiries.service.js';

describe('normalizeWhatsapp', () => {
  it.each([
    ['0812-8227-1323', '+6281282271323'],
    ['+62 812-8227-1323', '+6281282271323'],
    ['6281282271323', '+6281282271323'],
    ['81282271323', '+6281282271323'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeWhatsapp(input)).toBe(expected);
  });

  it('rejects numbers that are too short or too long', () => {
    expect(normalizeWhatsapp('0812')).toBeNull();
    expect(normalizeWhatsapp('0812345678901234567890')).toBeNull();
  });
});

describe('formatReferenceCode', () => {
  it('pads the sequence to six digits', () => {
    expect(formatReferenceCode(2026, 123)).toBe('INQ-2026-000123');
    expect(formatReferenceCode(2026, 1)).toBe('INQ-2026-000001');
  });
});
