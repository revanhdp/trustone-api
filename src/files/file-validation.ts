import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';

export interface DetectedType {
  mime: string;
  ext: string;
}

const IMAGE_TYPES: Array<{ type: DetectedType; matches: (b: Buffer) => boolean }> = [
  { type: { mime: 'image/jpeg', ext: 'jpg' }, matches: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: { mime: 'image/png', ext: 'png' },
    matches: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    type: { mime: 'image/webp', ext: 'webp' },
    matches: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
];

const PDF: DetectedType = { mime: 'application/pdf', ext: 'pdf' };

function assertSize(file: { size: number }, maxMb: number): void {
  if (file.size === 0) throw new BadRequestException('File kosong');
  if (file.size > maxMb * 1024 * 1024) throw new PayloadTooLargeException(`Ukuran file maksimal ${maxMb} MB`);
}

/** Validates an uploaded image by its content (magic bytes), not by the client-provided name or MIME type. */
export function validateImage(file: { buffer: Buffer; size: number }, maxMb: number): DetectedType {
  assertSize(file, maxMb);
  const found = IMAGE_TYPES.find((t) => t.matches(file.buffer));
  if (!found) throw new BadRequestException('Format gambar harus JPEG, PNG, atau WebP');
  return found.type;
}

/** Validates an uploaded PDF document by its content. */
export function validatePdf(file: { buffer: Buffer; size: number }, maxMb: number): DetectedType {
  assertSize(file, maxMb);
  if (file.buffer.toString('ascii', 0, 5) !== '%PDF-') throw new BadRequestException('Dokumen harus berupa file PDF');
  return PDF;
}

/** Original file name reduced to a safe display/download name (never used as an object key). */
export function safeOriginalName(name: string | undefined, fallback: string): string {
  const cleaned = (name ?? '')
    .normalize('NFKC')
    // oxlint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f"\\/<>:|?*]+/g, '_')
    .trim()
    .slice(0, 200);
  return cleaned || fallback;
}
