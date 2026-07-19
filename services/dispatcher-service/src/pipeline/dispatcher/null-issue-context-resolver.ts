import type { IssueContext } from '@linear-agent/linear-client';
import type { IIssueContextResolver } from './issue-context-resolver.interface';

/**
 * No-op resolver used when LINEAR_API_KEY isn't configured. Returns the
 * webhook-supplied labels unchanged rather than forcing callers to branch
 * on whether a Linear client exists.
 */
export class NullIssueContextResolver implements IIssueContextResolver {
  resolveIssueContext(_issueId: string, webhookLabels: string[]): Promise<IssueContext> {
    return Promise.resolve({ labels: webhookLabels });
  }
}
