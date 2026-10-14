import { Injectable, Logger, Inject, OnModuleDestroy } from '@nestjs/common';
import { spawn, type ChildProcess } from 'child_process';
import type { DispatcherConfig } from '../../config/config';
import { classifyExit, type ClaudeSpawnResult } from './claude-output';
import { killProcessGroup, ProcessGroupTerminator } from './process-group';
import { openRunLog } from './run-log';
import { McpServerDiscoveryService } from './mcp-server-discovery.service';

@Injectable()
export class ClaudeAgentService implements OnModuleDestroy {
  private readonly logger = new Logger(ClaudeAgentService.name);
  // Cancel handles for runs whose Claude process is alive, keyed by run id.
  private readonly cancellers = new Map<string, () => void>();
  // Every live Claude process, so shutdown can stop them (they run in their own process groups).
  private readonly live = new Set<ChildProcess>();

  constructor(
    @Inject('DispatcherConfig') private readonly config: DispatcherConfig,
    private readonly mcpDiscovery: McpServerDiscoveryService,
  ) {}

  async spawn(
    skill: string,
    issueIdentifier: string,
    repoPath: string,
    options?: { resumeSessionId?: string; runId?: string },
  ): Promise<ClaudeSpawnResult> {
    this.logger.log(`Claude spawn: /${skill} for ${issueIdentifier} in ${repoPath}`);

    const { allowedTools = [], allowAllMcp, permissionMode } = this.config.executor;
    const allowRules = [
      ...allowedTools,
      ...(allowAllMcp ? await this.mcpDiscovery.allowRules(repoPath) : []),
    ];

    return new Promise((resolve, reject) => {
      const prompt = `/${skill} ${issueIdentifier}`;
      const args = ['-p'];

      if (options?.resumeSessionId) {
        args.push('--resume', options.resumeSessionId);
      }

      args.push(prompt);
      args.push('--output-format', 'stream-json', '--verbose');
      // Comma-joined into one value: --allowedTools is variadic and would otherwise
      // swallow any argument that follows it.
      if (allowRules.length > 0) args.push('--allowedTools', allowRules.join(','));
      if (permissionMode) args.push('--permission-mode', permissionMode);

      const env = this.buildSafeEnv();

      // No spawn() `timeout` option: it only signals the direct child. The timer below kills
      // the whole process group, which also reaches subprocesses Claude spawns.
      // `detached` makes the child its own process-group leader. Without it, kill(-pid) matches
      // no group, so the timeout and cancel signals never reach Claude or the tools it started.
      const child = spawn(this.config.executor.claudeBinPath, args, {
        cwd: repoPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
        detached: true,
      });
      this.live.add(child);

      const runLog = openRunLog(issueIdentifier, skill);
      if (runLog) this.logger.log(`Claude run log: ${runLog.file}`);
      let stdout = '';
      let stderr = '';
      let timeoutHandle: NodeJS.Timeout | null = null;
      let cancelled = false;
      const terminator = new ProcessGroupTerminator(
        child.pid,
        `/${skill} for ${issueIdentifier}`,
        this.logger,
      );

      const runId = options?.runId;
      if (runId) {
        this.cancellers.set(runId, () => {
          cancelled = true;
          if (timeoutHandle) clearTimeout(timeoutHandle);
          terminator.terminate('cancelled by user');
        });
      }

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
        runLog?.stream.write(data);
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
        runLog?.stream.write(data);
      });

      const release = () => {
        this.live.delete(child);
        if (runId) this.cancellers.delete(runId);
        if (timeoutHandle) clearTimeout(timeoutHandle);
        terminator.clear();
      };

      child.on('error', (error) => {
        release();
        reject(error);
      });

      child.on('close', (code) => {
        release();
        runLog?.stream.end();
        const result = classifyExit({ code, stdout, stderr, cancelled });
        this.logOutcome(result, skill, issueIdentifier);
        resolve(result);
      });

      if (this.config.executor.timeout) {
        // Escalates to SIGKILL if SIGTERM is ignored; otherwise a hung process outlives its timeout.
        timeoutHandle = setTimeout(
          () => terminator.terminate('exceeded timeout'),
          this.config.executor.timeout,
        );
      }
    });
  }

  private logOutcome(result: ClaudeSpawnResult, skill: string, issueIdentifier: string): void {
    switch (result.status) {
      case 'cancelled':
        this.logger.warn(`Claude spawn cancelled: /${skill} for ${issueIdentifier}`);
        break;
      case 'needs_input':
        this.logger.warn(`Claude spawn stopped to ask: /${skill} (sessionId: ${result.sessionId})`);
        break;
      case 'succeeded':
        this.logger.log(
          `Claude spawn succeeded: /${skill} (sessionId: ${result.sessionId}, cost: $${result.totalCostUSD})`,
        );
        break;
      case 'failed':
        this.logger.error(
          `Claude spawn failed: /${skill} (exit code ${result.exitCode})`,
          result.errorSnippet || 'No output',
        );
        break;
    }
  }

  /** A detached Claude process outlives the dispatcher, so stop each one when the server stops. */
  onModuleDestroy(): void {
    for (const child of this.live) killProcessGroup(child.pid, 'SIGTERM', this.logger);
  }

  /** Stops the live Claude process for a run. False when the run has no live process. */
  cancel(runId: string): boolean {
    const cancel = this.cancellers.get(runId);
    if (!cancel) return false;
    this.cancellers.delete(runId);
    cancel();
    return true;
  }

  private buildSafeEnv(): NodeJS.ProcessEnv {
    const allowed = this.config.executor.allowedEnvVars;
    const env: NodeJS.ProcessEnv = {};

    for (const key of allowed) {
      const value = process.env[key];
      if (value !== undefined) {
        env[key] = value;
      }
    }

    return env;
  }
}
