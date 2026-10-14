import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { DispatcherConfig } from '../../config/config';
import {
  ActivityType,
  LinearGraphQLClient,
  chooseAppCredential,
  type TokenSource,
} from '@linear-agent/linear-client';
import { MAX_ERROR_MESSAGE_LENGTH } from './constants';
import { errorMessage } from '../../common/error-message';
import type { FeedbackTarget, RunReporter } from './run-reporter';

interface Message {
  activity: ActivityType; // how it appears in an agent session timeline
  tag: string; // log marker
  body: string;
}

/**
 * The Linear RunReporter: tells the user what a run is doing: an agent-session activity when the run was
 * triggered from a session, a plain issue comment otherwise. Posting never throws, so a
 * Linear outage cannot fail a run, and is skipped without LINEAR_API_KEY.
 */
@Injectable()
export class LinearRunReporter implements RunReporter, OnModuleInit {
  readonly provider = 'linear';
  private readonly logger = new Logger(LinearRunReporter.name);
  // Linear accepts agent-session activities only from the app's OAuth token, and issue comments
  // from either credential, so each falls back to the other when only one is configured.
  private readonly activityClient: LinearGraphQLClient | null;
  private readonly commentClient: LinearGraphQLClient | null;

  constructor(@Inject('DispatcherConfig') config: DispatcherConfig) {
    const { apiKey, agentToken, oauthClientId, oauthClientSecret } = config.linear;
    const build = (credential?: string | TokenSource) =>
      credential ? new LinearGraphQLClient(credential, this.logger) : null;
    // The app's client credentials (always current) beat a fixed agent token, which beats a personal key.
    const app = chooseAppCredential({
      oauthClientId,
      oauthClientSecret,
      agentToken,
      apiKey,
      logger: this.logger,
    });
    this.activityClient = build(app);
    this.commentClient = build(apiKey ?? app);
  }

  /** Says at startup who activities will be posted as, so a wrong credential is not found mid-run. */
  onModuleInit(): void {
    const client = this.activityClient;
    if (!client) return;
    client.getViewer().then(
      ({ name, app }) => {
        if (app) this.logger.log(`Posting agent activity as the app user "${name}"`);
        else
          this.logger.warn(
            `Agent activity would post as "${name}", not an app user, and Linear will reject it. ` +
              `Set LINEAR_OAUTH_CLIENT_ID and LINEAR_OAUTH_CLIENT_SECRET so the app token is minted for you.`,
          );
      },
      (error) =>
        this.logger.warn(`Could not verify the Linear credentials: ${errorMessage(error)}`),
    );
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

  cancelled(target: FeedbackTarget): Promise<void> {
    return this.send(target, {
      activity: 'response',
      tag: '[CANCELLED]',
      body: '**Run cancelled** from the dispatcher monitor.',
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

  /**
   * Closes an agent session that did not start a run because one is already in progress.
   * Without any activity Linear shows the session as "Agent didn't start". Silent for
   * plain issue comments, where a second comment would only be noise.
   */
  skipped(target: FeedbackTarget, message: string): Promise<void> {
    if (!target.sessionId) return Promise.resolve();
    return this.send(target, { activity: 'response', tag: '[SKIPPED]', body: message });
  }

  private async send(target: FeedbackTarget, { activity, tag, body }: Message): Promise<void> {
    if (!target.sessionId && !target.issueId) return;
    const client = target.sessionId ? this.activityClient : this.commentClient;
    if (!client) {
      this.logger.warn(`${tag} Skipped: LINEAR_API_KEY not configured`);
      return;
    }

    try {
      const result = target.sessionId
        ? await client.createActivity(target.sessionId, activity, body)
        : await client.createComment(target.issueId!, body);
      this.logger.log(`${tag} Posted ${target.sessionId ? 'activity' : 'comment'}: ${result.id}`);
    } catch (error) {
      this.logger.error(`${tag} Failed to post: ${errorMessage(error)}`);
    }
  }
}
