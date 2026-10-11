import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Observable, map } from 'rxjs';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T;
  statusCode: number;
  timestamp: string;
}

/** Wraps every successful response as `{ success, data, statusCode, timestamp }` (the monitor TUI reads `.data`). */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiResponse> {
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    return next.handle().pipe(
      map((data: unknown) => ({
        success: true,
        data,
        statusCode: reply.statusCode || 200,
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
