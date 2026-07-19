import { LinearClient } from '@linear/sdk';
import type {
  ActivityType,
  LinearUserInfo,
  ActivityCreateResponse,
  IssueLabelsResponse,
  IssueContext,
  LinearClientLogger,
} from './types.js';

/**
 * Below this many webhook-supplied labels, treat the webhook payload as incomplete
 * and fetch the full label set via the Linear API. Real issues have domain + mode labels
 * (>=2), so fewer than that means the webhook likely missed updates.
 */
const MIN_LABEL_COUNT_FOR_FALLBACK = 2;

/**
 * Shared Linear API client for both relay and dispatcher services.
 * Wraps @linear/sdk for issue/activity/comment operations used by webhook routing.
 */
export class LinearGraphQLClient {
  private readonly client: LinearClient;

  constructor(
    private readonly apiKey: string,
    private readonly logger?: LinearClientLogger,
  ) {
    this.client = new LinearClient({ apiKey: this.apiKey });
  }

  /**
   * Get current user info and teams from Linear
   * Used during OAuth flow in relay-service
   */
  async getUserInfo(accessToken: string): Promise<LinearUserInfo> {
    const client = accessToken ? new LinearClient({ accessToken }) : this.client;

    const viewer = await client.viewer;
    if (!viewer?.id) {
      throw new Error('Failed to extract user ID from Linear response');
    }

    const teamsConnection = await viewer.teams();
    const teams = teamsConnection.nodes.map((team) => ({
      id: team.id,
      key: team.key,
      name: team.name,
    }));
    if (teams.length === 0) {
      throw new Error('User has no Linear teams');
    }

    return {
      linearUserId: viewer.id,
      email: viewer.email,
      teams,
    };
  }

  /**
   * Create an activity in a Linear agent session
   * Used by dispatcher-service for activity posting
   */
  async createActivity(
    agentSessionId: string,
    type: ActivityType,
    body: string,
  ): Promise<ActivityCreateResponse> {
    if (!agentSessionId || !type || !body) {
      throw new Error('Missing required fields for activity creation');
    }

    try {
      const response = await this.client.createAgentActivity({
        agentSessionId,
        content: { type, body },
      });

      if (!response.agentActivityId) {
        throw new Error('No activity ID returned from Linear API');
      }

      return { id: response.agentActivityId };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger?.error(
        `Failed to create Linear agent activity: ${errorMsg} sessionId=${agentSessionId} type=${type}`,
      );
      throw error;
    }
  }

  /**
   * Post a plain comment on an issue.
   * Unlike createActivity, this has no session dependency — Linear's activity
   * feed only exists inside an Agent Session's timeline (agentSessionId is a
   * required, non-nullable argument on that mutation), so a comment is the
   * only Linear-side feedback surface available for webhooks with no session
   * (e.g. plain issue updates, not Agent Session interactions).
   */
  async createComment(issueId: string, body: string): Promise<{ id: string }> {
    if (!issueId || !body) {
      throw new Error('Missing required fields for comment creation');
    }

    try {
      const response = await this.client.createComment({ issueId, body });

      if (!response.commentId) {
        throw new Error('No comment ID returned from Linear API');
      }

      return { id: response.commentId };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger?.error(`Failed to create Linear comment: ${errorMsg} issueId=${issueId}`);
      throw error;
    }
  }

  /**
   * Resolve issue labels and identifier, falling back to a Linear API fetch when the
   * webhook-supplied labels look incomplete (fewer than MIN_LABEL_COUNT_FOR_FALLBACK).
   * Webhooks are the primary source of truth (fast, already delivered); the API is only
   * queried when the webhook payload missed updates. The identifier comes along for free
   * on that same fetch — AgentSession webhooks never carry one, so this is the only place
   * dispatcher-service can recover it without a second API round trip. Falls back to the
   * webhook labels (and no identifier) if the API fetch itself fails, so a Linear API
   * outage doesn't block routing.
   */
  async resolveIssueContext(issueId: string, webhookLabels: string[]): Promise<IssueContext> {
    if (webhookLabels.length >= MIN_LABEL_COUNT_FOR_FALLBACK) {
      this.logger?.debug(
        `Webhook label count meets fallback threshold, skipping Linear API fetch labelCount=${webhookLabels.length} threshold=${MIN_LABEL_COUNT_FOR_FALLBACK} issueId=${issueId}`,
      );
      return { labels: webhookLabels };
    }

    this.logger?.log(
      `Webhook label count below fallback threshold, fetching full label set from Linear API labelCount=${webhookLabels.length} threshold=${MIN_LABEL_COUNT_FOR_FALLBACK} issueId=${issueId}`,
    );

    try {
      const result = await this.fetchIssueLabels(issueId);
      this.logger?.log(
        `Resolved labels via Linear API fallback resolvedCount=${result.labels.length} webhookCount=${webhookLabels.length} issueId=${issueId}`,
      );
      return { labels: result.labels, identifier: result.identifier };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger?.warn(
        `Linear API label fallback failed, using webhook-supplied labels instead: ${errorMsg} issueId=${issueId}`,
      );
      return { labels: webhookLabels };
    }
  }

  /**
   * Fetch issue assignee and team from Linear
   * Used by relay-service to resolve routing for agent session webhooks
   */
  async fetchIssueAssignee(
    issueId: string,
  ): Promise<{ assigneeId?: string; teamId?: string; teamKey?: string }> {
    if (!issueId) {
      throw new Error('issueId is required');
    }

    const issue = await this.client.issue(issueId);
    if (!issue) {
      return {};
    }

    const [assignee, team] = await Promise.all([issue.assignee, issue.team]);

    return {
      assigneeId: assignee?.id,
      teamId: team?.id,
      teamKey: team?.key,
    };
  }

  /**
   * Fetch issue labels from Linear
   * Used by dispatcher-service for label fallback when webhook labels incomplete
   */
  async fetchIssueLabels(issueId: string): Promise<IssueLabelsResponse> {
    if (!issueId) {
      throw new Error('issueId is required');
    }

    const issue = await this.client.issue(issueId);
    if (!issue) {
      return { labels: [] };
    }

    const labelsConnection = await issue.labels();
    const labelNames = labelsConnection.nodes
      .map((label) => label.name)
      .filter((name): name is string => !!name && typeof name === 'string');

    return { labels: labelNames, identifier: issue.identifier };
  }
}
