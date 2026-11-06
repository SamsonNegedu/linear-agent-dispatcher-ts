import type {
  LinearGraphQLClient,
  ListIssuesQuery,
  ScannedIssue,
} from '@linear-agent/linear-client';
import { ScannerService } from '../scanner.service';
import type { RoutingConfigService } from '../../../config/routing-config.service';
import type { ScannerConfig } from '../../../config/routing-schema';
import type { StoreRepository } from '../../../store/store.interfaces';
import type { WebhookQueueService } from '../../relay/webhook-queue.service';
import type { LinearRunReporter } from '../../executor/linear-run-reporter';

const issue = (id: string, overrides: Partial<ScannedIssue> = {}): ScannedIssue => ({
  id,
  identifier: `ENG-${id}`,
  title: `Issue ${id}`,
  labels: ['backend', 'agent-implement'],
  teamKey: 'ENG',
  isTerminal: false,
  ...overrides,
});

type Scope = ScannerConfig['scopes'][number];

const projectScope = (overrides: Partial<Scope> = {}): Scope => ({
  project: 'proj_1',
  watch: [{ label: 'agent-implement', states: ['Todo'] }],
  maxConcurrent: 2,
  maxAttempts: 3,
  ...overrides,
});

const config = (...scopes: Scope[]): ScannerConfig => ({
  enabled: true,
  intervalSec: 60,
  scopes,
});

