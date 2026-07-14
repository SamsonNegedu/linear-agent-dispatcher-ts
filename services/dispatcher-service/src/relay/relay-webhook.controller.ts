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
import { VerifiedEvent } from '@webhook-verify/core';
import { DispatcherService } from '../dispatcher/dispatcher.service';
import { DispatcherConfig } from '../config/config';

@Controller('webhooks')
export class RelayWebhookController {
  private readonly logger = new Logger(RelayWebhookController.name);

  constructor(
    private readonly dispatcherService: DispatcherService,
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
        this.logger.warn('Invalid webhook signature');
        throw new HttpException('Invalid signature', HttpStatus.UNAUTHORIZED);
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error('Signature verification error:', err);
      throw new HttpException('Verification failed', HttpStatus.BAD_REQUEST);
    }

    // Dispatch the webhook event
    await this.dispatcherService.dispatchWebhook(payload);

    return { received: true, webhookId: payload.webhookId };
  }
}
