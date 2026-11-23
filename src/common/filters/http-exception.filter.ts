import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

export interface ErrorBody {
  error: { status: number; code: string; message: string; details?: unknown };
}

/**
 * Uniform error envelope: `{ error: { status, code, message, details? } }`.
 * Unexpected errors are logged server-side and never leak stack traces or internals.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const body = AllExceptionsFilter.toBody(exception);
    if (body.error.status >= 500) {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    }
    res.status(body.error.status).json(body);
  }

  static toBody(exception: unknown): ErrorBody {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      let message = exception.message;
      let details: unknown;
      if (typeof response === 'object' && response !== null) {
        const r = response as { message?: unknown; details?: unknown };
        if (Array.isArray(r.message)) {
          message = 'Validasi gagal';
          details = r.message;
        } else if (typeof r.message === 'string') {
          message = r.message;
        }
        if (r.details !== undefined) details = r.details;
      }
      const code = (HttpStatus[status] as string | undefined) ?? 'ERROR';
      return { error: { status, code, message, ...(details !== undefined ? { details } : {}) } };
    }
    return {
      error: { status: 500, code: 'INTERNAL_SERVER_ERROR', message: 'Terjadi kesalahan pada server' },
    };
  }
}
