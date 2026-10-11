import { HttpException } from '@nestjs/common';
import { SubscriberController } from '../subscriber.controller';
import type { SubscriberService } from '../subscriber.service';
import type { OAuthService } from '../oauth.service';
import type { SubscriberRecord } from '../types';

const subscriber: SubscriberRecord = {
  subscriberId: 'DLA:user_1',
  teamKey: 'DLA',
  linearUserId: 'user_1',
  domains: new Set(),
  localEndpoint: 'https://old.example.com/webhooks/relay',
  subscriberSecret: 'the-real-secret',
  registeredAt: '2026-10-01T00:00:00.000Z',
  lastSeenAt: '2026-10-01T00:00:00.000Z',
  version: 1,
};

function build() {
  const service = {
    getSubscriber: jest.fn().mockResolvedValue(subscriber),
    updateSubscriberEndpointById: jest
      .fn()
      .mockImplementation((_id: string, endpoint: string) =>
        Promise.resolve({ ...subscriber, localEndpoint: endpoint }),
      ),
  } as unknown as jest.Mocked<SubscriberService>;
  const oauth = {
    generateAuthorizationUrl: jest.fn().mockReturnValue('https://linear.app/oauth'),
  } as unknown as jest.Mocked<OAuthService>;
  return { controller: new SubscriberController(service, oauth), service, oauth };
}

const status = async (promise: Promise<unknown>): Promise<number> => {
  try {
    await promise;
    return 200;
  } catch (error) {
    return (error as HttpException).getStatus();
  }
};

describe('SubscriberController.update (PATCH /subscribers)', () => {
  const valid = {
    subscriberId: 'DLA:user_1',
    subscriberSecret: 'the-real-secret',
    localEndpoint: 'https://new.example.com/webhooks/relay',
  };

  it('moves the subscription when the secret matches', async () => {
    const { controller, service } = build();

    const result = await controller.update(valid);

    expect(service.updateSubscriberEndpointById).toHaveBeenCalledWith(
      'DLA:user_1',
      valid.localEndpoint,
    );
    expect(result).toMatchObject({ updated: true, localEndpoint: valid.localEndpoint });
  });

  it('rejects a wrong secret with 401 and changes nothing', async () => {
    const { controller, service } = build();

    expect(await status(controller.update({ ...valid, subscriberSecret: 'guess' }))).toBe(401);
    expect(service.updateSubscriberEndpointById).not.toHaveBeenCalled();
  });

  it('answers an unknown subscriber exactly like a wrong secret, so ids cannot be probed', async () => {
    const { controller, service } = build();
    service.getSubscriber.mockResolvedValue(null);

    expect(await status(controller.update(valid))).toBe(401);
  });

  it('no longer accepts an update by subscriberId alone', async () => {
    const { controller, service } = build();

    expect(
      await status(
        controller.update({ subscriberId: 'DLA:user_1', localEndpoint: valid.localEndpoint }),
      ),
    ).toBe(400);
    expect(service.updateSubscriberEndpointById).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing body', undefined],
    ['a missing endpoint', { subscriberId: 'a', subscriberSecret: 'b' }],
    ['a private-network endpoint', { ...valid, localEndpoint: 'https://10.0.0.5/x' }],
    ['a plain-http remote endpoint', { ...valid, localEndpoint: 'http://example.com/x' }],
  ])('rejects %s with 400', async (_name, body) => {
    const { controller } = build();

    expect(await status(controller.update(body as never))).toBe(400);
  });
});

describe('SubscriberController.getById', () => {
  it('returns existence metadata without the secret or endpoint', async () => {
    const { controller } = build();

    const result = await controller.getById('DLA:user_1');

    expect(result).not.toHaveProperty('subscriberSecret');
    expect(result).not.toHaveProperty('localEndpoint');
    expect(result.subscriberId).toBe('DLA:user_1');
  });

  it('404s for an unknown subscriber', async () => {
    const { controller, service } = build();
    service.getSubscriber.mockResolvedValue(null);

    expect(await status(controller.getById('nope'))).toBe(404);
  });
});

describe('SubscriberController.startAuth', () => {
  it('rejects a private-network delivery endpoint and a non-localhost CLI callback', () => {
    const { controller } = build();

    expect(() => controller.startAuth('https://192.168.1.5/x')).toThrow(HttpException);
    expect(() =>
      controller.startAuth('https://ok.example.com/x', 'http://evil.example.com/cb'),
    ).toThrow(HttpException);
    expect(() => controller.startAuth(undefined)).toThrow(HttpException);
  });

  it('returns the Linear authorization URL for valid input', () => {
    const { controller, oauth } = build();

    expect(controller.startAuth('https://ok.example.com/x', 'http://localhost:3333/cb')).toEqual({
      redirect: 'https://linear.app/oauth',
    });
    expect(oauth.generateAuthorizationUrl).toHaveBeenCalledWith(
      'https://ok.example.com/x',
      'http://localhost:3333/cb',
      undefined,
    );
  });
});
