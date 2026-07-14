import { StackContext, Api } from 'sst/constructs';

export const DispatcherService = ({ stack }: StackContext) => {
  const api = new Api(stack, 'DispatcherApi', {
    routes: {
      // Receive webhooks signed by relay service
      'POST /webhooks/relay':
        'services/dispatcher-service/src/handlers/dispatcher-service-api.main',

      // Admin/health endpoints
      'GET /health': 'services/dispatcher-service/src/handlers/dispatcher-service-api.main',
      'GET /readyz': 'services/dispatcher-service/src/handlers/dispatcher-service-api.main',

      // Runs management API (list, get run by ID, etc.)
      'GET /runs': 'services/dispatcher-service/src/handlers/dispatcher-service-api.main',
      'GET /runs/{id}': 'services/dispatcher-service/src/handlers/dispatcher-service-api.main',
    },
  });

  // Stack outputs
  stack.addOutputs({
    ApiEndpoint: api.url,
    WebhookUrl: `${api.url}/webhooks/relay`,
    HealthUrl: `${api.url}/health`,
  });
};
