import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { FastifyRequest, FastifyReply } from 'fastify';
import { randomBytes } from 'crypto';
import { requestContextManager, RequestContext } from './request-context';

export const REQUEST_ID_HEADER = 'X-Request-Id';
const CORRELATION_ID_HEADER = 'X-Correlation-Id';

function generateRequestId(): string {
  return randomBytes(8).toString('hex');
}

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const response = context.switchToHttp().getResponse<FastifyReply>();

    // Extract or generate request ID
    const requestId = (request.headers[REQUEST_ID_HEADER.toLowerCase()] as string) || generateRequestId();

    // Extract correlation ID from incoming request (for distributed tracing)
    const correlationId =
      (request.headers[CORRELATION_ID_HEADER.toLowerCase()] as string) || requestId;

    // Set response headers
    response.header(REQUEST_ID_HEADER, requestId);
    response.header(CORRELATION_ID_HEADER, correlationId);

    // Create and store request context
    const requestContext: RequestContext = {
      requestId,
      correlationId,
      startTime: Date.now(),
      method: request.method,
      url: request.url,
      ip: request.ip,
    };

    // Run the rest of the request within this context
    return new Observable((observer) => {
      // eslint-disable-next-line @typescript-eslint/require-await
      void requestContextManager.runAsync(requestContext, async () => {
        next.handle().subscribe(
          (data: unknown) => {
            observer.next(data);
          },
          (error: unknown) => {
            observer.error(error);
          },
          () => {
            observer.complete();
          },
        );
      });
    }).pipe(
      tap(() => {
        // Context cleanup happens automatically when runAsync completes
      }),
    );
  }
}
