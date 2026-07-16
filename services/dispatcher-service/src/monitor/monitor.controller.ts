import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Query,
} from '@nestjs/common';
import type { IStoreRepository } from '../store/store.interfaces';
import { ReposConfigService } from '../config/repos-config.service';
import type { Run } from '../store/store.interfaces';

interface RepoStatus {
  repoPath: string;
  domainLabel: string;
  description?: string;
  modes: Array<{ label: string; skill: string }>;
  runningCount: number;
  currentRuns: Array<{ issueIdentifier: string; issueTitle?: string }>;
}

interface MonitorSummary {
  counts: {
    pending: number;
    running: number;
    succeeded: number;
    failed: number;
  };
  repos: RepoStatus[];
}

@Controller('monitor')
export class MonitorController {
  private readonly logger = new Logger(MonitorController.name);

  constructor(
    @Inject('IStoreRepository') private readonly store: IStoreRepository,
    private readonly reposConfig: ReposConfigService,
  ) {}

  @Get('summary')
  @HttpCode(200)
  async summary(): Promise<MonitorSummary> {
    try {
      const stats = await this.store.getRunStats(24 * 60 * 60 * 1000);
      const runningRuns = await this.store.listRunsByStatus('running', 1000);

      // Build repo status map
      const repoMap = new Map<string, RepoStatus>();
      for (const repo of this.reposConfig.getAllRepositories()) {
        repoMap.set(repo.path, {
          repoPath: repo.path,
          domainLabel: repo.label,
          description: repo.description,
          modes: repo.modes ? Object.entries(repo.modes).map(([label, skill]) => ({ label, skill })) : [],
          runningCount: 0,
          currentRuns: [],
        });
      }

      // Populate running runs
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

      const byStatus = stats.byStatus || {};
      return {
        counts: {
          pending: (byStatus as Record<string, number>)['pending'] || 0,
          running: (byStatus as Record<string, number>)['running'] || 0,
          succeeded: (byStatus as Record<string, number>)['succeeded'] || 0,
          failed: (byStatus as Record<string, number>)['failed'] || 0,
        },
        repos: Array.from(repoMap.values()),
      };
    } catch (err) {
      this.logger.error('Summary request failed:', err);
      throw new HttpException(
        { status: 'error', error: err instanceof Error ? err.message : 'Unknown error' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('runs')
  @HttpCode(200)
  async runs(
    @Query('status') status?: 'running' | 'pending' | 'succeeded' | 'failed',
    @Query('limit') limitParam?: string,
  ): Promise<Run[]> {
    try {
      const limit = limitParam ? Math.min(parseInt(limitParam, 10), 1000) : 50;
      const validStatuses: Run['status'][] = ['running', 'pending', 'succeeded', 'failed'];

      if (status && !validStatuses.includes(status)) {
        throw new HttpException(
          { error: 'Invalid status parameter' },
          HttpStatus.BAD_REQUEST,
        );
      }

      if (!status) {
        return await this.store.listRuns(limit);
      }

      return await this.store.listRunsByStatus(status, limit);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error('Runs request failed:', err);
      throw new HttpException(
        { status: 'error', error: err instanceof Error ? err.message : 'Unknown error' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
