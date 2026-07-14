import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
  Inject,
  Optional,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { requestContextManager } from './request-context';
import type { LoggerLike } from './logging.interceptor';

export interface TimingConfig {
  logger?: LoggerLike;
  /**
   * Only log if duration exceeds threshold (milliseconds)
   */
  threshold?: number;
}

export const RESPONSE_TIME_HEADER = 'X-Response-Time';

@Injectable()
export class TimingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TimingInterceptor.name);

  constructor(@Optional() @Inject('TIMING_CONFIG') private config?: TimingConfig) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const startTime = Date.now();

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;
        response.setHeader(RESPONSE_TIME_HEADER, `${duration}ms`);

        const threshold = this.config?.threshold;
        if (threshold && duration > threshold) {
          const log = this.config?.logger || this.logger;
          const ctx = requestContextManager.getContext();

          log.log?.({
            message: `Slow request: ${request.method} ${request.url}`,
            duration: `${duration}ms`,
            requestId: ctx?.requestId,
          });
        }
      }),
    );
  }
}
