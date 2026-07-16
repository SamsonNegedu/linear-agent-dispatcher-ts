import './load-env';
import { NestFactory } from '@nestjs/core';
import { RelayModule } from './relay.module';
import { Logger } from '@nestjs/common';
import { loadRelayConfig } from './config/relay-config';

const logger = new Logger('Bootstrap');

async function bootstrap() {
  try {
    loadRelayConfig();

    const app = await NestFactory.create(RelayModule, {
      rawBody: true,
      // Without this, Nest's default teardown calls process.exit(1) directly on any
      // init failure (e.g. onModuleInit throwing), bypassing this try/catch entirely
      // and exiting with no error output at all.
      abortOnError: false,
    });

    const port = process.env.PORT || 3001;

    await app.listen(port);
    logger.log(`Relay service listening on port ${port}`);
    logger.log(`Base URL: http://localhost:${port}`);

    app.enableShutdownHooks();

    process.on('SIGTERM', () => {
      logger.log('SIGTERM received, gracefully shutting down...');
      void app.close().then(() => {
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      logger.log('SIGINT received, gracefully shutting down...');
      void app.close().then(() => {
        process.exit(0);
      });
    });
  } catch (error) {
    // Using exitCode instead of process.exit() lets the async stderr write flush
    // before the process terminates (process.exit() can truncate it on a pipe).
    console.error('Failed to bootstrap relay service:', error);
    process.exitCode = 1;
  }
}

void bootstrap();
