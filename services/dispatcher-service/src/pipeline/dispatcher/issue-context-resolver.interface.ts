import type { IssueContext } from '@linear-agent/linear-client';

export interface IIssueContextResolver {
  resolveIssueContext(issueId: string, webhookLabels: string[]): Promise<IssueContext>;
}
