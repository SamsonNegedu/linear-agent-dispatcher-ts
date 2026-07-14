import { Injectable, Inject, Logger } from '@nestjs/common';
import { IStoreRepository } from '../store/store.interfaces';
import { ExecutorService } from '../executor/executor.service';
import { VerifiedEvent } from '@webhook-verify/core';
import { DispatcherConfig } from '../config/config';
import { ReposConfigService } from '../config/repos-config.service';
import { ActivityNotifierService } from '../executor/activity-notifier.service';
import { IssueCommentService } from '../executor/issue-comment.service';
import { LinearGraphQLClient } from '@linear-agent/linear-client';
import { LabelTriggerService, LabelValidationError } from './label-trigger.service';
import { LabelValidationService } from './label-validation.service';
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
      // Special handling for label triggers (Issue webhooks with mode label added)
      if (LabelTriggerService.isLabelTrigger(event)) {
        this.logger.log(`Label trigger detected: mode label added to ${event.issueIdentifier}`);
        return this.handleLabelTrigger(event);
      }

      // Standard webhook dispatch (agent sessions, issue comments, etc)
      return await this.handleStandardWebhook(event);
    } catch (err) {
      this.logger.error(`Failed to dispatch webhook ${event.webhookId}:`, err);

      // Skip elicitation feedback for duplicate payloads (already processed)
      if (err instanceof DuplicatePayloadError) {
        throw err;
      }

      // Route error notification based on webhook type:
      // - Agent sessions: post activity (rich, structured feedback in session timeline)
      // - Issue webhooks: post comment (plain feedback on issue thread)
      if (err instanceof Error) {
        if (event.sessionId) {
          await this.activityNotifier.postElicitation(event.sessionId, err.message);
        } else if (event.issueId) {
          await this.issueComments.postRequired(event.issueId, err.message);
        }
      }

      throw err;
    }
  }

  private async handleLabelTrigger(event: VerifiedEvent): Promise<void> {
    // For label triggers, we need to validate labels before dispatching
    try {
      // Validate that issue has exactly one mode label
      LabelTriggerService.validateLabels(event.labels);

      // Resolve labels (with GraphQL fallback if webhook incomplete)
      const labels = this.linearGraphqlClient
        ? await this.linearGraphqlClient.resolveLabels(event.issueId, event.labels || [])
        : event.labels || [];

      // Route and enqueue
      const { repoLabel, repoPath, skill } = LabelValidationService.resolveRun(
        labels,
        this.reposConfig,
      );

      const run = await this.store.enqueueRun({
        provider: 'linear',
        issueId: event.issueId,
        issueIdentifier: event.issueIdentifier,
        idempotencyKey: event.webhookId,
        webhookId: event.webhookId,
        domainLabel: repoLabel,
        repoPath,
        skill,
        triggerSource: 'label',
        providerSessionId: event.sessionId,
      });

      this.logger.log(
        `Label trigger enqueued run: ${run.id} in repo: ${repoPath} with skill: ${skill}`,
      );

      // Spawn handler (fire-and-forget)
      this.executorService.executeRun(run.id, event).catch((err) => {
        this.logger.error(`Executor error for run ${run.id}:`, err);
      });
    } catch (err) {
      if (err instanceof LabelValidationError) {
        this.logger.warn(
          `Label trigger validation failed for ${event.issueIdentifier}: ${err.message}`,
        );
        // Label trigger validation errors are not fatal — just log and return
        // The operator will see the issue and fix the labels
        return;
      }
      throw err;
    }
  }

  private async handleStandardWebhook(event: VerifiedEvent): Promise<void> {
    // 0. Resolve labels (with GraphQL fallback if webhook incomplete)
    const labels = this.linearGraphqlClient
      ? await this.linearGraphqlClient.resolveLabels(event.issueId, event.labels || [])
      : event.labels || [];

    // 1. Resolve domain label, repo path, and skill from issue labels
    const { repoLabel, repoPath, skill } = LabelValidationService.resolveRun(
      labels,
      this.reposConfig,
    );

    // 2. Enqueue run in store
    const run = await this.store.enqueueRun({
      provider: 'linear',
      issueId: event.issueId,
      issueIdentifier: event.issueIdentifier,
      idempotencyKey: event.webhookId,
      webhookId: event.webhookId,
      domainLabel: repoLabel,
      repoPath,
      skill,
      triggerSource: 'webhook',
      providerSessionId: event.sessionId,
    });

    this.logger.log(`Enqueued run: ${run.id} in repo: ${repoPath} with skill: ${skill}`);

    // 3. Spawn handler (fire-and-forget, don't wait)
    this.executorService.executeRun(run.id, event).catch((err) => {
      this.logger.error(`Executor error for run ${run.id}:`, err);
    });

    // 4. Post acknowledgment to Linear session if available
    if (event.sessionId) {
      await this.activityNotifier.postStart(
        event.sessionId,
        event.issueIdentifier,
        repoLabel,
        skill,
        run.id,
      );
    }
  }
}