describe('ScannerService', () => {
  // What Linear returns, by the label that was asked for.
  let issuesByLabel: Record<string, ScannedIssue[]>;
  // Runs by `<issueId>:<skill>`, and the same counted only since the issue last entered its state.
  let runCounts: Record<string, Partial<Record<string, number>>>;
  let runCountsSince: Record<string, Partial<Record<string, number>>>;
  let stateEnteredAt: Date | undefined;
  let queue: jest.Mocked<Pick<WebhookQueueService, 'enqueue'>>;
  let reporter: jest.Mocked<Pick<LinearRunReporter, 'needsInput'>>;
  let client: jest.Mocked<
    Pick<LinearGraphQLClient, 'listLabeledIssues' | 'getOrganizationId' | 'getWatchStartedAt'>
  >;

  const build = (scanner: ScannerConfig | null = config(projectScope())) => {
    const store = {
      countRunsByStatus: jest.fn((_provider: string, id: string, skill?: string, since?: Date) => {
        const key = `${id}:${skill}`;
        return Promise.resolve(
          (since ? (runCountsSince[key] ?? runCounts[key]) : runCounts[key]) ?? {},
        );
      }),
    } as unknown as StoreRepository;
    const routing = {
      getScanner: () => scanner ?? undefined,
      getRepositoryLabels: () => ['backend'],
      getValidModesForRepo: () => ['agent-implement', 'agent-triage'],
      getSkillForMode: (_repo: string, label: string) => label.replace('agent-', ''),
    } as unknown as RoutingConfigService;
    return new ScannerService(
      routing,
      queue as unknown as WebhookQueueService,
      reporter as unknown as LinearRunReporter,
      store,
      client as unknown as LinearGraphQLClient,
    );
  };

  beforeEach(() => {
    issuesByLabel = {};
    runCounts = {};
    runCountsSince = {};
    stateEnteredAt = undefined;
    queue = { enqueue: jest.fn().mockResolvedValue(undefined) };
    reporter = { needsInput: jest.fn().mockResolvedValue(undefined) };
    client = {
      listLabeledIssues: jest.fn((query: ListIssuesQuery) =>
        Promise.resolve(issuesByLabel[query.label] ?? []),
      ),
      getOrganizationId: jest.fn().mockResolvedValue('org_1'),
      getWatchStartedAt: jest.fn((_issueId: string, _label: string) =>
        Promise.resolve(stateEnteredAt),
      ),
    };
  });

  it('enqueues a labelled issue as a scan event carrying its labels', async () => {
    issuesByLabel['agent-implement'] = [issue('1')];

    await build().scan();

    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'linear',
        action: 'scan',
        organizationId: 'org_1',
        issueId: '1',
        issueIdentifier: 'ENG-1',
        routingTags: ['backend', 'agent-implement'],
        idempotencyKey: 'scan:1:implement:0:0',
      }),
    );
  });

  it('asks Linear for the scope, label and states of each watch', async () => {
    const scanner = config(
      projectScope({
        watch: [
          { label: 'agent-implement', states: ['Todo'] },
          { label: 'agent-triage', states: ['Triage', 'Backlog'] },
        ],
      }),
    );

    await build(scanner).scan();

    expect(client.listLabeledIssues).toHaveBeenCalledWith({
      projectId: 'proj_1',
      teamKey: undefined,
      label: 'agent-implement',
      states: ['Todo'],
      limit: 50,
    });
    expect(client.listLabeledIssues).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'agent-triage', states: ['Triage', 'Backlog'] }),
    );
  });

  it('scans a whole team, so a triage issue with no project is found', async () => {
    issuesByLabel['agent-triage'] = [issue('1', { labels: ['backend', 'agent-triage'] })];
    const scanner = config({
      team: 'DLAI',
      watch: [{ label: 'agent-triage', states: ['Triage'] }],
      maxConcurrent: 1,
      maxAttempts: 3,
    });

    await build(scanner).scan();

    expect(client.listLabeledIssues).toHaveBeenCalledWith(
      expect.objectContaining({ teamKey: 'DLAI', projectId: undefined }),
    );
    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'scan:1:triage:0:0' }),
    );
  });

  it('runs each watched label as its own skill', async () => {
    issuesByLabel['agent-implement'] = [issue('1')];
    issuesByLabel['agent-triage'] = [issue('2', { labels: ['backend', 'agent-triage'] })];
    const scanner = config(
      projectScope({
        watch: [
          { label: 'agent-triage', states: ['Triage'] },
          { label: 'agent-implement', states: ['Todo'] },
        ],
      }),
    );

    await build(scanner).scan();

    const keys = queue.enqueue.mock.calls.map(([event]) => event.idempotencyKey);
    expect(keys).toEqual(['scan:2:triage:0:0', 'scan:1:implement:0:0']);
  });

  it("does not let a finished triage run block the issue's implement run", async () => {
    issuesByLabel['agent-implement'] = [issue('1')];
    runCounts['1:triage'] = { succeeded: 1 };

    await build().scan();

    expect(queue.enqueue).toHaveBeenCalledTimes(1);
  });

  it.each(['running', 'pending', 'succeeded', 'needs_input', 'cancelled'])(
    'leaves an issue alone when it has a %s run of that skill',
    async (status) => {
      issuesByLabel['agent-implement'] = [issue('1')];
      runCounts['1:implement'] = { [status]: 1 };

      await build().scan();

      expect(queue.enqueue).not.toHaveBeenCalled();
    },
  );

  describe('an issue that has the watched label put back, or returns to the watched state', () => {
    const returnedAt = new Date('2026-11-06T22:00:00.000Z');

    it('runs again, once the earlier runs predate its return', async () => {
      issuesByLabel['agent-implement'] = [issue('1')];
      runCounts['1:implement'] = { succeeded: 1 };
      runCountsSince['1:implement'] = {};
      stateEnteredAt = returnedAt;

      await build().scan();

      expect(queue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: `scan:1:implement:${returnedAt.getTime()}:0`,
        }),
      );
    });

    it('leaves it alone while its last run is newer than its return', async () => {
      issuesByLabel['agent-implement'] = [issue('1')];
      runCounts['1:implement'] = { succeeded: 1 };
      stateEnteredAt = returnedAt; // counted since: still the succeeded run

      await build().scan();

      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('starts the failed-attempt count over for the new round', async () => {
      issuesByLabel['agent-implement'] = [issue('1')];
      runCounts['1:implement'] = { failed: 3 };
      runCountsSince['1:implement'] = { failed: 1 };
      stateEnteredAt = returnedAt;

      await build().scan();

      expect(queue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: `scan:1:implement:${returnedAt.getTime()}:1`,
        }),
      );
    });

    it('never starts a second run while one is live, whatever the history says', async () => {
      issuesByLabel['agent-implement'] = [issue('1')];
      runCounts['1:implement'] = { running: 1 };
      runCountsSince['1:implement'] = {};
      stateEnteredAt = returnedAt;

      await build().scan();

      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('runs nothing when the history lookup fails', async () => {
      issuesByLabel['agent-implement'] = [issue('1')];
      runCounts['1:implement'] = { succeeded: 1 };
      client.getWatchStartedAt.mockRejectedValueOnce(new Error('boom'));

      await build().scan();

      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('does not look up history for an issue with no runs', async () => {
      issuesByLabel['agent-implement'] = [issue('1')];

      await build().scan();

      expect(client.getWatchStartedAt).not.toHaveBeenCalled();
    });
  });

  it('retries after a failed run with a new idempotency key', async () => {
    issuesByLabel['agent-implement'] = [issue('1')];
    runCounts['1:implement'] = { failed: 2 };

    await build().scan();

    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'scan:1:implement:0:2' }),
    );
  });

  it('stops at maxAttempts and tells the issue once', async () => {
    issuesByLabel['agent-implement'] = [issue('1')];
    runCounts['1:implement'] = { failed: 3 };
    const service = build();

    await service.scan();
    await service.scan();

    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(reporter.needsInput).toHaveBeenCalledTimes(1);
    expect(reporter.needsInput).toHaveBeenCalledWith(
      { issueId: '1' },
      expect.stringContaining('remove the `agent-implement` label and add it back'),
    );
  });

  it('skips completed and canceled issues', async () => {
    issuesByLabel['agent-implement'] = [issue('1', { isTerminal: true })];

    await build().scan();

    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it.each([
    ['no repo label', ['agent-implement']],
    ['a second mode label', ['backend', 'agent-implement', 'agent-triage']],
  ])('skips an issue that would not route: %s', async (_name, labels) => {
    issuesByLabel['agent-implement'] = [issue('1', { labels })];

    await build().scan();

    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('dispatches at most maxConcurrent issues, and frees a slot once a run ends', async () => {
    issuesByLabel['agent-implement'] = [issue('1'), issue('2'), issue('3')];
    const service = build(config(projectScope({ maxConcurrent: 2 })));

    await service.scan();
    expect(queue.enqueue).toHaveBeenCalledTimes(2);

    // Both now have live runs: no free slot, so the third waits.
    runCounts['1:implement'] = { running: 1 };
    runCounts['2:implement'] = { running: 1 };
    await service.scan();
    expect(queue.enqueue).toHaveBeenCalledTimes(2);

    // One finishes: its slot goes to the third issue.
    runCounts['1:implement'] = { succeeded: 1 };
    await service.scan();
    expect(queue.enqueue).toHaveBeenCalledTimes(3);
    expect(queue.enqueue).toHaveBeenLastCalledWith(expect.objectContaining({ issueId: '3' }));
  });

  describe('report', () => {
    const outcomes = async (service: ScannerService) =>
      Object.fromEntries(
        service
          .getReport()
          .scopes.flatMap((scope) => scope.watches.flatMap((watch) => watch.issues))
          .map((entry) => [entry.identifier, [entry.outcome, entry.detail]]),
      );

    it('says what happened to each issue, and why', async () => {
      issuesByLabel['agent-implement'] = [
        issue('1'),
        issue('2'),
        issue('3', { labels: ['agent-implement'] }),
        issue('4', { isTerminal: true }),
        issue('5'),
        issue('6'),
        issue('7'),
      ];
      runCounts['2:implement'] = { running: 1 };
      runCounts['5:implement'] = { needs_input: 1 };
      runCounts['6:implement'] = { failed: 3 };
      const service = build(config(projectScope({ maxConcurrent: 1 })));

      await service.scan();

      expect(await outcomes(service)).toEqual({
        'ENG-1': ['dispatched', undefined],
        'ENG-2': ['active', 'running'],
        'ENG-3': ['skipped', 'no repo label'],
        'ENG-4': ['closed', 'completed or canceled'],
        'ENG-5': ['needs_input', 'waiting for a reply'],
        'ENG-6': ['exhausted', '3 failed runs'],
        'ENG-7': ['waiting', 'no free slot (1 at a time)'],
      });
    });

    it('records when the pass ran, its scopes, and the slots in use', async () => {
      issuesByLabel['agent-implement'] = [issue('1')];
      const service = build();

      await service.scan();

      const report = service.getReport();
      expect(report).toMatchObject({ enabled: true, intervalSec: 60 });
      expect(report.lastScanAt).toEqual(expect.any(String));
      expect(report.durationMs).toEqual(expect.any(Number));
      expect(report.scopes).toMatchObject([
        { name: 'project:proj_1', maxConcurrent: 2, inFlight: 1 },
      ]);
    });

    it('keeps a failing scope in the report with its error', async () => {
      client.listLabeledIssues.mockRejectedValueOnce(new Error('boom'));
      const service = build();

      await service.scan();

      expect(service.getReport().scopes).toMatchObject([{ name: 'project:proj_1', error: 'boom' }]);
    });

    it('reports disabled before any pass when the scanner is off', () => {
      expect(build(null).getReport()).toEqual({ enabled: false, scopes: [] });
    });
  });

  it('does nothing when the scanner is not configured', async () => {
    await build(null).scan();

    expect(client.listLabeledIssues).not.toHaveBeenCalled();
  });

  it('keeps scanning other scopes when one fails', async () => {
    issuesByLabel['agent-implement'] = [issue('1')];
    client.listLabeledIssues.mockRejectedValueOnce(new Error('boom'));

    await build(
      config(projectScope({ project: 'proj_1' }), projectScope({ project: 'proj_2' })),
    ).scan();

    expect(queue.enqueue).toHaveBeenCalledTimes(1);
  });
});
