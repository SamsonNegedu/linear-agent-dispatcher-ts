import type { LinearGraphQLClient } from '@linear-agent/linear-client';
import type { NormalizedEvent } from '@webhook-verify/core';
import { LinearRoutingResolver } from '../linear-routing.resolver';

const makeEvent = (overrides: Partial<NormalizedEvent> = {}): NormalizedEvent =>
  ({
    provider: 'linear',
    kind: 'agent_session',
    webhookId: 'wh_1',
    issueId: 'issue_1',
    routingTags: [],
    ...overrides,
  }) as NormalizedEvent;

describe('LinearRoutingResolver', () => {
  let client: jest.Mocked<LinearGraphQLClient>;

  beforeEach(() => {
    client = { fetchIssueAssignee: jest.fn() } as unknown as jest.Mocked<LinearGraphQLClient>;
  });

  it('fetches the assignee and team for an agent session with no owner', async () => {
    client.fetchIssueAssignee.mockResolvedValue({ assigneeId: 'user_1', teamKey: 'ENG' });

    const resolved = await new LinearRoutingResolver(client).resolveMissingRouting(makeEvent());

    expect(resolved).toEqual({ ownerId: 'user_1', routingKey: 'ENG' });
    expect(client.fetchIssueAssignee).toHaveBeenCalledWith('issue_1');
  });

  it('backfills nothing for plain issue events or when the owner is already known', async () => {
    const resolver = new LinearRoutingResolver(client);

    expect(await resolver.resolveMissingRouting(makeEvent({ kind: 'issue' }))).toEqual({});
    expect(await resolver.resolveMissingRouting(makeEvent({ ownerId: 'user_1' }))).toEqual({});
    expect(client.fetchIssueAssignee).not.toHaveBeenCalled();
  });

  it('backfills nothing when the Linear fetch fails', async () => {
    client.fetchIssueAssignee.mockRejectedValue(new Error('boom'));

    expect(await new LinearRoutingResolver(client).resolveMissingRouting(makeEvent())).toEqual({});
  });

  it('backfills nothing when no Linear client is configured', async () => {
    expect(await new LinearRoutingResolver(null).resolveMissingRouting(makeEvent())).toEqual({});
  });
});
