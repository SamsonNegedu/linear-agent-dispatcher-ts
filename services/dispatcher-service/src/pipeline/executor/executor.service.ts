import { Injectable, Logger, Inject } from '@nestjs/common';
import type { IStoreRepository } from '../../store/store.interfaces';
import type { NormalizedEvent } from '@webhook-verify/core';
import { ActivityNotifierService } from './activity-notifier.service';
import { ClaudeAgentService } from './claude-agent.service';
import { IssueCommentService } from './issue-comment.service';

@Injectable()
export class ExecutorService {
  private readonly logger = new Logger(ExecutorService.name);

  constructor(
    @Inject('IStoreRepository') private readonly store: IStoreRepository,
    private readonly claudeAgent: ClaudeAgentService,
    private readonly activityNotifier: ActivityNotifierService,
    private readonly issueComments: IssueCommentService,
  ) {}

  async executeRun(runId: string, event: NormalizedEvent): Promise<void> {
    const run = await this.store.getRun(runId);
    if (!run) {
      this.logger.error(`Run not found: ${runId}`);
      return;
    }

    try {
      // Mark run as running
      await this.store.markRunning(runId);
      this.logger.log(`Executing run: ${runId} in repo: ${run.repoPath}`);

      // Post start feedback: agent session activity if available, otherwise a plain issue comment
      if (run.providerSessionId) {
        await this.activityNotifier.postStart(
          run.providerSessionId,
          run.issueIdentifier,
          run.domainLabel,
          run.skill,
          runId,
        );
      } else {
        await this.issueComments.postProgress(run.issueId, run.domainLabel, run.skill, runId);
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
      } else if (result.status === 'needs_input') {
        this.logger.warn(`[NEEDS_ATTENTION] Run stopped to ask: ${runId} - ${result.errorSnippet}`);
      } else {
        const reason = result.errorSnippet || `exit code ${result.exitCode}`;
        this.logger.error(`Run completed: ${runId} (${result.status}) - ${reason}`);
      }

      // Post completion feedback: agent session activity if available, otherwise a plain issue comment
      const summary =
        result.resultText ||
        `Claude skill \`/${run.skill}\` completed successfully in \`${run.domainLabel}\` repo`;
      const failureMessage = result.errorSnippet || `Run failed with exit code ${result.exitCode}`;
      if (run.providerSessionId) {
        if (result.status === 'succeeded') {
          await this.activityNotifier.postSuccess(run.providerSessionId, summary);
        } else if (result.status === 'needs_input') {
          await this.activityNotifier.postElicitation(run.providerSessionId, summary);
        } else {
          await this.activityNotifier.postError(run.providerSessionId, failureMessage);
        }
      } else {
        if (result.status === 'succeeded') {
          await this.issueComments.postSuccess(run.issueId, summary);
        } else if (result.status === 'needs_input') {
          await this.issueComments.postRequired(run.issueId, summary);
        } else {
          await this.issueComments.postFailure(run.issueId, failureMessage);
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Run failed: ${runId} - ${errorMsg}`);
      await this.store.completeRun(runId, {
        status: 'failed',
        errorSnippet: errorMsg,
      });

      // Post error feedback: agent session activity if available, otherwise a plain issue comment
      if (run.providerSessionId) {
        await this.activityNotifier.postError(run.providerSessionId, (error as Error).message);
      } else {
        await this.issueComments.postFailure(run.issueId, (error as Error).message);
      }
    }
  }
}
