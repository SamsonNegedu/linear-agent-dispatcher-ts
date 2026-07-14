import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { RelayServiceConfig } from './relay-config';

/**
 * Validates relay service configuration on startup.
 * Ensures all required config values are present and valid.
 * Warns if optional config is missing.
 */
@Injectable()
export class ConfigValidatorService implements OnModuleInit {
  private readonly logger = new Logger(ConfigValidatorService.name);

  constructor(@Inject('RelayServiceConfig') private readonly config: RelayServiceConfig) {}

  onModuleInit() {
    this.validateConfig();
  }

  private validateConfig() {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Linear OAuth config
    if (!this.config.linear.oauthClientId) {
      errors.push('LINEAR_OAUTH_CLIENT_ID is required');
    }

    if (!this.config.linear.oauthClientSecret) {
      errors.push('LINEAR_OAUTH_CLIENT_SECRET is required');
    }

    if (!this.config.linear.webhookSecret) {
      errors.push('LINEAR_WEBHOOK_SECRET is required');
    }

    // Relay config
    if (!this.config.relay.baseUrl) {
      warnings.push('RELAY_BASE_URL not set (OAuth callbacks may fail)');
    } else if (!this.isValidUrl(this.config.relay.baseUrl)) {
      errors.push('RELAY_BASE_URL is not a valid URL');
    }

    // DynamoDB config
    if (!this.config.dynamodb.tableName) {
      warnings.push('RELAY_TABLE_NAME not set (using default: RelayTable)');
    }

    // Optional: organizationId for workspace isolation
    if (!this.config.linear.organizationId) {
      warnings.push(
        'LINEAR_ORGANIZATION_ID not set (webhooks from any workspace will be accepted)',
      );
    }

    // Report errors
    if (errors.length > 0) {
      // The Nest Logger is silenced (logger: false in main.ts), so the individual
      // logger.error() lines below never reach the console. Include the actual
      // messages in the thrown error itself so they aren't lost.
      this.logger.error('Configuration validation failed:');
      errors.forEach((err) => this.logger.error(`  [ERROR] ${err}`));
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

  private isValidUrl(urlString: string): boolean {
    try {
      new URL(urlString);
      return true;
    } catch {
      return false;
    }
  }
}
