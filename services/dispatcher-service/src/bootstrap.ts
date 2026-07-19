import { NestFactory } from '@nestjs/core';
import { INestApplication } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import {
  RequestIdInterceptor,
  LoggingInterceptor,
  ErrorInterceptor,
  TimingInterceptor,
  ResponseTransformInterceptor,
} from '@api-gateway/serverless-express/interceptors';
import { loadConfig } from './config/config';

const logger = new Logger('Bootstrap');

export async function bootstrapServer(): Promise<{ app: INestApplication; port: number }> {
  const config = loadConfig();

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    rawBody: true, // enable raw body parsing for webhook signature verification
    abortOnError: false,
  });

  // Register global interceptors
  // Health checks (/health, /metrics, etc.) are auto-skipped
  app.useGlobalInterceptors(
    new RequestIdInterceptor(),
    new ErrorInterceptor(),
    new TimingInterceptor({
      threshold: 5000, // Log slow requests >5s
    }),
    new LoggingInterceptor(),
    new ResponseTransformInterceptor(),
  );

  // Enable NestJS shutdown hooks for graceful cleanup
  app.enableShutdownHooks();

  await app.listen(config.server.port);

  logger.log(`Application is running on port ${config.server.port}`);

  return { app, port: config.server.port };
}
