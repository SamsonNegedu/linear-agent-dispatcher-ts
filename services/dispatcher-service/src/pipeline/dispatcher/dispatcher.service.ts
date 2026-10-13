import { Injectable, Inject, Logger } from '@nestjs/common';
import type { IStoreRepository } from '../../store/store.interfaces';
import { ExecutorService } from '../executor/executor.service';
import { ValidationError, IncompleteLabelsError, AdapterRegistry } from '@webhook-verify/core';
import type { DispatchAdapter, NormalizedEvent } from '@webhook-verify/core';
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
    @Inject('DispatchAdapterRegistry')
    private readonly dispatchAdapterRegistry: AdapterRegistry<DispatchAdapter>,
    @Inject('IIssueContextResolver') private readonly issueContextResolver: IIssueContextResolver,
  ) {}

  async dispatchWebhook(event: NormalizedEvent): Promise<void> {
    const dispatchAdapter = this.dispatchAdapterRegistry.getOrThrow(event.provider);
    const decision = dispatchAdapter.shouldDispatch(event);
    if (!decision.shouldDispatch) {
      this.logger.debug(
        `Skipping dispatch: ${decision.reason} issue=${event.issueIdentifier} webhookId=${event.webhookId}`,
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
        event.routingTags,
      );
      event.routingTags = issueContext.labels;
      if (!event.issueIdentifier && issueContext.identifier) {
        event.issueIdentifier = issueContext.identifier;
      }

      // Validate and resolve routing tags to a routing decision
      const { repoLabel, repoPath, skill, dedupeWindowMs } = dispatchAdapter.resolveRouting(event);

      // Enqueue run
      const run = await this.store.enqueueRun({
        provider: event.provider,
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
        dedupeWindowMs,
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
      // Skip feedback for duplicate payloads (already processed)
      if (error instanceof DuplicatePayloadError) {
        throw error;
      }

      // Policy rejection: the store deliberately declined to enqueue this run
      // (another run is active, or one just completed for the same
      // issue/domain/skill). Not a bug, and a comment on the issue would only
      // be noise next to the run that is already there.
      if (error instanceof ActiveRunError || error instanceof RecentDuplicateRunError) {
        this.logger.log(
          `[ACTION_SKIPPED] Run rejected by policy for ${event.issueIdentifier}: ${error.message}`,
        );
        throw error;
      }

      // Missing-mode-label-only: routine state for issues still being triaged,
      // not a misconfiguration — skip silently instead of posting feedback on
      // every relabel or update.
      if (error instanceof IncompleteLabelsError) {
        this.logger.debug(
          `Skipping dispatch: mode label not yet set for ${event.issueIdentifier}: ${error.message}`,
        );
        return;
      }

      // Distinguish expected outcomes (user-fixable) from unexpected bugs, so
      // alerting/log-scanning on [NEEDS_ATTENTION] isn't polluted by
      // conditions the system is deliberately enforcing.
      if (error instanceof ValidationError) {
        // Expected failure: user needs to fix labels/config
        // Already posting feedback below; log at INFO level with clear marker
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

      if (error instanceof Error) {
        await dispatchAdapter.postFeedback(event, error.message);
      }

      throw error;
    }
  }
}
