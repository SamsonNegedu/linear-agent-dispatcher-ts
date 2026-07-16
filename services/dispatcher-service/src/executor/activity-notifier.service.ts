import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import type { DispatcherConfig } from '../config/config';
import { LinearGraphQLClient, ActivityType } from '@linear-agent/linear-client';

/**
 * Posts agent activities to Linear's agent session UI.
 * Routes all user-visible run progress through Linear activities (matching ADR 0005).
 *
 * Activity types map to Linear agent states:
 * - thought: Agent is working (run start, intermediate progress)
 * - response: Work finished (success or dry-run complete)
 * - error: Run failed, blocked, or validation error
 * - elicitation: Awaiting user input (missing labels, insufficient permissions)
 *
 * Does nothing if sessionId is not provided (non-agent-session triggers are silent).
 * Activity posting failures are logged but don't block run execution.
 *
 * For non-session issue webhooks (plain comments), use IssueCommentService instead.
 */
@Injectable()
export class ActivityNotifierService {
  private readonly logger = new Logger(ActivityNotifierService.name);
  private readonly linearClient: LinearGraphQLClient | null;

  constructor(@Inject('DispatcherConfig') private readonly config: DispatcherConfig) {
    // Only initialize Linear client if API key is configured
    this.linearClient = config.linear.apiKey
      ? new LinearGraphQLClient(config.linear.apiKey, this.logger)
      : null;
  }

  /**
   * Post "working" activity on run start with repo, skill, and run ID.
   * Let user see what agent is doing and how to track it.
   */
  async postStart(
    sessionId: string,
    issueId: string,
    repoLabel: string,
    skill: string,
    runId: string,
  ): Promise<void> {
    const body =
      `**Run started in \`${repoLabel}\` repo**\n\n` +
      `Skill: \`/${skill}\`\n` +
      `Issue: ${issueId}\n` +
      `Run ID: \`${runId}\``;

    await this.post(sessionId, 'thought', body, `[START] ${repoLabel}/${skill} (${runId})`);
  }

  /**
   * Post success activity on run completion with summary of what happened.
   */
  async postSuccess(sessionId: string, summary: string): Promise<void> {
    const body = `**Run succeeded**\n\n${summary}`;
    await this.post(sessionId, 'response', body, '[SUCCESS]');
  }

  /**
   * Post error activity on run failure with actionable error details.
   */
  async postError(sessionId: string, errorMessage: string): Promise<void> {
    const truncated = errorMessage.length > 500 ? errorMessage.slice(0, 500) + '…' : errorMessage;
    const body = `**Run failed**\n\n\`\`\`\n${truncated}\n\`\`\``;
    await this.post(sessionId, 'error', body, '[ERROR]');
  }

  /**
   * Post elicitation activity when user input is needed (missing/invalid labels, permission errors).
   * Only works for agent sessions (requires sessionId).
   * For non-session webhooks, use IssueCommentService.postRequired() instead.
   */
  async postElicitation(sessionId: string, message: string): Promise<void> {
    const body = `**Action required**\n\n${message}`;
    await this.post(sessionId, 'elicitation', body, '[INPUT_NEEDED]');
  }

  /**
   * Post dry-run completion activity.
   * Dry runs succeed but don't make changes; this marks the session complete.
   */
  async postDryRun(sessionId: string, summary: string): Promise<void> {
    const body = `**Dry run complete**\n\n${summary}`;
    await this.post(sessionId, 'response', body, '[DRY_RUN]');
  }

  private async post(
    sessionId: string | undefined,
    type: ActivityType,
    body: string,
    logTag: string,
  ): Promise<void> {
    // Silent skip if no session (non-agent-session trigger)
    if (!sessionId) {
      return;
    }

    // Skip if Linear client not initialized (no API key configured)
    if (!this.linearClient) {
      this.logger.warn(`${logTag} Activity skipped: LINEAR_API_KEY not configured [${type}]`);
      return;
    }

    try {
      const result = await this.linearClient.createActivity(sessionId, type, body);
      this.logger.log(`${logTag} Activity posted: ${result.id} [${type}]`);
    } catch (err) {
      // Log but don't fail — activity posting is not critical to run execution
      // If Linear API is down, runs should still complete
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`${logTag} Failed to post activity: ${errorMsg} [${type}]`);
    }
  }
}
