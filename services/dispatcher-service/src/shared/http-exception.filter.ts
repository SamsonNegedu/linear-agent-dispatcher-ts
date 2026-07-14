import { Catch, ExceptionFilter, HttpException, ArgumentsHost, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Global HTTP exception filter that improves error responses.
 * Provides actionable error messages with context and debugging info.
 */
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus();

    const message = this.getDetailedMessage(status, exception, request);

    this.logger.error(`HTTP ${status}: ${message} (${request.method} ${request.path})`);

    response.status(status).json({
      statusCode: status,
      message,
      error: exception.name,
      timestamp: new Date().toISOString(),
      path: request.path,
    });
  }

  private getDetailedMessage(status: number, exception: HttpException, request: Request): string {
    const baseMessage = exception.message;

    switch (status) {
      case 400:
        return (
          'Bad Request: ' + (baseMessage || 'Invalid request format or missing required fields')
        );

      case 401:
        return (
          'Unauthorized: Missing or invalid relay webhook signature. ' +
          'Verify RELAY_SUBSCRIBER_SECRET matches relay service configuration.'
        );

      case 403:
        return 'Forbidden: ' + baseMessage;

      case 404:
        return `Not Found: ${request.path} does not exist`;

      case 500:
        return 'Internal Server Error: ' + baseMessage + '. Check server logs for details.';

      default:
        return baseMessage || 'An error occurred processing your request';
    }
  }
}
