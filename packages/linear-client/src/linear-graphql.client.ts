import type {
  ActivityType,
  LinearUserInfo,
  ActivityCreateResponse,
  IssueLabelsResponse,
  LinearClientLogger,
} from './types.js';

/**
 * Below this many webhook-supplied labels, treat the webhook payload as incomplete
 * and fetch the full label set via GraphQL. Real issues have domain + mode labels
 * (>=2), so fewer than that means the webhook likely missed updates.
 */
const MIN_LABEL_COUNT_FOR_FALLBACK = 2;

/**
 * Shared Linear GraphQL client for both relay and dispatcher services.
 * Handles all GraphQL queries and mutations for Linear API interactions.
 */
export class LinearGraphQLClient {
  private readonly apiEndpoint = 'https://api.linear.app/graphql';
  private readonly requestTimeoutMs = 10000;

  constructor(
    private readonly apiKey: string,
    private readonly logger?: LinearClientLogger,
  ) {}

  /**
   * Get current user info and teams from Linear
   * Used during OAuth flow in relay-service
   */
  async getUserInfo(accessToken: string): Promise<LinearUserInfo> {
    const query = `query {
      viewer {
        id
        email
        teams {
          edges {
            node {
              id
              key
              name
            }
          }
        }
      }
    }`;

    const data = await this.executeGraphQL<{
      viewer: {
        id: string;
        email?: string;
        teams: {
          edges: Array<{
            node: {
              id: string;
              key: string;
              name: string;
            };
          }>;
        };
      };
    }>(query, undefined, accessToken);

    const viewer = data.viewer;
    if (!viewer || !viewer.id) {
      throw new Error('Failed to extract user ID from Linear response');
    }

    const teams = (viewer.teams?.edges || []).map((edge) => edge.node);
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

    const mutation = `mutation AgentActivityCreate(
      $agentSessionId: String!
      $content: JSONObject!
    ) {
      agentActivityCreate(input: {
        agentSessionId: $agentSessionId
        content: $content
      }) {
        agentActivity {
          id
        }
        success
      }
    }`;

    try {
      const response = await this.executeGraphQL<{
        agentActivityCreate?: {
          agentActivity?: {
            id: string;
          };
          success?: boolean;
        };
      }>(mutation, {
        agentSessionId,
        content: { type, body },
      });

      if (!response.agentActivityCreate?.agentActivity?.id) {
        throw new Error('No activity ID returned from Linear API');
      }

      return {
        id: response.agentActivityCreate.agentActivity.id,
      };
    } catch (err) {
      this.logger?.error(
        `Failed to create activity (session=${agentSessionId}, type=${type}): ${err instanceof Error ? err.message : err}`,
      );
      throw err;
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

    const mutation = `mutation CommentCreate(
      $issueId: String!
      $body: String!
    ) {
      commentCreate(input: {
        issueId: $issueId
        body: $body
      }) {
        comment {
          id
        }
        success
      }
    }`;

    try {
      const response = await this.executeGraphQL<{
        commentCreate?: {
          comment?: { id: string };
          success?: boolean;
        };
      }>(mutation, { issueId, body });

      if (!response.commentCreate?.comment?.id) {
        throw new Error('No comment ID returned from Linear API');
      }

      return { id: response.commentCreate.comment.id };
    } catch (err) {
      this.logger?.error(
        `Failed to create comment (issue=${issueId}): ${err instanceof Error ? err.message : err}`,
      );
      throw err;
    }
  }

  /**
   * Resolve issue labels, falling back to a GraphQL fetch when the webhook-supplied
   * labels look incomplete (fewer than MIN_LABEL_COUNT_FOR_FALLBACK). Webhooks are the
   * primary source of truth (fast, already delivered); GraphQL is only queried when
   * the webhook payload missed updates. Falls back to the webhook labels if the
   * GraphQL fetch itself fails, so a Linear API outage doesn't block routing.
   */
  async resolveLabels(issueId: string, webhookLabels: string[]): Promise<string[]> {
    if (webhookLabels.length >= MIN_LABEL_COUNT_FOR_FALLBACK) {
      this.logger?.debug(
        `Using webhook labels (${webhookLabels.length} labels) for issue ${issueId}`,
      );
      return webhookLabels;
    }

    this.logger?.log(
      `Webhook has ${webhookLabels.length} labels (threshold: ${MIN_LABEL_COUNT_FOR_FALLBACK}), ` +
        `fetching complete set via GraphQL for issue ${issueId}`,
    );

    try {
      const result = await this.fetchIssueLabels(issueId);
      this.logger?.log(
        `Resolved ${result.labels.length} labels via GraphQL (webhook had ${webhookLabels.length})`,
      );
      return result.labels;
    } catch (err) {
      this.logger?.warn(
        `GraphQL label fallback failed for issue ${issueId}, using webhook labels: ${err instanceof Error ? err.message : err}`,
      );
      return webhookLabels;
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

    const query = `
      query GetIssueAssignee($id: String!) {
        issue(id: $id) {
          id
          assignee {
            id
          }
          team {
            id
            key
          }
        }
      }
    `;

    const response = await this.executeGraphQL<{
      issue?: {
        id: string;
        assignee?: { id: string };
        team?: { id: string; key: string };
      };
    }>(query, { id: issueId });

    if (!response.issue) {
      return {};
    }

    return {
      assigneeId: response.issue.assignee?.id,
      teamId: response.issue.team?.id,
      teamKey: response.issue.team?.key,
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

    const query = `
      query GetIssueLabels($id: String!) {
        issue(id: $id) {
          id
          identifier
          labels {
            edges {
              node {
                id
                name
              }
            }
          }
        }
      }
    `;

    const response = await this.executeGraphQL<{
      issue?: {
        id: string;
        identifier: string;
        labels: {
          edges: Array<{
            node: {
              id: string;
              name: string;
            };
          }>;
        };
      };
    }>(query, { id: issueId });

    if (!response.issue) {
      return { labels: [] };
    }

    const labelNames = (response.issue.labels?.edges || [])
      .map((edge) => edge.node?.name)
      .filter((name: string | undefined): name is string => !!name && typeof name === 'string');

    return { labels: labelNames };
  }

  /**
   * Execute a GraphQL query or mutation against Linear API
   * Includes timeout, error handling, and auth
   */
  private async executeGraphQL<T>(
    query: string,
    variables?: Record<string, unknown>,
    accessToken?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Use provided access token (for OAuth flow) or stored API key
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    } else {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(this.apiEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query,
        variables,
      }),
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Linear API HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      data?: T;
      errors?: Array<{ message: string }>;
    };

    if (data.errors) {
      throw new Error(`GraphQL error: ${data.errors.map((e) => e.message).join('; ')}`);
    }

    return data.data || ({} as T);
  }
}
