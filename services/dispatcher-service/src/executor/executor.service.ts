import { Injectable, Logger, Inject } from '@nestjs/common';
import { spawn } from 'child_process';
import { IStoreRepository } from '../store/store.interfaces';
import { VerifiedEvent } from '@webhook-verify/core';
import { DispatcherConfig } from '../config/config';
import { ActivityNotifierService } from './activity-notifier.service';

export interface ExecutionResult {
  runId: string;
  status: 'succeeded' | 'failed';
  exitCode?: number;
  errorSnippet?: string;
  claudeSessionId?: string;
}

interface ClaudeOutput {
  sessionId?: string;
  result?: string;
  totalCostUSD?: number;
  stopReason?: string;
  error?: string;
}

@Injectable()
export class ExecutorService {
  private readonly logger = new Logger(ExecutorService.name);

  constructor(
    @Inject('IStoreRepository') private readonly store: IStoreRepository,
    @Inject('DispatcherConfig') private readonly config: DispatcherConfig,
    private readonly activityNotifier: ActivityNotifierService,
  ) {}

  async executeRun(runId: string, event: VerifiedEvent): Promise<void> {
    const run = await this.store.getRun(runId);
    if (!run) {
      this.logger.error(`Run not found: ${runId}`);
      return;
    }

    try {
      // Mark run as running
      await this.store.markRunning(runId);
      this.logger.log(`Executing run: ${runId} in repo: ${run.repoPath}`);

      // Post start activity if session available
      if (run.providerSessionId) {
        await this.activityNotifier.postStart(
          run.providerSessionId,
          run.issueIdentifier,
          run.domainLabel,
          run.skill,
          runId,
        );
      }

      const result = await this.spawnClaudeHandler(
        run.skill,
        runId,
        event,
        run.repoPath,
        run.claudeSessionId,
      );

      // Mark complete
      await this.store.completeRun(runId, {
        status: result.status,
        exitCode: result.exitCode,
        errorSnippet: result.errorSnippet,
        claudeSessionId: result.claudeSessionId,
      });

      this.logger.log(`Run completed: ${runId} (${result.status})`);

      // Post completion activity
      if (run.providerSessionId) {
        if (result.status === 'succeeded') {
          await this.activityNotifier.postSuccess(
            run.providerSessionId,
            `Claude skill \`/${run.skill}\` completed successfully in \`${run.domainLabel}\` repo`,
          );
        } else {
          await this.activityNotifier.postError(
            run.providerSessionId,
            result.errorSnippet || `Run failed with exit code ${result.exitCode}`,
          );
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Run failed: ${runId} - ${errorMsg}`);
      await this.store.completeRun(runId, {
        status: 'failed',
        errorSnippet: errorMsg,
      });

      // Post error activity
      if (run.providerSessionId) {
        await this.activityNotifier.postError(run.providerSessionId, (err as Error).message);
      }
    }
  }

  private async spawnClaudeHandler(
    skill: string,
    runId: string,
    event: VerifiedEvent,
    repoPath: string,
    previousSessionId?: string,
  ): Promise<ExecutionResult> {
    return new Promise((resolve, reject) => {
      // claude reads available skills from .claude/settings.json in the repo
      const prompt = `/${skill} ${event.issueIdentifier}`;

      const args = ['-p'];

      // Add resume flag if available from previous session
      if (previousSessionId) {
        args.push('--resume', previousSessionId);
      }

      // Add prompt
      args.push(prompt);

      // Add output format for JSON parsing
      args.push('--output-format', 'json');

      const env = this.buildSafeEnv();

      const child = spawn(this.config.executor.claudeBinPath, args, {
        cwd: repoPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
        timeout: this.config.executor.timeout || 30 * 60 * 1000,
      });

      let stdout = '';
      let stderr = '';
      let timeoutHandle: NodeJS.Timeout | null = null;

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('error', (err) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        reject(err);
      });

      child.on('close', (code) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);

        let sessionId: string | undefined;
        let errorSnippet: string | undefined;

        // Parse JSON output
        if (stdout) {
          try {
            const output = JSON.parse(stdout) as ClaudeOutput;
            sessionId = output.sessionId;
            errorSnippet = output.error;
          } catch {
            // Not valid JSON, use stderr
          }
        }

        if (!errorSnippet && stderr) {
          errorSnippet = stderr.slice(-500); // Last 500 chars
        }

        if (code === 0) {
          resolve({
            runId,
            status: 'succeeded',
            exitCode: code ?? undefined,
            claudeSessionId: sessionId,
          });
        } else {
          resolve({
            runId,
            status: 'failed',
            exitCode: code ?? undefined,
            errorSnippet,
            claudeSessionId: sessionId,
          });
        }
      });

      // Enforce timeout by killing process group
      if (this.config.executor.timeout) {
        timeoutHandle = setTimeout(() => {
          if (child.pid) {
            process.kill(-child.pid, 'SIGTERM'); // Kill process group
          }
        }, this.config.executor.timeout);
      }
    });
  }

  private buildSafeEnv(): NodeJS.ProcessEnv {
    const allowed = this.config.executor.allowedEnvVars;
    const env: NodeJS.ProcessEnv = {};

    // Only pass whitelisted environment variables to subprocess
    for (const key of allowed) {
      const value = process.env[key];
      if (value !== undefined) {
        env[key] = value;
      }
    }

    return env;
  }
}
