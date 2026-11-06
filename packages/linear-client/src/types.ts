export type ActivityType = 'thought' | 'response' | 'error' | 'elicitation';

export interface LinearUserInfo {
  linearUserId: string;
  email?: string;
  teams: Array<{
    id: string;
    key: string;
    name: string;
  }>;
}

export interface LinearTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface ActivityCreateResponse {
  id: string;
}

export interface IssueLabelsResponse {
  labels: string[];
  identifier?: string;
}

export interface IssueContext {
  labels: string[];
  identifier?: string;
}

export interface ScannedIssue {
  id: string;
  identifier: string;
  title: string;
  labels: string[];
  teamKey?: string;
  assigneeId?: string;
  /** True when the issue is Completed or Canceled. */
  isTerminal: boolean;
}

export interface ListIssuesQuery {
  /** Exactly one of projectId or teamKey. */
  projectId?: string;
  teamKey?: string;
  label: string;
  states: string[];
  /** Page size; the oldest issues come first. */
  limit: number;
}

/**
 * Minimal logger shape the client accepts for diagnostics.
 * Matches NestJS's Logger (and console) without requiring a dependency on either.
 */
export interface LinearClientLogger {
  log(message: string): void;
  debug(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}
