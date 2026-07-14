import { StackContext, Table, Api, Function as LambdaFunction, Secret } from 'sst/constructs';
import { getRelayTableDefinition } from './relay-service-table.definition';

export const RelayService = ({ stack }: StackContext) => {
  // Secrets (Linear OAuth credentials, stored in AWS Secrets Manager)
  const linearOAuthSecret = new Secret(stack, 'LinearOAuthSecret', {
    name: `${stack.stackName}/linear-oauth`,
  });

  const relayTable = new Table(stack, 'RelayTable', getRelayTableDefinition(stack.stage));

  const api = new Api(stack, 'RelayApi', {
    routes: {
      'POST /webhooks/linear': 'services/relay-service/src/handlers/relay-service-api.main',
      'GET /subscribers/auth/start': 'services/relay-service/src/handlers/relay-service-api.main',
      'GET /callback': 'services/relay-service/src/handlers/relay-service-api.main',
      'POST /subscribers/register': 'services/relay-service/src/handlers/relay-service-api.main',
    },
  });

  // Lambda function for scheduled cleanup (reap-stale)
  const reapStale = new LambdaFunction(stack, 'ReapStale', {
    handler: 'services/relay-service/src/handlers/reap-stale.main',
    timeout: '5 minutes',
  });

  // Grant permissions
  reapStale.attachPermissions([relayTable]);

  // Webhook handlers need table access + Linear OAuth secret
  api.attachPermissions([relayTable, linearOAuthSecret]);

  // Stack outputs
  stack.addOutputs({
    ApiEndpoint: api.url,
    RelayTable: relayTable.tableName,
    RegistryUrl: `${api.url}/subscribers/register`,
    AuthStartUrl: `${api.url}/subscribers/auth/start`,
    CallbackUrl: `${api.url}/callback`,
    WebhookUrl: `${api.url}/webhooks/linear`,
  });
};
