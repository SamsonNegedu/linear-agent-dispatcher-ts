import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import type { DispatcherConfig } from './config';

/**
 * Validates dispatcher service configuration on startup.
 * Ensures all required config values are present and valid.
 * Warns if optional config is missing.
 */
@Injectable()
export class ConfigValidatorService implements OnModuleInit {
  private readonly logger = new Logger(ConfigValidatorService.name);

  constructor(@Inject('DispatcherConfig') private readonly config: DispatcherConfig) {}

  onModuleInit() {
    this.validateConfig();
  }

  private validateConfig() {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Relay config (only required if relay mode was enabled via `pnpm connect-relay`)
    if (this.config.relay?.enabled && !this.config.relay?.subscriberSecret) {
      errors.push('RELAY_SUBSCRIBER_SECRET is required when RELAY_ENABLED=true');
    }

    // Executor config
    if (!this.config.executor?.claudeBinPath) {
      errors.push('CLAUDE_BIN_PATH is required');
    }

    if (!this.config.executor?.timeout || this.config.executor.timeout <= 0) {
      errors.push('MAX_RUN_DURATION must be a positive number');
    }

    // Database config
    if (!this.config.database?.path) {
      warnings.push('DISPATCHER_DB_PATH not set (using default: ./data/dispatcher.db)');
    }

    // Linear config (optional for non-agent-session triggers)
    if (!this.config.linear?.apiKey) {
      warnings.push('LINEAR_API_KEY not set (activity posting to Linear will be skipped)');
    }

    // Report errors
    if (errors.length > 0) {
      // The Nest Logger is silenced (logger: false in main.ts), so the individual
      // logger.error() lines below never reach the console. Include the actual
      // messages in the thrown error itself so they aren't lost.
      this.logger.error('Configuration validation failed:');
      errors.forEach((error) => this.logger.error(`  [ERROR] ${error}`));
      throw new Error(
        `Configuration validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`,
      );
    }

    // Report warnings
    if (warnings.length > 0) {
      this.logger.warn('Configuration validation warnings:');
      warnings.forEach((warn) => this.logger.warn(`  [WARN] ${warn}`));
    }

    this.logger.log('Configuration validated successfully');
  }
}
