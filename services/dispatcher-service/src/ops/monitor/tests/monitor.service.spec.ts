import { Test } from '@nestjs/testing';
import { MonitorService } from '../monitor.service';
import { MonitorModule } from '../monitor.module';
import { FakeStoreModule } from '../../../test-utils/fake-store.module';
import { StoreModule } from '../../../store/store.module';
import { RoutingConfigService } from '../../../config/routing-config.service';
import type { IStoreRepository, Run } from '../../../store/store.interfaces';

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run_1',
    provider: 'linear',
    issueId: 'issue_1',
    issueIdentifier: 'ISSUE-1',
    webhookId: 'wh_1',
    domainLabel: 'repo-a',
    repoPath: '/repos/repo-a',
    skill: 'implement',
    status: 'running',
    startedAt: new Date(),
    triggerSource: 'webhook',
    ...overrides,
  };
}

describe('MonitorService', () => {
  let store: jest.Mocked<IStoreRepository>;
  let routingConfig: jest.Mocked<RoutingConfigService>;
  let service: MonitorService;

  beforeEach(async () => {
    store = {
      getRunStats: jest.fn(),
      listRunsByStatus: jest.fn(),
      listRuns: jest.fn(),
    } as unknown as jest.Mocked<IStoreRepository>;
    routingConfig = {
      getAllRepositories: jest.fn().mockReturnValue([
        {
          label: 'repo-a',
          path: '/repos/repo-a',
          issueLabelToSkill: { 'agent-implement': 'implement' },
        },
        { label: 'repo-b', path: '/repos/repo-b' },
      ]),
    } as unknown as jest.Mocked<RoutingConfigService>;

    const module = await Test.createTestingModule({ imports: [MonitorModule] })
      .overrideModule(StoreModule)
      .useModule(FakeStoreModule)
      .overrideProvider('IStoreRepository')
      .useValue(store)
      .overrideProvider(RoutingConfigService)
      .useValue(routingConfig)
      .compile();

    service = module.get(MonitorService);
  });

  describe('getSummary', () => {
    it('defaults every status count to 0 when the store reports none', async () => {
      store.getRunStats.mockResolvedValue({ lastWebhookAt: null, byStatus: {} as never });
      store.listRunsByStatus.mockResolvedValue([]);

      const summary = await service.getSummary();

      expect(summary.counts).toEqual({
        pending: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        needs_input: 0,
      });
    });

    it('lists every configured repo, even ones with no running runs', async () => {
      store.getRunStats.mockResolvedValue({
        lastWebhookAt: new Date(),
        byStatus: { pending: 1, running: 2, succeeded: 5, failed: 1, needs_input: 3 },
      });
      store.listRunsByStatus.mockResolvedValue([]);

      const summary = await service.getSummary();

      expect(summary.repos).toEqual([
        expect.objectContaining({ repoPath: '/repos/repo-a', runningCount: 0, currentRuns: [] }),
        expect.objectContaining({ repoPath: '/repos/repo-b', runningCount: 0, currentRuns: [] }),
      ]);
      expect(summary.counts).toEqual({
        pending: 1,
        running: 2,
        succeeded: 5,
        failed: 1,
        needs_input: 3,
      });
    });

    it('buckets running runs under the repo matching their repoPath', async () => {
      store.getRunStats.mockResolvedValue({ lastWebhookAt: null, byStatus: {} as never });
      store.listRunsByStatus.mockResolvedValue([
        makeRun({ repoPath: '/repos/repo-a', issueIdentifier: 'ISSUE-1' }),
        makeRun({ repoPath: '/repos/repo-a', issueIdentifier: 'ISSUE-2' }),
        makeRun({ repoPath: '/repos/repo-b', issueIdentifier: 'ISSUE-3' }),
      ]);

      const summary = await service.getSummary();

      const repoA = summary.repos.find((r) => r.repoPath === '/repos/repo-a');
      const repoB = summary.repos.find((r) => r.repoPath === '/repos/repo-b');
      expect(repoA?.runningCount).toBe(2);
      expect(repoA?.currentRuns.map((r) => r.issueIdentifier)).toEqual(['ISSUE-1', 'ISSUE-2']);
      expect(repoB?.runningCount).toBe(1);
    });

    it('silently drops running runs whose repoPath matches no configured repo', async () => {
      store.getRunStats.mockResolvedValue({ lastWebhookAt: null, byStatus: {} as never });
      store.listRunsByStatus.mockResolvedValue([makeRun({ repoPath: '/repos/unconfigured' })]);

      const summary = await service.getSummary();

      expect(summary.repos.every((r) => r.runningCount === 0)).toBe(true);
    });
  });

  describe('getRuns', () => {
    it('lists all runs when no status filter is given', async () => {
      store.listRuns.mockResolvedValue([makeRun()]);

      await service.getRuns(undefined, 50);

      expect(store.listRuns).toHaveBeenCalledWith(50);
      expect(store.listRunsByStatus).not.toHaveBeenCalled();
    });

    it('filters by status when one is given', async () => {
      store.listRunsByStatus.mockResolvedValue([makeRun({ status: 'failed' })]);

      await service.getRuns('failed', 20);

      expect(store.listRunsByStatus).toHaveBeenCalledWith('failed', 20);
    });
  });
});
