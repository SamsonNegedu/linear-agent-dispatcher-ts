import { LinearOAuthClient, LinearGraphQLClient } from '@linear-agent/linear-client';
import { OAuthService } from '../oauth.service';
import { baseSubscriberModuleTestBuilder } from './subscriber-module-test-utils';

jest.mock('@linear-agent/linear-client');

const MockedOAuthClient = LinearOAuthClient as jest.MockedClass<typeof LinearOAuthClient>;
const MockedGraphQLClient = LinearGraphQLClient as jest.MockedClass<typeof LinearGraphQLClient>;

async function buildService(): Promise<OAuthService> {
  const module = await baseSubscriberModuleTestBuilder().compile();
  return module.get(OAuthService);
}

describe('OAuthService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('builds the authorization URL against the callback derived from the relay base URL', async () => {
    const generateAuthorizationUrl = jest.fn().mockReturnValue('https://linear.app/oauth/authorize?state=abc');
    MockedOAuthClient.mockImplementation(
      () => ({ generateAuthorizationUrl }) as unknown as LinearOAuthClient,
    );

    const service = await buildService();
    const url = service.generateAuthorizationUrl('http://localhost:4000/webhook');

    expect(generateAuthorizationUrl).toHaveBeenCalledWith(
      'https://relay.example.com/callback',
      'http://localhost:4000/webhook',
      undefined,
      'https://relay.example.com',
    );
    expect(url).toBe('https://linear.app/oauth/authorize?state=abc');
  });

  it('propagates a token exchange failure', async () => {
    const exchangeCodeForToken = jest.fn().mockRejectedValue(new Error('invalid_grant'));
    MockedOAuthClient.mockImplementation(
      () => ({ exchangeCodeForToken }) as unknown as LinearOAuthClient,
    );

    const service = await buildService();

    await expect(service.exchangeCodeForToken('bad_code')).rejects.toThrow('invalid_grant');
  });

  it('fetches user info via the Linear GraphQL client', async () => {
    const getUserInfo = jest.fn().mockResolvedValue({ id: 'user_1', teams: [] });
    MockedGraphQLClient.mockImplementation(() => ({ getUserInfo }) as unknown as LinearGraphQLClient);

    const service = await buildService();
    const info = await service.getUserInfo('access_token_1');

    expect(getUserInfo).toHaveBeenCalledWith('access_token_1');
    expect(info).toEqual({ id: 'user_1', teams: [] });
  });
});
