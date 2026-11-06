import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { LinearGraphQLClient, ScannedIssue } from '@linear-agent/linear-client';
import type { NormalizedEvent } from '@webhook-verify/core';
import { RoutingConfigService } from '../../config/routing-config.service';
import type { ScannerScopeConfig } from '../../config/routing-schema';
import { errorMessage } from '../../common/error-message';
import { STORE_REPOSITORY } from '../../store/store.interfaces';
import type { StoreRepository } from '../../store/store.interfaces';
import { WebhookQueueService } from '../relay/webhook-queue.service';
import { LINEAR_CLIENT } from '../linear-client.token';
import { LinearRunReporter } from '../executor/linear-run-reporter';
import type {
  ScanIssueReport,
  ScanOutcome,
  ScanScopeReport,
  ScanWatchReport,
  ScannerReport,
} from './scanner-report';

const PROVIDER = 'linear';
const PAGE_SIZE = 50;

type Watch = ScannerScopeConfig['watch'][number];

const scopeName = (scope: ScannerScopeConfig): string =>
  scope.team ? `team:${scope.team}` : `project:${scope.project}`;

/**
 * Polls Linear for issues that carry a watched agent label while in the watched states, and
 * feeds each one into the same queue a webhook would use, so routing, the one-run-per-issue
 * rule and reporting stay as they are. The watched label is the mode label, so it picks the
 * skill. The run table is the claim, per issue and skill. See ADR 0010.
 */
