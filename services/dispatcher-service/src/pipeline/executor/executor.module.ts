import { Module } from '@nestjs/common';
import { ExecutorService } from './executor.service';
import { RunFeedbackService } from './run-feedback.service';
import { ClaudeAgentService } from './claude-agent.service';
import { McpServerDiscoveryService } from './mcp-server-discovery.service';
import { StoreModule } from '../../store/store.module';

@Module({
  imports: [StoreModule],
  providers: [ExecutorService, RunFeedbackService, ClaudeAgentService, McpServerDiscoveryService],
  exports: [ExecutorService, RunFeedbackService, ClaudeAgentService],
})
export class ExecutorModule {}
