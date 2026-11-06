import { Controller, HttpCode, Post, Headers, RawBody } from '@nestjs/common';
import { WebhookIngestService } from './webhook-ingest.service';
import { WebhookResponse } from './types';

@Controller('webhooks')
export class WebhookController {
  constructor(private readonly ingestService: WebhookIngestService) {}

  /**
   * POST /webhooks/linear — receive Linear webhook, verify it, answer 200, fan out in the background
   */
  @Post('linear')
  @HttpCode(200)
  async handleLinearWebhook(
    @Headers('linear-signature') signature: string | undefined,
    @RawBody() rawBody: Buffer,
  ): Promise<WebhookResponse> {
    const { webhookId } = await this.ingestService.ingest('linear', signature, rawBody);
    return { received: true, webhookId };
  }
}
