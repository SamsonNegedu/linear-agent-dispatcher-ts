import { Injectable, Logger, Inject } from '@nestjs/common';
import type { IStoreRepository } from '../store/store.interfaces';
import type { VerifiedEvent } from '@webhook-verify/core';
import { ActivityNotifierService } from './activity-notifier.service';
import { ClaudeAgentService } from './claude-agent.service';

export interface ExecutionResult {
  runId: string;
  status: 'succeeded' | 'failed';
  exitCode?: number;
  errorSnippet?: string;
  claudeSessionId?: string;
}

@Injectable()
export class ExecutorService {
  private readonly logger = new Logger(ExecutorService.name);

  constructor(
    @Inject('IStoreRepository') private readonly store: IStoreRepository,
    private readonly claudeAgent: ClaudeAgentService,
    private readonly activityNotifier: ActivityNotifierService,
  ) {}

  async executeRun(runId: string, event: VerifiedEvent): Promise<void> {
    const run = await this.store.getRun(runId);
    if (!run) {
      this.logger.error(`Run not found: ${runId}`);
      return;
    }

    try {
      // Mark run as running
      await this.store.markRunning(runId);
      this.logger.log(`Executing run: ${runId} in repo: ${run.repoPath}`);

      // Post start activity if session available
      if (run.providerSessionId) {
        await this.activityNotifier.postStart(
          run.providerSessionId,
          run.issueIdentifier,
          run.domainLabel,
          run.skill,
          runId,
        );
      }

      const result = await this.claudeAgent.spawn(run.skill, event.issueIdentifier, run.repoPath, {
        resumeSessionId: run.claudeSessionId,
      });

      // Mark complete
      await this.store.completeRun(runId, {
        status: result.status,
        exitCode: result.exitCode,
        errorSnippet: result.errorSnippet,
        claudeSessionId: result.sessionId,
      });

      if (result.status === 'succeeded') {
        this.logger.log(`Run completed: ${runId} (${result.status})`);
      } else {
        const reason = result.errorSnippet || `exit code ${result.exitCode}`;
        this.logger.error(`Run completed: ${runId} (${result.status}) - ${reason}`);
      }

      // Post completion activity
      if (run.providerSessionId) {
        if (result.status === 'succeeded') {
          await this.activityNotifier.postSuccess(
            run.providerSessionId,
            `Claude skill \`/${run.skill}\` completed successfully in \`${run.domainLabel}\` repo`,
          );
        } else {
          await this.activityNotifier.postError(
            run.providerSessionId,
            result.errorSnippet || `Run failed with exit code ${result.exitCode}`,
          );
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Run failed: ${runId} - ${errorMsg}`);
      await this.store.completeRun(runId, {
        status: 'failed',
        errorSnippet: errorMsg,
      });

      // Post error activity
      if (run.providerSessionId) {
        await this.activityNotifier.postError(run.providerSessionId, (error as Error).message);
      }
    }
  }
}
