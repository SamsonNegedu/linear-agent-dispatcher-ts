import { Injectable, Logger, Inject } from '@nestjs/common';
import type { IStoreRepository } from '../../store/store.interfaces';
import type { NormalizedEvent } from '@webhook-verify/core';
import { ClaudeAgentService } from './claude-agent.service';
import { RunFeedbackService } from './run-feedback.service';

@Injectable()
export class ExecutorService {
  private readonly logger = new Logger(ExecutorService.name);

  constructor(
    @Inject('IStoreRepository') private readonly store: IStoreRepository,
    private readonly claudeAgent: ClaudeAgentService,
    private readonly feedback: RunFeedbackService,
  ) {}

  async executeRun(runId: string, event: NormalizedEvent): Promise<void> {
    const run = await this.store.getRun(runId);
    if (!run) {
      this.logger.error(`Run not found: ${runId}`);
      return;
    }

    const target = { issueId: run.issueId, sessionId: run.providerSessionId };

    try {
      // Mark run as running
      await this.store.markRunning(runId);
      this.logger.log(`Executing run: ${runId} in repo: ${run.repoPath}`);

      await this.feedback.started(target, {
        repoLabel: run.domainLabel,
        skill: run.skill,
        runId,
        issueIdentifier: run.issueIdentifier,
      });

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
      } else if (result.status === 'needs_input') {
        this.logger.warn(`[NEEDS_ATTENTION] Run stopped to ask: ${runId} - ${result.errorSnippet}`);
      } else {
        const reason = result.errorSnippet || `exit code ${result.exitCode}`;
        this.logger.error(`Run completed: ${runId} (${result.status}) - ${reason}`);
      }

      const summary =
        result.resultText ||
        `Claude skill \`/${run.skill}\` completed successfully in \`${run.domainLabel}\` repo`;
      if (result.status === 'succeeded') {
        await this.feedback.succeeded(target, summary);
      } else if (result.status === 'needs_input') {
        await this.feedback.needsInput(target, summary);
      } else {
        await this.feedback.failed(
          target,
          result.errorSnippet || `Run failed with exit code ${result.exitCode}`,
        );
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Run failed: ${runId} - ${errorMsg}`);
      await this.store.completeRun(runId, {
        status: 'failed',
        errorSnippet: errorMsg,
      });

      await this.feedback.failed(target, errorMsg);
    }
  }
}