@Injectable()
export class ScannerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScannerService.name);
  private intervalHandle?: ReturnType<typeof setInterval>;
  private scanning = false;
  private lastReport: Pick<ScannerReport, 'lastScanAt' | 'durationMs' | 'scopes'> = { scopes: [] };
  private organizationId?: string;
  // Issue -> skill this process dispatched, per scope, to enforce maxConcurrent.
  private readonly inFlight = new Map<string, Map<string, string>>();
  // Issue and skill pairs already told they ran out of attempts, so the comment is posted once.
  private readonly exhausted = new Set<string>();

  constructor(
    private readonly routingConfig: RoutingConfigService,
    private readonly queue: WebhookQueueService,
    private readonly reporter: LinearRunReporter,
    @Inject(STORE_REPOSITORY) private readonly store: StoreRepository,
    @Inject(LINEAR_CLIENT) private readonly client: LinearGraphQLClient | null,
  ) {}

  onModuleInit(): void {
    const scanner = this.routingConfig.getScanner();
    if (!scanner) return;
    if (!this.client) {
      this.logger.warn('Scanner is configured but there is no Linear credential; not scanning');
      return;
    }
    this.logger.log(`Scanner on: ${scanner.scopes.length} scope(s), every ${scanner.intervalSec}s`);
    this.intervalHandle = setInterval(() => void this.scan(), scanner.intervalSec * 1000);
    this.intervalHandle.unref?.();
    void this.scan();
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
  }

  /** What the last pass did, for the monitor. */
  getReport(): ScannerReport {
    const scanner = this.routingConfig.getScanner();
    return {
      enabled: Boolean(scanner && this.client),
      intervalSec: scanner?.intervalSec,
      ...this.lastReport,
    };
  }

  /** One pass over every scope. A failing scope or label does not stop the others. */
  async scan(): Promise<void> {
    const scanner = this.routingConfig.getScanner();
    if (!scanner || !this.client || this.scanning) return;
    this.scanning = true;
    const startedAt = Date.now();
    const scopes: ScanScopeReport[] = [];
    try {
      for (const scope of scanner.scopes) {
        const report: ScanScopeReport = {
          name: scopeName(scope),
          maxConcurrent: scope.maxConcurrent,
          inFlight: 0,
          watches: [],
        };
        scopes.push(report);
        try {
          await this.scanScope(this.client, scope, report);
        } catch (error) {
          report.error = errorMessage(error);
          this.logger.error(
            `[NEEDS_ATTENTION] Scan failed for ${scopeName(scope)}: ${errorMessage(error)}`,
          );
        }
      }
    } finally {
      this.scanning = false;
      this.lastReport = {
        lastScanAt: new Date(startedAt).toISOString(),
        durationMs: Date.now() - startedAt,
        scopes,
      };
    }
  }

  private async scanScope(
    client: LinearGraphQLClient,
    scope: ScannerScopeConfig,
    report: ScanScopeReport,
  ) {
    const name = scopeName(scope);
    let slots = scope.maxConcurrent - (await this.countInFlight(name));

    for (const watch of scope.watch) {
      const watchReport: ScanWatchReport = { label: watch.label, states: watch.states, issues: [] };
      report.watches.push(watchReport);
      const note = (issue: ScannedIssue, outcome: ScanOutcome, skill?: string, detail?: string) =>
        watchReport.issues.push({
          identifier: issue.identifier,
          title: issue.title,
          skill,
          outcome,
          detail,
        } satisfies ScanIssueReport);

      const issues = await client.listLabeledIssues({
        projectId: scope.project,
        teamKey: scope.team,
        label: watch.label,
        states: watch.states,
        limit: PAGE_SIZE,
      });

      for (const issue of issues) {
        if (issue.isTerminal) {
          note(issue, 'closed', undefined, 'completed or canceled');
          continue;
        }
        const resolved = this.resolveSkill(issue, watch);
        if ('skipped' in resolved) {
          note(issue, 'skipped', undefined, resolved.skipped);
          continue;
        }
        const { skill } = resolved;
        const verdict = await this.evaluate(client, issue, skill, scope, watch);
        if ('outcome' in verdict) {
          note(issue, verdict.outcome, skill, verdict.detail);
          continue;
        }
        if (slots <= 0) {
          note(issue, 'waiting', skill, `no free slot (${scope.maxConcurrent} at a time)`);
          continue;
        }

        await this.queue.enqueue(await this.toEvent(client, issue, skill, scope, verdict));
        this.trackInFlight(name, issue.id, skill);
        slots--;
        note(
          issue,
          'dispatched',
          skill,
          verdict.attempt > 0 ? `retry ${verdict.attempt}` : undefined,
        );
        this.logger.log(`scan.dispatched issue=${issue.identifier} skill=${skill} scope=${name}`);
      }
    }
    report.inFlight = this.inFlight.get(name)?.size ?? 0;
  }

  /**
   * The skill the watched label runs for this issue, or why it is skipped: no single repo label,
   * or a second mode label next to the watched one. The webhook path reports those on the issue;
   * a scanner that did would repeat it every tick, so it only shows them in the monitor.
   */
  private resolveSkill(issue: ScannedIssue, watch: Watch): { skill: string } | { skipped: string } {
    const repos = this.routingConfig
      .getRepositoryLabels()
      .filter((label) => issue.labels.includes(label));
    if (repos.length !== 1) {
      const skipped = repos.length === 0 ? 'no repo label' : `${repos.length} repo labels`;
      this.logger.debug(`scan.skipped issue=${issue.identifier} reason="${skipped}"`);
      return { skipped };
    }
    const modes = this.routingConfig
      .getValidModesForRepo(repos[0])
      .filter((label) => issue.labels.includes(label));
    if (modes.length !== 1 || modes[0] !== watch.label) {
      const skipped = `mode labels: ${modes.join(', ') || 'none'}`;
      this.logger.debug(`scan.skipped issue=${issue.identifier} reason="${skipped}"`);
      return { skipped };
    }
    const skill = this.routingConfig.getSkillForMode(repos[0], watch.label);
    if (!skill) return { skipped: `no skill for ${watch.label} in ${repos[0]}` };
    return { skill };
  }

  /**
   * Whether the issue may run this skill now. It may with no run yet, or only failed ones with
   * attempts left (`attempt` is the failed count). Any other history is a human's call, and the
   * verdict says which. Only runs since the issue last became a candidate count, so an issue that
   * had the watched label taken off and put back, or left the watched state and returned, is new
   * work. `enteredAt` is that moment in ms (0 when the issue has no history to reset), and keeps
   * each round's key distinct.
   */
  private async evaluate(
    client: LinearGraphQLClient,
    issue: ScannedIssue,
    skill: string,
    scope: ScannerScopeConfig,
    watch: Watch,
  ): Promise<{ attempt: number; enteredAt: number } | { outcome: ScanOutcome; detail: string }> {
    const all = await this.store.countRunsByStatus(PROVIDER, issue.id, skill);
    // A live run blocks whatever the issue's history says.
    if ((all.running ?? 0) > 0) return { outcome: 'active', detail: 'running' };
    if ((all.pending ?? 0) > 0) return { outcome: 'active', detail: 'queued' };

    let counts = all;
    let enteredAt = 0;
    if (Object.values(all).some((n) => (n ?? 0) > 0)) {
      const entered = await this.watchStartedAt(client, issue, watch.label);
      if (entered) {
        enteredAt = entered.getTime();
        counts = await this.store.countRunsByStatus(PROVIDER, issue.id, skill, entered);
      }
    }

    const { failed = 0 } = counts;
    if ((counts.needs_input ?? 0) > 0) {
      return { outcome: 'needs_input', detail: 'waiting for a reply' };
    }
    if ((counts.succeeded ?? 0) > 0) return { outcome: 'done', detail: 'run succeeded' };
    if ((counts.cancelled ?? 0) > 0) return { outcome: 'cancelled', detail: 'run was stopped' };
    if (failed < scope.maxAttempts) return { attempt: failed, enteredAt };

    const key = `${issue.id}:${skill}:${enteredAt}`;
    if (!this.exhausted.has(key)) {
      this.exhausted.add(key);
      this.logger.warn(
        `scan.exhausted issue=${issue.identifier} skill=${skill} attempts=${failed}`,
      );
      await this.reporter.needsInput(
        { issueId: issue.id },
        `The scanner stopped after ${failed} failed \`${skill}\` runs. Fix the cause, then remove the \`${watch.label}\` label and add it back to try again.`,
      );
    }
    return { outcome: 'exhausted', detail: `${failed} failed runs` };
  }

  /** A failed history lookup counts as "no reset": the scanner then errs on running nothing. */
  private async watchStartedAt(
    client: LinearGraphQLClient,
    issue: ScannedIssue,
    label: string,
  ): Promise<Date | undefined> {
    try {
      return await client.getWatchStartedAt(issue.id, label);
    } catch (error) {
      this.logger.warn(`scan.history_failed issue=${issue.identifier}: ${errorMessage(error)}`);
      return undefined;
    }
  }

  private async toEvent(
    client: LinearGraphQLClient,
    issue: ScannedIssue,
    skill: string,
    scope: ScannerScopeConfig,
    { attempt, enteredAt }: { attempt: number; enteredAt: number },
  ): Promise<NormalizedEvent> {
    this.organizationId ??= await client.getOrganizationId();
    return {
      provider: PROVIDER,
      kind: 'issue',
      webhookId: `scan-${randomUUID()}`,
      // One key per skill, round (state entry) and attempt: repeated ticks collapse, while a retry
      // after a failure, or a return to the watched state, gets a new key.
      idempotencyKey: `scan:${issue.id}:${skill}:${enteredAt}:${attempt}`,
      timestamp: Date.now(),
      organizationId: this.organizationId,
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      issueTitle: issue.title,
      ownerId: issue.assigneeId,
      routingKey: issue.teamKey,
      routingTags: issue.labels,
      isTerminal: issue.isTerminal,
      action: 'scan',
      rawPayload: { source: 'scanner', scope: scopeName(scope) },
    };
  }

  private trackInFlight(scope: string, issueId: string, skill: string): void {
    const live = this.inFlight.get(scope) ?? new Map<string, string>();
    live.set(issueId, skill);
    this.inFlight.set(scope, live);
  }

  private async countInFlight(scope: string): Promise<number> {
    const live = this.inFlight.get(scope);
    if (!live) return 0;
    for (const [issueId, skill] of [...live]) {
      if (!(await this.isStillQueuedOrRunning(issueId, skill))) live.delete(issueId);
    }
    return live.size;
  }

  // Between enqueue and the run row appearing there is a short gap with no run: count it as live.
  private async isStillQueuedOrRunning(issueId: string, skill: string): Promise<boolean> {
    const counts = await this.store.countRunsByStatus(PROVIDER, issueId, skill);
    const total = Object.values(counts).reduce<number>((sum, n) => sum + (n ?? 0), 0);
    return total === 0 || (counts.running ?? 0) + (counts.pending ?? 0) > 0;
  }
}
