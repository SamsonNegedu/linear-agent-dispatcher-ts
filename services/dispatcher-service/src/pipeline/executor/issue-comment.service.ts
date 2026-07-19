import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import type { DispatcherConfig } from '../../config/config';
import { LinearGraphQLClient } from '@linear-agent/linear-client';
import { MAX_ERROR_MESSAGE_LENGTH } from './constants';

export enum CommentType {
  START = '[START] progress',
  SUCCESS = '[SUCCESS]',
  FAILURE = '[FAILURE]',
  ACTION_REQUIRED = '[ACTION_REQUIRED]',
  INFO = '[INFO]',
  DRY_RUN = '[DRY_RUN]',
}

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

    await this.post(issueId, body, CommentType.START);
  }

  /**
   * Post success comment on run completion.
   */
  async postSuccess(issueId: string, summary: string): Promise<void> {
    const body = `**Run succeeded**\n\n${summary}`;
    await this.post(issueId, body, CommentType.SUCCESS);
  }

  /**
   * Post failure comment on run error.
   */
  async postFailure(issueId: string, errorMessage: string): Promise<void> {
    // Keep the *start* of the message: this is a curated, human-written
    // error string (e.g. "Label validation failed: ..."), not a raw log —
    // the salient point is stated up front, unlike raw stderr capture.
    const truncated =
      errorMessage.length > MAX_ERROR_MESSAGE_LENGTH
        ? errorMessage.slice(0, MAX_ERROR_MESSAGE_LENGTH) + '…'
        : errorMessage;
    const body = `**Run failed**\n\n\`\`\`\n${truncated}\n\`\`\``;
    await this.post(issueId, body, CommentType.FAILURE);
  }

  /**
   * Post action-required comment when user input is needed
   * (missing/invalid labels, permission errors, configuration issues).
   */
  async postRequired(issueId: string, message: string): Promise<void> {
    const body = `**Action required**\n\n${message}`;
    await this.post(issueId, body, CommentType.ACTION_REQUIRED);
  }

  /**
   * Post informational comment (debug, skip reasons, warnings).
   */
  async postInfo(issueId: string, message: string): Promise<void> {
    const body = `**Info**\n\n${message}`;
    await this.post(issueId, body, CommentType.INFO);
  }

  /**
   * Post dry-run completion comment.
   */
  async postDryRun(issueId: string, summary: string): Promise<void> {
    const body = `**Dry run complete**\n\n${summary}`;
    await this.post(issueId, body, CommentType.DRY_RUN);
  }

  private async post(issueId: string, body: string, logTag: CommentType): Promise<void> {
    if (!this.linearClient) {
      this.logger.warn(
        `${logTag} Comment skipped: LINEAR_API_KEY not configured (issue=${issueId})`,
      );
      return;
    }

    try {
      const result = await this.linearClient.createComment(issueId, body);
      this.logger.log(`${logTag} Comment posted: ${result.id} (issue=${issueId})`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`${logTag} Failed to post comment: ${errorMsg} (issue=${issueId})`);
    }
  }
}
