import { Injectable, Logger, Inject } from '@nestjs/common';
import { spawn } from 'child_process';
import type { DispatcherConfig } from '../config/config';

export interface ClaudeSpawnResult {
  status: 'succeeded' | 'failed';
  exitCode?: number;
  errorSnippet?: string;
  sessionId?: string;
}

interface ClaudeOutput {
  sessionId?: string;
  result?: string;
  totalCostUSD?: number;
  stopReason?: string;
  error?: string;
}

@Injectable()
export class ClaudeAgentService {
  private readonly logger = new Logger(ClaudeAgentService.name);

  constructor(@Inject('DispatcherConfig') private readonly config: DispatcherConfig) {}

  async spawn(
    skill: string,
    issueIdentifier: string,
    repoPath: string,
    options?: { resumeSessionId?: string },
  ): Promise<ClaudeSpawnResult> {
    this.logger.log(`Claude spawn: /${skill} for ${issueIdentifier} in ${repoPath}`);

    return new Promise((resolve, reject) => {
      const prompt = `/${skill} ${issueIdentifier}`;
      const args = ['-p'];

      if (options?.resumeSessionId) {
        args.push('--resume', options.resumeSessionId);
      }

      args.push(prompt);
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

      child.on('error', (error) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        reject(error);
      });

      child.on('close', (code) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);

        let sessionId: string | undefined;
        let errorSnippet: string | undefined;

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
          errorSnippet = stderr.slice(-500);
        }

        if (code === 0) {
          this.logger.log(`Claude spawn succeeded: /${skill} (sessionId: ${sessionId})`);
          resolve({
            status: 'succeeded',
            exitCode: code ?? undefined,
            sessionId,
          });
        } else {
          this.logger.error(
            `Claude spawn failed: /${skill} (exit code ${code})`,
            errorSnippet || 'No output',
          );
          resolve({
            status: 'failed',
            exitCode: code ?? undefined,
            errorSnippet: errorSnippet || `Process exited with code ${code} and produced no output`,
            sessionId,
          });
        }
      });

      if (this.config.executor.timeout) {
        timeoutHandle = setTimeout(() => {
          if (child.pid) {
            process.kill(-child.pid, 'SIGTERM');
          }
        }, this.config.executor.timeout);
      }
    });
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
