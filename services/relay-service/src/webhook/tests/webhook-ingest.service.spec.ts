import { HttpException } from '@nestjs/common';
import { AdapterRegistry } from '@webhook-verify/core';
import type { NormalizedEvent, WebhookIngestAdapter } from '@webhook-verify/core';
import { WebhookIngestService } from '../webhook-ingest.service';
import { WebhookService } from '../webhook.service';
import { baseWebhookModuleTestBuilder } from './webhook-module-test-utils';

const makeEvent = (overrides: Partial<NormalizedEvent> = {}): NormalizedEvent => ({
  provider: 'linear',
  kind: 'issue',
  webhookId: 'wh_1',
  idempotencyKey: 'issue:ISSUE-1:update:1',
  timestamp: Date.now(),
  organizationId: 'org_1',
  issueId: 'issue_1',
  issueIdentifier: 'ISSUE-1',
  routingKey: 'ENG',
  ownerId: 'user_1',
  routingTags: [],
  isTerminal: false,
  rawPayload: {},
  ...overrides,
});

const rawBody = Buffer.from('{}');

describe('WebhookIngestService.ingest', () => {
  let adapter: jest.Mocked<WebhookIngestAdapter<Buffer>>;
  let webhookService: jest.Mocked<WebhookService>;
  let service: WebhookIngestService;

  const build = async (organizationId?: string) => {
    const registry = new AdapterRegistry<WebhookIngestAdapter<Buffer>>();
    registry.register(adapter);
    const module = await baseWebhookModuleTestBuilder({
      linear: {
        oauthClientId: 'client_1',
        oauthClientSecret: 'secret_1',
        webhookSecret: 'whsec_1',
        organizationId,
      },
    })
      .overrideProvider('IngestAdapterRegistry')
      .useValue(registry)
      .overrideProvider(WebhookService)
      .useValue(webhookService)
      .compile();
    service = module.get(WebhookIngestService);
  };

  const statusOf = async (promise: Promise<unknown>): Promise<number> => {
    try {
      await promise;
    } catch (error) {
      if (error instanceof HttpException) return error.getStatus();
      throw error;
    }
    throw new Error('expected the call to be rejected');
  };

  beforeEach(async () => {
    adapter = {
      provider: 'linear',
      verifySignature: jest.fn().mockReturnValue(true),
      parse: jest.fn().mockReturnValue(makeEvent()),
    };
    webhookService = {
      fanOutWebhook: jest.fn().mockResolvedValue({
        webhookId: 'wh_1',
        teamKey: 'ENG',
        assigneeId: 'u',
        delivered: 1,
        failed: 0,
      }),
    } as unknown as jest.Mocked<WebhookService>;
    await build();
  });

  it('rejects a request with no signature header', async () => {
    expect(await statusOf(service.ingest('linear', undefined, rawBody))).toBe(401);
    expect(adapter.verifySignature).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature', async () => {
    adapter.verifySignature.mockReturnValue(false);

    expect(await statusOf(service.ingest('linear', 'bad', rawBody))).toBe(401);
    expect(webhookService.fanOutWebhook).not.toHaveBeenCalled();
  });

  it('verifies with the provider secret from config', async () => {
    await service.ingest('linear', 'sig', rawBody);

    expect(adapter.verifySignature).toHaveBeenCalledWith(rawBody, 'sig', 'whsec_1');
  });

  it('answers 400 when signature verification throws', async () => {
    adapter.verifySignature.mockImplementation(() => {
      throw new Error('bad length');
    });

    expect(await statusOf(service.ingest('linear', 'sig', rawBody))).toBe(400);
  });

  it('answers 400 when the body cannot be parsed', async () => {
    adapter.parse.mockImplementation(() => {
      throw new Error('not json');
    });

    expect(await statusOf(service.ingest('linear', 'sig', rawBody))).toBe(400);
  });

  it('rejects a timestamp outside the replay window', async () => {
    adapter.parse.mockReturnValue(makeEvent({ timestamp: Date.now() - 60 * 60 * 1000 }));

    expect(await statusOf(service.ingest('linear', 'sig', rawBody))).toBe(400);
    expect(webhookService.fanOutWebhook).not.toHaveBeenCalled();
  });

  it('rejects a webhook from another organization when one is configured', async () => {
    await build('org_expected');

    expect(await statusOf(service.ingest('linear', 'sig', rawBody))).toBe(403);
    expect(webhookService.fanOutWebhook).not.toHaveBeenCalled();
  });

  it('fans out the parsed event, not the raw body, when everything checks out', async () => {
    const event = makeEvent();
    adapter.parse.mockReturnValue(event);

    const result = await service.ingest('linear', 'sig', rawBody);

    expect(webhookService.fanOutWebhook).toHaveBeenCalledWith(event, JSON.stringify(event));
    expect(result).toEqual(expect.objectContaining({ webhookId: 'wh_1', delivered: 1 }));
  });

  it('refuses a provider with no configured ingest settings', async () => {
    await expect(service.ingest('other', 'sig', rawBody)).rejects.toThrow(
      'No ingest settings configured',
    );
  });
});
