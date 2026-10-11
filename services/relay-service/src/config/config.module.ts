import { Global, Module } from '@nestjs/common';
import { loadRelayConfig } from './relay-config';

@Global()
@Module({
  providers: [
    {
      provide: 'RelayServiceConfig',
      useFactory: loadRelayConfig,
    },
  ],
  exports: ['RelayServiceConfig'],
})
export class ConfigModule {}
