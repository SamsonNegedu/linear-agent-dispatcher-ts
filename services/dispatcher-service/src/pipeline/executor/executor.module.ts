import { Module, Provider } from '@nestjs/common';
import { ExecutorService } from './executor.service';
import { AdapterRegistry } from '@webhook-verify/core';
import { LinearRunReporter } from './linear-run-reporter';
import { RUN_REPORTER_REGISTRY, type RunReporter } from './run-reporter';
import { ClaudeAgentService } from './claude-agent.service';
import { McpServerDiscoveryService } from './mcp-server-discovery.service';
import { StoreModule } from '../../store/store.module';

// Register one RunReporter per provider here. ExecutorService resolves the right one per run
// via event.provider.
const runReporterRegistryProvider: Provider = {
  provide: RUN_REPORTER_REGISTRY,
  useFactory: (linear: LinearRunReporter) => {
    const registry = new AdapterRegistry<RunReporter>();
    registry.register(linear);
    return registry;
  },
  inject: [LinearRunReporter],
};

@Module({
  imports: [StoreModule],
  providers: [
    ExecutorService,
    LinearRunReporter,
    runReporterRegistryProvider,
    ClaudeAgentService,
    McpServerDiscoveryService,
  ],
  exports: [ExecutorService, LinearRunReporter, ClaudeAgentService],
})
export class ExecutorModule {}
