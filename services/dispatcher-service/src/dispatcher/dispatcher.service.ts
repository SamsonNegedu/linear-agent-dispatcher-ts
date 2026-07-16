import { Injectable, Inject, Logger } from '@nestjs/common';
import type { IStoreRepository } from '../store/store.interfaces';
import { ExecutorService } from '../executor/executor.service';
import type { VerifiedEvent } from '@webhook-verify/core';
import type { DispatcherConfig } from '../config/config';
import { ReposConfigService } from '../config/repos-config.service';
import { ActivityNotifierService } from '../executor/activity-notifier.service';
import { IssueCommentService } from '../executor/issue-comment.service';
import { LinearGraphQLClient } from '@linear-agent/linear-client';
import { LabelValidationService } from './label-validation.service';
import { ValidationError } from './validation.error';
import { DuplicatePayloadError } from '../store/store.errors';

@Injectable()
export class DispatcherService {
  private readonly logger = new Logger(DispatcherService.name);
  private linearGraphqlClient: LinearGraphQLClient | null;

  constructor(
    @Inject('IStoreRepository') private readonly store: IStoreRepository,
    private readonly executorService: ExecutorService,
    @Inject('DispatcherConfig') private readonly config: DispatcherConfig,
    private readonly reposConfig: ReposConfigService,
    private readonly activityNotifier: ActivityNotifierService,
    private readonly issueComments: IssueCommentService,
  ) {
    // Initialize LinearGraphQLClient for label fallback if configured
    this.linearGraphqlClient = config.linear.apiKey
      ? new LinearGraphQLClient(config.linear.apiKey, this.logger)
      : null;
  }

  async dispatchWebhook(event: VerifiedEvent): Promise<void> {
    this.logger.log(`Dispatching webhook: ${event.webhookId} for issue ${event.issueIdentifier}`);

    try {
      // Resolve labels (with GraphQL fallback if webhook incomplete)
      const labels = this.linearGraphqlClient
        ? await this.linearGraphqlClient.resolveLabels(event.issueId, event.labels || [])
        : event.labels || [];

      // Validate and resolve labels to routing decision
      const { repoLabel, repoPath, skill } = LabelValidationService.resolveRun(
        labels,
        this.reposConfig,
      );

      // Enqueue run
      const run = await this.store.enqueueRun({
        provider: 'linear',
        issueId: event.issueId,
        issueIdentifier: event.issueIdentifier,
        issueTitle: event.issueTitle,
        idempotencyKey: event.webhookId,
        webhookId: event.webhookId,
        domainLabel: repoLabel,
        repoPath,
        skill,
        triggerSource: event.labelChange ? 'label' : 'webhook',
        providerSessionId: event.sessionId,
      });

      this.logger.log(`Enqueued run: ${run.id} in repo: ${repoPath} with skill: ${skill}`);

      // Post acknowledgment to Linear session if available
      if (event.sessionId) {
        await this.activityNotifier.postStart(
          event.sessionId,
          event.issueIdentifier,
          repoLabel,
          skill,
          run.id,
        );
      }

      // Spawn handler (fire-and-forget)
      this.executorService.executeRun(run.id, event).catch((error) => {
        this.logger.error(`Executor error for run ${run.id}:`, error);
      });
    } catch (error) {
      // Skip elicitation feedback for duplicate payloads (already processed)
      if (error instanceof DuplicatePayloadError) {
        throw error;
      }

      // Distinguish between expected validation failures and unexpected bugs
      if (error instanceof ValidationError) {
        // Expected failure: user needs to fix labels/config
        // Already posting comment/activity below; log at INFO level with clear marker
        this.logger.log(
          `[ACTION_POSTED] Label validation failed for ${event.issueIdentifier}: ${error.message}`,
        );
      } else {
        // Unexpected failure: something is broken on the server
        this.logger.error(
          `[NEEDS_ATTENTION] Unexpected error dispatching ${event.webhookId}:`,
          error,
        );
      }

      // Route error notification based on webhook type:
      // - Agent sessions: post activity (rich, structured feedback in session timeline)
      // - Issue webhooks: post comment (plain feedback on issue thread)
      if (error instanceof Error) {
        if (event.sessionId) {
          await this.activityNotifier.postElicitation(event.sessionId, error.message);
        } else if (event.issueId) {
          await this.issueComments.postRequired(event.issueId, error.message);
        }
      }

      throw error;
    }
  }
}
