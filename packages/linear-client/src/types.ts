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
