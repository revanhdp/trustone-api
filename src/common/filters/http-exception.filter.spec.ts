import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from './http-exception.filter.js';

describe('AllExceptionsFilter.toBody', () => {
  it('maps HttpException to the error envelope', () => {
    expect(AllExceptionsFilter.toBody(new NotFoundException('Produk tidak ditemukan'))).toEqual({
      error: { status: 404, code: 'NOT_FOUND', message: 'Produk tidak ditemukan' },
    });
  });

  it('exposes validation messages as details', () => {
    const body = AllExceptionsFilter.toBody(new BadRequestException(['name should not be empty']));
    expect(body.error.status).toBe(400);
    expect(body.error.message).toBe('Validasi gagal');
    expect(body.error.details).toEqual(['name should not be empty']);
  });

  it('hides internals of unexpected errors', () => {
    const body = AllExceptionsFilter.toBody(new Error('password=secret at db.ts:12'));
    expect(body).toEqual({
      error: { status: 500, code: 'INTERNAL_SERVER_ERROR', message: 'Terjadi kesalahan pada server' },
    });
  });
});
