export interface RelayServiceConfig {
  linear: {
    oauthClientId: string;
    oauthClientSecret: string;
    webhookSecret: string;
    apiKey?: string;
    organizationId?: string;
  };
  relay: {
    baseUrl: string;
  };
  dynamodb: {
    tableName: string;
    region?: string;
  };
}

export const loadRelayConfig = (): RelayServiceConfig => {
  const clientId = process.env.LINEAR_OAUTH_CLIENT_ID;
  const clientSecret = process.env.LINEAR_OAUTH_CLIENT_SECRET;
  const webhookSecret = process.env.LINEAR_WEBHOOK_SECRET;
  const apiKey = process.env.LINEAR_API_KEY;
  const baseUrl = process.env.RELAY_BASE_URL || '';

  if (!clientId) {
    throw new Error(
      'LINEAR_OAUTH_CLIENT_ID environment variable is required. ' +
        'Set it to your Linear OAuth app client ID from https://linear.app/settings/api',
    );
  }

  if (!clientSecret) {
    throw new Error(
      'LINEAR_OAUTH_CLIENT_SECRET environment variable is required. ' +
        'Set it to your Linear OAuth app client secret from https://linear.app/settings/api',
    );
  }

  if (!webhookSecret) {
    throw new Error(
      'LINEAR_WEBHOOK_SECRET environment variable is required. ' +
        'Set it to your Linear webhook signing secret from https://linear.app/settings/api',
    );
  }

  return {
    linear: {
      oauthClientId: clientId,
      oauthClientSecret: clientSecret,
      webhookSecret,
      apiKey,
      organizationId: process.env.LINEAR_ORGANIZATION_ID,
    },
    relay: {
      baseUrl,
    },
    dynamodb: {
      tableName: process.env.RELAY_TABLE_NAME || 'RelayTable',
      region: process.env.AWS_REGION,
    },
  };
};
