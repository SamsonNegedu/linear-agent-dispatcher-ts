import { SSTConfig } from 'sst';
import { RelayService } from './infra/relay-service';

export default {
  config(_input) {
    return {
      name: 'linear-dispatcher',
      region: 'eu-central-1',
    };
  },
  stacks(app) {
    // The relay is the only serverless piece: a cloud Lambda that fans
    // webhooks out to dispatchers. The dispatcher itself always runs as a
    // standalone local NestJS server (see services/dispatcher-service/src/main.ts),
    // not as a Lambda — it connects out to this relay via RELAY_URL.
    app.stack(RelayService);
  },
} satisfies SSTConfig;
