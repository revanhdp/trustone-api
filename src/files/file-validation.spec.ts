import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { safeOriginalName, validateImage, validatePdf } from './file-validation.js';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);

describe('file validation', () => {
  it('detects images by magic bytes', () => {
    expect(validateImage({ buffer: png, size: png.length }, 5).mime).toBe('image/png');
    expect(validateImage({ buffer: jpeg, size: jpeg.length }, 5).ext).toBe('jpg');
    expect(validateImage({ buffer: webp, size: webp.length }, 5).mime).toBe('image/webp');
  });

  it('rejects non-images even with an image-like name', () => {
    const exe = Buffer.from('MZ\x90\x00 fake exe');
    expect(() => validateImage({ buffer: exe, size: exe.length }, 5)).toThrow(BadRequestException);
  });

  it('enforces the size limit', () => {
    expect(() => validateImage({ buffer: png, size: 6 * 1024 * 1024 }, 5)).toThrow(PayloadTooLargeException);
  });

  it('accepts only real PDFs', () => {
    const pdf = Buffer.from('%PDF-1.7\n...');
    expect(validatePdf({ buffer: pdf, size: pdf.length }, 20).mime).toBe('application/pdf');
    expect(() => validatePdf({ buffer: png, size: png.length }, 20)).toThrow(BadRequestException);
  });

  it('sanitizes original names', () => {
    expect(safeOriginalName('../../etc/passwd', 'x')).toBe('.._.._etc_passwd');
    expect(safeOriginalName('   ', 'fallback.pdf')).toBe('fallback.pdf');
  });
});
