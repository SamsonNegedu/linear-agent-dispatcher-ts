import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  UseGuards,
  HttpCode,
  Logger,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { AdminAuthGuard } from './admin-auth.guard';
import { SubscriberRegistry } from '../subscriber/subscriber-registry.repository';
import { WebhookDeliveries } from '../webhook/webhook-deliveries.repository';
import { SUBSCRIBER_REGISTRY_REPOSITORY } from '../subscriber/subscriber-registry.provider';
import { WEBHOOK_DELIVERIES_REPOSITORY } from '../webhook/webhook-deliveries.provider';

@Controller('admin')
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    @Inject(SUBSCRIBER_REGISTRY_REPOSITORY) private readonly subscribers: SubscriberRegistry,
    @Inject(WEBHOOK_DELIVERIES_REPOSITORY) private readonly deliveries: WebhookDeliveries,
  ) {}

  @Get('api/subscribers')
  @UseGuards(AdminAuthGuard)
  @HttpCode(200)
  async getSubscribers(@Query('teamKey') teamKey?: string) {
    let records = [];

    if (teamKey) {
      // Filter by specific team
      records = await this.subscribers.getSubscribersByTeam(teamKey);
    } else {
      // Get all subscribers across all teams
      records = await this.subscribers.getAllSubscribers();
    }

    return {
      teamKey: teamKey || 'all',
      count: records.length,
      subscribers: records.map((sub) => ({
        subscriberId: sub.subscriberId,
        teamKey: sub.teamKey,
        linearUserId: sub.linearUserId,
        localEndpoint: sub.localEndpoint,
        registeredAt: sub.registeredAt,
        lastSeenAt: sub.lastSeenAt,
        version: sub.version,
      })),
    };
  }

  @Delete('api/subscribers/:subscriberId')
  @UseGuards(AdminAuthGuard)
  @HttpCode(204)
  async deleteSubscriber(@Param('subscriberId') subscriberId: string) {
    try {
      await this.subscribers.deleteSubscriber(subscriberId);
      this.logger.log(`Subscriber ${subscriberId} revoked via admin API`);
    } catch (err) {
      this.logger.error(`Failed to delete subscriber ${subscriberId}:`, err);
      throw new HttpException('Failed to revoke subscriber', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('api/deliveries')
  @UseGuards(AdminAuthGuard)
  @HttpCode(200)
  async getDeliveries(
    @Query('teamKey') teamKey: string,
    @Query('limit') limitStr?: string,
  ) {
    if (!teamKey) {
      throw new HttpException('teamKey query parameter required', HttpStatus.BAD_REQUEST);
    }

    const limit = limitStr ? Math.min(parseInt(limitStr, 10), 100) : 50;
    const records = await this.deliveries.listByTeam(teamKey, limit);

    return {
      teamKey,
      count: records.length,
      deliveries: records,
    };
  }
}
