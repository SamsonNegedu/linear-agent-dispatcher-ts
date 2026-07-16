import {
  Controller,
  Post,
  Headers,
  Body,
  RawBody,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Inject,
} from '@nestjs/common';
import { verifyWebhookSignature } from '@webhook-verify/core';
import type { VerifiedEvent } from '@webhook-verify/core';
import { WebhookQueueService } from './webhook-queue.service';
import type { DispatcherConfig } from '../config/config';

@Controller('webhooks')
export class RelayWebhookController {
  private readonly logger = new Logger(RelayWebhookController.name);

  constructor(
    private readonly webhookQueueService: WebhookQueueService,
    @Inject('DispatcherConfig') private readonly config: DispatcherConfig,
  ) {}

  @Post('relay')
  @HttpCode(200)
  async receiveRelayWebhook(
    @Headers('x-relay-signature') signature: string,
    @Body() payload: VerifiedEvent,
    @RawBody() rawBody: Buffer,
  ) {
    if (!signature) {
      this.logger.warn('Missing X-Relay-Signature header');
      throw new HttpException('Missing signature', HttpStatus.UNAUTHORIZED);
    }

    const secret = this.config.relay?.subscriberSecret;
    if (!secret) {
      this.logger.error('RELAY_SUBSCRIBER_SECRET not configured');
      throw new HttpException('Server configuration error', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    // Verify signature using raw body bytes for exact HMAC match
    try {
      const payloadString = rawBody.toString('utf-8');
      const isValid = verifyWebhookSignature(payloadString, signature, secret);

      if (!isValid) {
        this.logger.warn(
          `[CHECK_RELAY_CONFIG] Signature mismatch for webhook ${payload.webhookId}. ` +
            `Relay and dispatcher may be using different RELAY_SUBSCRIBER_SECRET values.`,
        );
        throw new HttpException('Invalid signature', HttpStatus.UNAUTHORIZED);
      }
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `[CHECK_RELAY_CONFIG] Signature verification error for webhook ${payload?.webhookId}:`,
        error,
      );
      throw new HttpException('Verification failed', HttpStatus.BAD_REQUEST);
    }

    // Queue the webhook event (fast, local DB insert)
    await this.webhookQueueService.enqueue(payload);

    return { received: true, webhookId: payload.webhookId };
  }
}
