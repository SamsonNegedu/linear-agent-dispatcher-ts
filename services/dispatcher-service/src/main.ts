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

import { Logger } from '@nestjs/common';
import { bootstrapServer } from './bootstrap';
import { loadConfig } from './config/config';

const logger = new Logger('Bootstrap');

async function main() {
  const config = loadConfig();
  const { app } = await bootstrapServer();

  // Handle process termination signals
  const shutdownGrace = config.executor.timeout ? Math.min(30000, config.executor.timeout) : 30000;
  process.on('SIGTERM', () => {
    logger.log(`SIGTERM received, gracefully shutting down (${shutdownGrace}ms grace period)...`);
    setTimeout(() => {
      logger.error('Forced shutdown after grace period');
      process.exit(1);
    }, shutdownGrace);
    void app.close().then(() => {
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    logger.log(`SIGINT received, gracefully shutting down (${shutdownGrace}ms grace period)...`);
    setTimeout(() => {
      logger.error('Forced shutdown after grace period');
      process.exit(1);
    }, shutdownGrace);
    void app.close().then(() => {
      process.exit(0);
    });
  });
}

main().catch((err) => {
  console.error('Failed to bootstrap:', err);
  process.exitCode = 1;
});
