import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Query,
} from '@nestjs/common';
import type { IStoreRepository } from '../../store/store.interfaces';
import type { DispatcherConfig } from '../../config/config';
import { RelayHealthService } from '../../pipeline/relay/relay-health.service';

@Controller()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    @Inject('IStoreRepository') private readonly store: IStoreRepository,
    @Inject('DispatcherConfig') private readonly config: DispatcherConfig,
    private readonly relayHealth: RelayHealthService,
  ) {}

  @Get('health')
  @HttpCode(200)
  async health() {
    try {
      await this.store.ping();
      return { status: 'ok' };
    } catch (error) {
      this.logger.error('Health check failed:', error);
      throw new HttpException(
        { status: 'error', error: error instanceof Error ? error.message : 'Unknown error' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  @Get('status')
  @HttpCode(200)
  async status(@Query('refresh') refresh?: string) {
    try {
      const stats = await this.store.getRunStats(24 * 60 * 60 * 1000);
      const relayHealth =
        refresh === 'true' ? await this.relayHealth.refresh() : this.relayHealth.getStatus();
      return {
        relay: {
          enabled: this.config.relay.enabled,
          configured: !!this.config.relay.subscriberSecret,
          subscriberCheck: relayHealth.result,
          lastCheckedAt: relayHealth.lastCheckedAt,
        },
        lastWebhookAt: stats.lastWebhookAt?.toISOString() || null,
        runsToday: stats.byStatus,
      };
    } catch (error) {
      this.logger.error('Status check failed:', error);
      throw new HttpException(
        { status: 'error', error: error instanceof Error ? error.message : 'Unknown error' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
