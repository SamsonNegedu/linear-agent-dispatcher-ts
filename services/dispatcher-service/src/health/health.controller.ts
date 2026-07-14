import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
} from '@nestjs/common';
import { IStoreRepository } from '../store/store.interfaces';
import { DispatcherConfig } from '../config/config';

@Controller()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    @Inject('IStoreRepository') private readonly store: IStoreRepository,
    @Inject('DispatcherConfig') private readonly config: DispatcherConfig,
  ) {}

  @Get('health')
  @HttpCode(200)
  async health() {
    try {
      await this.store.ping();
      return { status: 'ok' };
    } catch (err) {
      this.logger.error('Health check failed:', err);
      throw new HttpException(
        { status: 'error', error: err instanceof Error ? err.message : 'Unknown error' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  @Get('status')
  @HttpCode(200)
  async status() {
    try {
      const stats = await this.store.getRunStats(24 * 60 * 60 * 1000);
      return {
        relay: {
          enabled: this.config.relay.enabled,
          configured: !!this.config.relay.subscriberSecret,
        },
        lastWebhookAt: stats.lastWebhookAt?.toISOString() || null,
        runsToday: stats.byStatus,
      };
    } catch (err) {
      this.logger.error('Status check failed:', err);
      throw new HttpException(
        { status: 'error', error: err instanceof Error ? err.message : 'Unknown error' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
