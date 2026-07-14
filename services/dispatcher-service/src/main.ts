// Must load .env.local before anything else is imported: `AppModule` pulls in
// `DispatcherConfigModule`, whose `@Module` decorator calls `loadConfig()` at
// import time (reading process.env directly) — before Nest's own
// `ConfigModule.forRoot()` (which loads .env.local via dotenv) ever gets a
// chance to run. Without this, every `@Inject('DispatcherConfig')` consumer
// gets a config snapshot frozen before .env.local was ever read, no matter
// how many times the process is restarted.
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

const envLocalPath = path.join(process.cwd(), '.env.local');
dotenv.config({
  path: fs.existsSync(envLocalPath) ? envLocalPath : path.join(process.cwd(), '.env'),
});

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { loadConfig } from './config/config';
import {
  RequestIdInterceptor,
  LoggingInterceptor,
  ErrorInterceptor,
  TimingInterceptor,
  ResponseTransformInterceptor,
} from '@api-gateway/serverless-express/interceptors';

const logger = new Logger('Bootstrap');

async function bootstrap() {
  const config = loadConfig();

  const app = await NestFactory.create(AppModule, {
    rawBody: true, // enable raw body parsing for webhook signature verification
    // Without this, Nest's default teardown calls process.exit(1) directly on any
    // init failure (e.g. onModuleInit throwing), bypassing bootstrap().catch() below
    // and exiting with no error output at all.
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

  // Handle process termination signals
  const shutdownGrace = config.executor.timeout ? Math.min(30000, config.executor.timeout) : 30000;
  process.on('SIGTERM', async () => {
    logger.log(`SIGTERM received, gracefully shutting down (${shutdownGrace}ms grace period)...`);
    setTimeout(() => {
      logger.error('Forced shutdown after grace period');
      process.exit(1);
    }, shutdownGrace);
    await app.close();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.log(`SIGINT received, gracefully shutting down (${shutdownGrace}ms grace period)...`);
    setTimeout(() => {
      logger.error('Forced shutdown after grace period');
      process.exit(1);
    }, shutdownGrace);
    await app.close();
    process.exit(0);
  });
}

bootstrap().catch((err) => {
  // Using exitCode instead of process.exit() lets the async stderr write flush
  // before the process terminates (process.exit() can truncate it on a pipe).
  console.error('Failed to bootstrap:', err);
  process.exitCode = 1;
});
