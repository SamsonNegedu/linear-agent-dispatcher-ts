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
import { tap, catchError } from 'rxjs/operators';
import { Request, Response } from 'express';
import { requestContextManager } from './request-context';

export interface LoggerLike {
  log?: (entry: Record<string, unknown>) => void;
  error?: (entry: Record<string, unknown>) => void;
}

export interface LoggingConfig {
  logger?: LoggerLike; // PinoLogger or custom logger
  logResponseBody?: boolean;
}

const DEFAULT_SKIP_PATHS = ['/health', '/healthz', '/ready', '/metrics', '/ping'];

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  constructor(@Optional() @Inject('LOGGING_CONFIG') private config?: LoggingConfig) {}

  private shouldSkip(path: string): boolean {
    return DEFAULT_SKIP_PATHS.some((skipPath) => path.startsWith(skipPath));
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const { method, url } = request;
    const startTime = Date.now();
    const log = this.config?.logger || this.logger;

    if (this.shouldSkip(url)) {
      return next.handle();
    }

    const ctx = requestContextManager.getContext();

    return next.handle().pipe(
      tap((data) => {
        const duration = Date.now() - startTime;
        const statusCode = response.statusCode;

        log.log?.({
          message: `${method} ${url}`,
          level: 'info',
          method,
          url,
          statusCode,
          duration: `${duration}ms`,
          requestId: ctx?.requestId,
          correlationId: ctx?.correlationId,
          ip: ctx?.ip,
          ...(this.config?.logResponseBody && { body: data }),
        });

        return data;
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;

        log.error?.({
          message: `${method} ${url} failed`,
          level: 'error',
          method,
          url,
          duration: `${duration}ms`,
          requestId: ctx?.requestId,
          correlationId: ctx?.correlationId,
          ip: ctx?.ip,
          error: error.message,
          stack: error.stack,
        });

        throw error;
      }),
    );
  }
}
