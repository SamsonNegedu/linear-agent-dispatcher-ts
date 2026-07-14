import { Global, Module } from '@nestjs/common';
import { loadConfig } from './config';

@Global()
@Module({
  providers: [
    {
      provide: 'DispatcherConfig',
      useValue: loadConfig(),
    },
  ],
  exports: ['DispatcherConfig'],
})
export class DispatcherConfigModule {}
