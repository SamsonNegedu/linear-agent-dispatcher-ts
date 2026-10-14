import { Controller, Post, Headers, RawBody } from '@nestjs/common';
import { WebhookIngestService } from './webhook-ingest.service';
import { WebhookResponse } from './types';

@Controller('webhooks')
export class WebhookController {
  constructor(private readonly ingestService: WebhookIngestService) {}

  /**
   * POST /webhooks/linear — receive Linear webhook, verify signature, fan out to subscribers
   */
  @Post('linear')
  async handleLinearWebhook(
    @Headers('linear-signature') signature: string | undefined,
    @RawBody() rawBody: Buffer,
  ): Promise<WebhookResponse> {
    const result = await this.ingestService.ingest('linear', signature, rawBody);
    return { received: true, ...result };
  }
}
