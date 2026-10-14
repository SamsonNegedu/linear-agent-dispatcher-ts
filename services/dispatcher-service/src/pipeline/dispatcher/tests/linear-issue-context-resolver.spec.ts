import type { LinearGraphQLClient } from '@linear-agent/linear-client';
import type { NormalizedEvent } from '@webhook-verify/core';
import { LinearIssueContextResolver } from '../linear-issue-context-resolver';

const event = {
  provider: 'linear',
  issueId: 'issue_1',
  routingTags: ['repo-a'],
} as NormalizedEvent;

describe('LinearIssueContextResolver', () => {
  it('uses the webhook labels when no Linear client is configured', async () => {
    const resolver = new LinearIssueContextResolver(null);

    await expect(resolver.resolveIssueContext(event)).resolves.toEqual({ labels: ['repo-a'] });
  });

  it('asks Linear for the issue context when a client is configured', async () => {
    const client = {
      resolveIssueContext: jest
        .fn()
        .mockResolvedValue({ labels: ['repo-a', 'agent-implement'], identifier: 'ISSUE-1' }),
    } as unknown as jest.Mocked<LinearGraphQLClient>;
    const resolver = new LinearIssueContextResolver(client);

    await expect(resolver.resolveIssueContext(event)).resolves.toEqual({
      labels: ['repo-a', 'agent-implement'],
      identifier: 'ISSUE-1',
    });
    expect(client.resolveIssueContext).toHaveBeenCalledWith('issue_1', ['repo-a']);
  });
});
