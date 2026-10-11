import { Injectable } from '@nestjs/common';
import { DataSource, Repository, LessThan, MoreThanOrEqual } from 'typeorm';
import { randomUUID } from 'crypto';
import { RunEntity } from './run.entity';
import { ProcessedWebhookEntity } from './processed-webhook.entity';
import type { IStoreRepository, Run, EnqueueRunInput, CompleteRunInput } from '../store.interfaces';
import { DuplicatePayloadError, ActiveRunError, RecentDuplicateRunError } from '../store.errors';

@Injectable()
export class TypeORMStoreRepository implements IStoreRepository {
  private runRepository: Repository<RunEntity>;
  private webhookRepository: Repository<ProcessedWebhookEntity>;

  constructor(private dataSource: DataSource) {
    this.runRepository = this.dataSource.getRepository(RunEntity);
    this.webhookRepository = this.dataSource.getRepository(ProcessedWebhookEntity);
  }

  async enqueueRun(input: EnqueueRunInput): Promise<Run> {
    // 1. Check for duplicate payload
    const existing = await this.webhookRepository.findOne({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      throw new DuplicatePayloadError(input.idempotencyKey);
    }

    // 2. Check for active run
    const activeRun = await this.runRepository.findOne({
      where: {
        provider: input.provider,
        issueId: input.issueId,
        status: 'running',
      },
    });
    if (activeRun) {
      throw new ActiveRunError(input.issueId);
    }

    // 3. Check for recent duplicate run (within dedupeWindowMs, same domain/skill)
    const cutoff = new Date(Date.now() - input.dedupeWindowMs);
    const recentRuns = await this.runRepository.find({
      where: {
        provider: input.provider,
        issueId: input.issueId,
        domainLabel: input.domainLabel,
        skill: input.skill,
      },
      order: { startedAt: 'DESC' },
      take: 1,
    });
    if (recentRuns.length > 0 && recentRuns[0].startedAt > cutoff) {
      throw new RecentDuplicateRunError(input.issueId, input.dedupeWindowMs);
    }

    // 4. Create run in transaction
    return this.dataSource.transaction(async (manager) => {
      const run = new RunEntity();
      run.id = randomUUID();
      run.provider = input.provider;
      run.issueId = input.issueId;
      run.issueIdentifier = input.issueIdentifier;
      run.issueTitle = input.issueTitle;
      run.webhookId = input.webhookId;
      run.domainLabel = input.domainLabel;
      run.repoPath = input.repoPath;
      run.skill = input.skill;
      run.status = 'pending';
      run.startedAt = new Date();
      run.triggerSource = input.triggerSource;
      run.providerSessionId = input.providerSessionId;

      await manager.save(RunEntity, run);

      const webhook = new ProcessedWebhookEntity();
      webhook.idempotencyKey = input.idempotencyKey;
      webhook.webhookId = input.webhookId;
      await manager.save(ProcessedWebhookEntity, webhook);

      return this.entityToRun(run);
    });
  }

  async getRun(id: string): Promise<Run | null> {
    const run = await this.runRepository.findOne({ where: { id } });
    return run ? this.entityToRun(run) : null;
  }

  async getLatestRunWithSession(provider: string, issueId: string): Promise<Run | null> {
    const run = await this.runRepository.findOne({
      where: {
        provider,
        issueId,
      },
      order: { startedAt: 'DESC' },
    });
    return run && run.claudeSessionId ? this.entityToRun(run) : null;
  }

  async getLatestRunWithSessionForAgent(
    provider: string,
    issueId: string,
    sessionId: string,
  ): Promise<Run | null> {
    const run = await this.runRepository.findOne({
      where: {
        provider,
        issueId,
        claudeSessionId: sessionId,
      },
      order: { startedAt: 'DESC' },
    });
    return run ? this.entityToRun(run) : null;
  }

  async listRuns(limit: number): Promise<Run[]> {
    const runs = await this.runRepository.find({
      order: { startedAt: 'DESC' },
      take: limit,
    });
    return runs.map((r) => this.entityToRun(r));
  }

  async listRunsByStatus(status: Run['status'], limit: number): Promise<Run[]> {
    const runs = await this.runRepository.find({
      where: { status },
      order: { startedAt: 'DESC' },
      take: limit,
    });
    return runs.map((r) => this.entityToRun(r));
  }

  async hasActiveRun(provider: string, issueId: string): Promise<boolean> {
    const run = await this.runRepository.findOne({
      where: {
        provider,
        issueId,
        status: 'running',
      },
    });
    return !!run;
  }

  async markRunning(id: string, pgid?: number): Promise<void> {
    await this.runRepository.update(
      { id },
      {
        status: 'running',
        ...(pgid ? { processPgid: pgid } : {}),
      },
    );
  }

  async completeRun(id: string, out: CompleteRunInput): Promise<void> {
    await this.runRepository.update(
      { id },
      {
        status: out.status,
        claudeSessionId: out.claudeSessionId,
        exitCode: out.exitCode,
        errorSnippet: out.errorSnippet,
        finishedAt: new Date(),
      },
    );
  }

  async reconcileStaleRuns(olderThanMs: number): Promise<void> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const staleRuns = await this.runRepository.find({
      where: [
        {
          status: 'pending',
          startedAt: LessThan(cutoff),
        },
        {
          status: 'running',
          startedAt: LessThan(cutoff),
        },
      ],
    });

    for (const run of staleRuns) {
      await this.completeRun(run.id, {
        status: 'failed',
        errorSnippet: `Stale run reconciliation: no heartbeat (${Math.round((Date.now() - run.startedAt.getTime()) / 1000)}s old)`,
      });
    }
  }

  async ping(): Promise<void> {
    await this.runRepository.query('SELECT 1');
  }

  async getRunStats(
    sinceMs: number,
  ): Promise<{ lastWebhookAt: Date | null; byStatus: Record<string, number> }> {
    const cutoff = new Date(Date.now() - sinceMs);
    const runs = await this.runRepository.find({
      where: { startedAt: MoreThanOrEqual(cutoff) },
    });

    const byStatus: Record<string, number> = {
      pending: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      needs_input: 0,
    };

    let lastWebhookAt: Date | null = null;
    for (const run of runs) {
      byStatus[run.status] = (byStatus[run.status] || 0) + 1;
      if (!lastWebhookAt || run.startedAt > lastWebhookAt) {
        lastWebhookAt = run.startedAt;
      }
    }

    return { lastWebhookAt, byStatus };
  }

  private entityToRun(entity: RunEntity): Run {
    return {
      id: entity.id,
      provider: entity.provider,
      issueId: entity.issueId,
      issueIdentifier: entity.issueIdentifier,
      issueTitle: entity.issueTitle,
      webhookId: entity.webhookId,
      domainLabel: entity.domainLabel,
      repoPath: entity.repoPath,
      skill: entity.skill,
      status: entity.status,
      claudeSessionId: entity.claudeSessionId,
      exitCode: entity.exitCode,
      errorSnippet: entity.errorSnippet,
      worktreePath: entity.worktreePath,
      processPgid: entity.processPgid,
      startedAt: entity.startedAt,
      finishedAt: entity.finishedAt,
      triggerSource: entity.triggerSource,
      providerSessionId: entity.providerSessionId,
    };
  }
}
