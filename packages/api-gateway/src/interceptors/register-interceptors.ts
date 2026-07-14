import { INestApplication } from '@nestjs/common';
import { LoggingInterceptor, LoggingConfig } from './logging.interceptor';
import { ErrorInterceptor } from './error.interceptor';
import { ResponseTransformInterceptor } from './response-transform.interceptor';
import { TimingInterceptor, TimingConfig } from './timing.interceptor';
import { RequestIdInterceptor } from './request-id.interceptor';

export interface RegisterInterceptorsOptions {
  /**
   * Enable structured request/response logging (default: true)
   */
  disableLogging?: boolean;
  loggingConfig?: LoggingConfig;
  /**
   * Enable response timing header and slow request detection (default: true)
   */
  disableTiming?: boolean;
  timingConfig?: TimingConfig;
  /**
   * Enable standardized response wrapper (default: true)
   */
  disableResponseTransform?: boolean;
  /**
   * ERROR HANDLING IS ALWAYS ENABLED - cannot be disabled
   */
}

/**
 * Register global interceptors on a NestJS application.
 * Includes: RequestId → ErrorInterceptor → TimingInterceptor → LoggingInterceptor → ResponseTransformInterceptor
 *
 * ErrorInterceptor and RequestIdInterceptor are always enabled.
 * Others are enabled by default and can be disabled.
 *
 * Health check endpoints (/health, /healthz, /ready, /metrics, /ping) are automatically excluded from logging/timing.
 *
 * @param app The NestJS application instance
 * @param options Configuration to disable specific interceptors
 *
 * @example
 * ```typescript
 * import { registerInterceptors } from '@api-gateway/serverless-express';
 *
 * const app = await NestFactory.create(AppModule);
 * // All interceptors enabled by default, health checks auto-skipped
 * registerInterceptors(app);
 *
 * // Customize thresholds
 * registerInterceptors(app, {
 *   timingConfig: { threshold: 1000 }, // Log slow requests >1s
 * });
 * ```
 */
export async function registerInterceptors(
  app: INestApplication,
  options: RegisterInterceptorsOptions = {},
): Promise<void> {
  const {
    disableLogging = false,
    loggingConfig,
    disableTiming = false,
    timingConfig,
    disableResponseTransform = false,
  } = options;

  // RequestIdInterceptor is always registered - must be first for context setup
  app.useGlobalInterceptors(new RequestIdInterceptor());

  // ErrorInterceptor is always registered
  app.useGlobalInterceptors(new ErrorInterceptor());

  if (!disableTiming) {
    app.useGlobalInterceptors(new TimingInterceptor(timingConfig));
  }

  if (!disableLogging) {
    app.useGlobalInterceptors(new LoggingInterceptor(loggingConfig));
  }

  if (!disableResponseTransform) {
    app.useGlobalInterceptors(new ResponseTransformInterceptor());
  }
}
