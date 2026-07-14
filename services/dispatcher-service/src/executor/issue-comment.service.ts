import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { DispatcherConfig } from '../config/config';
import { LinearGraphQLClient } from '@linear-agent/linear-client';

/**
 * Posts regular issue comments for non-session workflows.
 * Routes all user-visible issue-level feedback through Linear comments
 * when there's no Agent Session (i.e., plain issue webhooks, not agent-triggered).
 *
 * Complements ActivityNotifierService (which posts to agent sessions only).
 * Together they provide complete visibility:
 * - Activities → agent session timeline (rich, structured)
 * - Comments → issue thread (always visible, no session required)
 */
@Injectable()
export class IssueCommentService {
  private readonly logger = new Logger(IssueCommentService.name);
  private readonly linearClient: LinearGraphQLClient | null;

  constructor(@Inject('DispatcherConfig') private readonly config: DispatcherConfig) {
    this.linearClient = config.linear.apiKey
      ? new LinearGraphQLClient(config.linear.apiKey, this.logger)
      : null;
  }

  /**
   * Post progress comment when run starts (no session available).
   */
  async postProgress(
    issueId: string,
    repoLabel: string,
    skill: string,
    runId: string,
  ): Promise<void> {
    const body =
      `**Run started in \`${repoLabel}\` repo**\n\n` +
      `Skill: \`/${skill}\`\n` +
      `Run ID: \`${runId}\``;

    await this.post(issueId, body, '[START] progress');
  }

  /**
   * Post success comment on run completion.
   */
  async postSuccess(issueId: string, summary: string): Promise<void> {
    const body = `**Run succeeded**\n\n${summary}`;
    await this.post(issueId, body, '[SUCCESS]');
  }

  /**
   * Post failure comment on run error.
   */
  async postFailure(issueId: string, errorMessage: string): Promise<void> {
    const truncated = errorMessage.length > 500 ? errorMessage.slice(0, 500) + '…' : errorMessage;
    const body = `**Run failed**\n\n\`\`\`\n${truncated}\n\`\`\``;
    await this.post(issueId, body, '[FAILURE]');
  }

  /**
   * Post action-required comment when user input is needed
   * (missing/invalid labels, permission errors, configuration issues).
   */
  async postRequired(issueId: string, message: string): Promise<void> {
    const body = `**Action required**\n\n${message}`;
    await this.post(issueId, body, '[ACTION_REQUIRED]');
  }

  /**
   * Post informational comment (debug, skip reasons, warnings).
   */
  async postInfo(issueId: string, message: string): Promise<void> {
    const body = `**Info**\n\n${message}`;
    await this.post(issueId, body, '[INFO]');
  }

  /**
   * Post dry-run completion comment.
   */
  async postDryRun(issueId: string, summary: string): Promise<void> {
    const body = `**Dry run complete**\n\n${summary}`;
    await this.post(issueId, body, '[DRY_RUN]');
  }

  private async post(issueId: string, body: string, logTag: string): Promise<void> {
    if (!this.linearClient) {
      this.logger.warn(
        `${logTag} Comment skipped: LINEAR_API_KEY not configured (issue=${issueId})`,
      );
      return;
    }

    try {
      const result = await this.linearClient.createComment(issueId, body);
      this.logger.log(`${logTag} Comment posted: ${result.id} (issue=${issueId})`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`${logTag} Failed to post comment: ${errorMsg} (issue=${issueId})`);
    }
  }
}
