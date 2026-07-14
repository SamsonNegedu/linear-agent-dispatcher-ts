import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { Request, Response } from 'express';

export interface ErrorResponse {
  statusCode: number;
  message: string;
  error?: string;
  timestamp: string;
  path?: string;
}

@Injectable()
export class ErrorInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      catchError((error) => {
        const errorResponse: ErrorResponse = {
          statusCode: 500,
          message: 'Internal Server Error',
          timestamp: new Date().toISOString(),
          path: request.url,
        };

        if (error instanceof HttpException) {
          errorResponse.statusCode = error.getStatus();
          const errorData = error.getResponse();

          if (typeof errorData === 'string') {
            errorResponse.message = errorData;
          } else if (typeof errorData === 'object' && errorData !== null) {
            const data = errorData as Record<string, unknown>;
            errorResponse.message = (data.message as string) || 'Bad Request';
            if (data.error) {
              errorResponse.error = data.error as string;
            }
          }
        } else if (error instanceof Error) {
          errorResponse.message = error.message || 'Internal Server Error';
          errorResponse.error = error.constructor.name;
        }

        response.status(errorResponse.statusCode).json(errorResponse);

        return throwError(() => error);
      }),
    );
  }
}
