import { Injectable, Logger, Inject } from '@nestjs/common';
import { WebhookDeliveries } from './webhook-deliveries.repository';
import { WebhookDeliveryRecord } from './types';
import { WEBHOOK_DELIVERIES_REPOSITORY } from './webhook-deliveries.provider';

@Injectable()
export class WebhookDeliveryService {
  private readonly logger = new Logger(WebhookDeliveryService.name);

  constructor(
    @Inject(WEBHOOK_DELIVERIES_REPOSITORY)
    private readonly deliveries: WebhookDeliveries,
  ) {}

  async logAttempt(
    subscriberId: string,
    teamKey: string,
    webhookId: string,
    issueId: string,
    issueIdentifier: string,
    linearAssigneeId?: string,
  ): Promise<string> {
    return this.deliveries.logDeliveryAttempt(
      subscriberId,
      teamKey,
      webhookId,
      issueId,
      issueIdentifier,
      linearAssigneeId,
    );
  }

  async logResult(
    deliveryId: string,
    status: WebhookDeliveryRecord['status'],
    responseTime?: number,
    errorMessage?: string,
  ): Promise<void> {
    return this.deliveries.logDeliveryResult(deliveryId, status, responseTime, errorMessage);
  }
}
