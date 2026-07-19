import { Injectable, Inject, Logger } from '@nestjs/common';
import type { IStoreRepository } from '../../store/store.interfaces';
import { ExecutorService } from '../executor/executor.service';
import { shouldTriggerDispatch, isTerminalStateType, type VerifiedEvent } from '@webhook-verify/core';
import { RoutingConfigService } from '../../config/routing-config.service';
import { ActivityNotifierService } from '../executor/activity-notifier.service';
import { IssueCommentService } from '../executor/issue-comment.service';
import { LabelValidationService } from './label-validation.service';
import { ValidationError, IncompleteLabelsError } from './validation.error';
import type { IIssueContextResolver } from './issue-context-resolver.interface';
import {
  DuplicatePayloadError,
  ActiveRunError,
  RecentDuplicateRunError,
} from '../../store/store.errors';

@Injectable()
export class DispatcherService {
  private readonly logger = new Logger(DispatcherService.name);

  constructor(
    @Inject('IStoreRepository') private readonly store: IStoreRepository,
    private readonly executorService: ExecutorService,
    private readonly routingConfig: RoutingConfigService,
    private readonly activityNotifier: ActivityNotifierService,
    private readonly issueComments: IssueCommentService,
    @Inject('IIssueContextResolver') private readonly issueContextResolver: IIssueContextResolver,
  ) {}

  async dispatchWebhook(event: VerifiedEvent): Promise<void> {
    const decision = shouldTriggerDispatch(event);
    if (!decision.shouldDispatch) {
      this.logger.debug(
        `Skipping dispatch: ${decision.reason} issue=${event.issueIdentifier} webhookId=${event.webhookId}`,
      );
      return;
    }

    const policy = this.routingConfig.getPolicy();
    if (policy.skipDoneIssues && isTerminalStateType(event.stateType)) {
      this.logger.debug(
        `Skipping dispatch: issue state is terminal (${event.stateType}) and policy.skipDoneIssues is enabled issue=${event.issueIdentifier} webhookId=${event.webhookId}`,
      );
      return;
    }

    this.logger.log(`Dispatching webhook: ${event.webhookId} for issue ${event.issueIdentifier}`);

    try {
      // Resolve labels (with GraphQL fallback if webhook incomplete). AgentSession
      // webhooks never carry an issueIdentifier, so backfill it from the same
      // fallback fetch instead of issuing a second API call for it.
      const issueContext = await this.issueContextResolver.resolveIssueContext(
        event.issueId,
        event.labels || [],
      );
      const labels = issueContext.labels;
      if (!event.issueIdentifier && issueContext.identifier) {
        event.issueIdentifier = issueContext.identifier;
      }

      // Validate and resolve labels to routing decision
      const { repoLabel, repoPath, skill } = LabelValidationService.resolveRun(
        labels,
        this.routingConfig,
      );

      // Enqueue run
      const run = await this.store.enqueueRun({
        provider: 'linear',
        issueId: event.issueId,
        issueIdentifier: event.issueIdentifier,
        issueTitle: event.issueTitle,
        idempotencyKey: event.idempotencyKey,
        webhookId: event.webhookId,
        domainLabel: repoLabel,
        repoPath,
        skill,
        triggerSource: event.labelChange ? 'label' : 'webhook',
        providerSessionId: event.sessionId,
        dedupeWindowMs: policy.duplicateRunWindowMs,
      });

      this.logger.log(`Enqueued run: ${run.id} in repo: ${repoPath} with skill: ${skill}`);

      // Start feedback (session activity or issue comment) is posted by the
      // executor once the run actually begins — see executor.service.ts.
      // Posting it here too would double it up on the same run.

      // Spawn handler (fire-and-forget)
      this.executorService.executeRun(run.id, event).catch((error) => {
        this.logger.error(`Executor error for run ${run.id}:`, error);
      });
    } catch (error) {
      // Skip elicitation feedback for duplicate payloads (already processed)
      if (error instanceof DuplicatePayloadError) {
        throw error;
      }

      // Missing-mode-label-only: routine state for issues still being triaged,
      // not a misconfiguration — skip silently instead of posting a comment/
      // activity on every relabel or update.
      if (error instanceof IncompleteLabelsError) {
        this.logger.debug(
          `Skipping dispatch: mode label not yet set for ${event.issueIdentifier}: ${error.message}`,
        );
        return;
      }

      // Distinguish expected outcomes (user-fixable, or a routine policy
      // rejection) from unexpected bugs, so alerting/log-scanning on
      // [NEEDS_ATTENTION] isn't polluted by conditions the system is
      // deliberately enforcing.
      if (error instanceof ValidationError) {
        // Expected failure: user needs to fix labels/config
        // Already posting comment/activity below; log at INFO level with clear marker
        this.logger.log(
          `[ACTION_POSTED] Label validation failed for ${event.issueIdentifier}: ${error.message}`,
        );
      } else if (error instanceof ActiveRunError || error instanceof RecentDuplicateRunError) {
        // Expected rejection: the store deliberately declined to enqueue this
        // run (another run is already active, or one just completed for the
        // same issue/domain/skill). Not a bug — already posting comment/
        // activity below so the user knows why nothing happened.
        this.logger.log(
          `[ACTION_SKIPPED] Run rejected by policy for ${event.issueIdentifier}: ${error.message}`,
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
