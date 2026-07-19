import { Inject, Injectable } from '@nestjs/common';
import type { IStoreRepository, Run } from '../../store/store.interfaces';
import { RoutingConfigService } from '../../config/routing-config.service';

interface RepoStatus {
  repoPath: string;
  domainLabel: string;
  description?: string;
  issueLabelToSkill: Array<{ label: string; skill: string }>;
  runningCount: number;
  currentRuns: Array<{ issueIdentifier: string; issueTitle?: string }>;
}

export interface MonitorSummary {
  counts: {
    pending: number;
    running: number;
    succeeded: number;
    failed: number;
  };
  repos: RepoStatus[];
}

@Injectable()
export class MonitorService {
  constructor(
    @Inject('IStoreRepository') private readonly store: IStoreRepository,
    private readonly routingConfig: RoutingConfigService,
  ) {}

  async getSummary(): Promise<MonitorSummary> {
    const stats = await this.store.getRunStats(24 * 60 * 60 * 1000);
    const runningRuns = await this.store.listRunsByStatus('running', 1000);

    const repoMap = new Map<string, RepoStatus>();
    for (const repo of this.routingConfig.getAllRepositories()) {
      repoMap.set(repo.path, {
        repoPath: repo.path,
        domainLabel: repo.label,
        description: repo.description,
        issueLabelToSkill: repo.issueLabelToSkill
          ? Object.entries(repo.issueLabelToSkill).map(([label, skill]) => ({ label, skill }))
          : [],
        runningCount: 0,
        currentRuns: [],
      });
    }

    for (const run of runningRuns) {
      const repoStatus = repoMap.get(run.repoPath);
      if (repoStatus) {
        repoStatus.runningCount++;
        repoStatus.currentRuns.push({
          issueIdentifier: run.issueIdentifier,
          issueTitle: run.issueTitle,
        });
      }
    }

    const byStatus = (stats.byStatus || {}) as Record<string, number>;
    return {
      counts: {
        pending: byStatus['pending'] || 0,
        running: byStatus['running'] || 0,
        succeeded: byStatus['succeeded'] || 0,
        failed: byStatus['failed'] || 0,
      },
      repos: Array.from(repoMap.values()),
    };
  }

  async getRuns(status: Run['status'] | undefined, limit: number): Promise<Run[]> {
    if (!status) {
      return this.store.listRuns(limit);
    }
    return this.store.listRunsByStatus(status, limit);
  }
}
