import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DispatcherConfig } from '../../config/config';
import { ActivityType, LinearGraphQLClient } from '@linear-agent/linear-client';
import { MAX_ERROR_MESSAGE_LENGTH } from './constants';

/** Where feedback goes: the agent session when there is one, otherwise a comment on the issue. */
export interface FeedbackTarget {
  issueId?: string;
  sessionId?: string;
}

interface Message {
  activity: ActivityType; // how it appears in an agent session timeline
  tag: string; // log marker
  body: string;
}

/**
 * Tells the user what a run is doing, on Linear: an agent-session activity when the run was
 * triggered from a session, a plain issue comment otherwise. Posting never throws, so a
 * Linear outage cannot fail a run, and is skipped without LINEAR_API_KEY.
 */
@Injectable()
export class RunFeedbackService {
  private readonly logger = new Logger(RunFeedbackService.name);
  private readonly linear: LinearGraphQLClient | null;

  constructor(@Inject('DispatcherConfig') config: DispatcherConfig) {
    this.linear = config.linear.apiKey
      ? new LinearGraphQLClient(config.linear.apiKey, this.logger)
      : null;
  }

  started(
    target: FeedbackTarget,
    run: { repoLabel: string; skill: string; runId: string; issueIdentifier?: string },
  ): Promise<void> {
    const lines = [`**Run started in \`${run.repoLabel}\` repo**`, '', `Skill: \`/${run.skill}\``];
    if (target.sessionId && run.issueIdentifier) lines.push(`Issue: ${run.issueIdentifier}`);
    lines.push(`Run ID: \`${run.runId}\``);
    return this.send(target, { activity: 'thought', tag: '[START]', body: lines.join('\n') });
  }

  succeeded(target: FeedbackTarget, summary: string): Promise<void> {
    return this.send(target, {
      activity: 'response',
      tag: '[SUCCESS]',
      body: `**Run succeeded**\n\n${summary}`,
    });
  }

  failed(target: FeedbackTarget, message: string): Promise<void> {
    // Keep the *start* of the message: it is a curated error, not a raw log, so the
    // salient point comes first (unlike raw stderr, see ClaudeAgentService).
    const text =
      message.length > MAX_ERROR_MESSAGE_LENGTH
        ? `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`
        : message;
    return this.send(target, {
      activity: 'error',
      tag: '[ERROR]',
      body: `**Run failed**\n\n\`\`\`\n${text}\n\`\`\``,
    });
  }

  /** Something the user must fix or answer: missing labels, a stopped run's question. */
  needsInput(target: FeedbackTarget, message: string): Promise<void> {
    return this.send(target, {
      activity: 'elicitation',
      tag: '[INPUT_NEEDED]',
      body: `**Action required**\n\n${message}`,
    });
  }

  private async send(target: FeedbackTarget, { activity, tag, body }: Message): Promise<void> {
    if (!target.sessionId && !target.issueId) return;
    if (!this.linear) {
      this.logger.warn(`${tag} Skipped: LINEAR_API_KEY not configured`);
      return;
    }

    try {
      const result = target.sessionId
        ? await this.linear.createActivity(target.sessionId, activity, body)
        : await this.linear.createComment(target.issueId!, body);
      this.logger.log(`${tag} Posted ${target.sessionId ? 'activity' : 'comment'}: ${result.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`${tag} Failed to post: ${message}`);
    }
  }
}
