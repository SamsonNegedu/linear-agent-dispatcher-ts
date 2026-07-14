import { SSTConfig } from 'sst';
import { RelayService } from './infra/relay-service';
import { DispatcherService } from './infra/dispatcher-service';

export default {
  config(_input) {
    return {
      name: 'linear-dispatcher',
      region: 'eu-central-1',
    };
  },
  stacks(app) {
    // Environment modes:
    // - production: RelayService only (cloud relay)
    // - development: DispatcherService only (local development)
    // - testing: Both services (full local testing)
    const mode = process.env.SST_MODE || (app.stage === 'prod' ? 'production' : 'development');

    if (mode === 'production' || app.stage === 'prod') {
      // Production: only the cloud relay
      app.stack(RelayService);
    } else if (mode === 'testing') {
      // Local testing: both services
      app.stack(RelayService);
      app.stack(DispatcherService);
    } else {
      // Development (default): only dispatcher
      // Dispatcher connects to remote relay via RELAY_URL env var
      app.stack(DispatcherService);
    }
  },
} satisfies SSTConfig;
