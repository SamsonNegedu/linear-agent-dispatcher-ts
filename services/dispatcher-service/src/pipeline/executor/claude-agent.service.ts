import { Injectable, Logger, Inject } from '@nestjs/common';
import { spawn } from 'child_process';
import type { DispatcherConfig } from '../../config/config';
import { MAX_ERROR_MESSAGE_LENGTH } from './constants';
import { McpServerDiscoveryService } from './mcp-server-discovery.service';
import { errorMessage } from '../../common/error-message';

interface ClaudeSpawnResult {
  status: 'succeeded' | 'failed' | 'needs_input';
  exitCode?: number;
  errorSnippet?: string;
  sessionId?: string;
  resultText?: string;
  totalCostUSD?: number;
}

// A skill that must stop to ask something (nobody can answer an unattended run)
// begins its final reply with "Stop rule:". Tolerates leading markdown such as `**`.
const STOP_RULE_PATTERN = /^[\s*_`>#-]*Stop rule:/i;

export const isStopRuleReply = (text: string | undefined): boolean =>
  !!text && STOP_RULE_PATTERN.test(text);

// How long after SIGTERM before escalating to SIGKILL.
const SIGKILL_GRACE_MS = 10_000;

// Field names are the Claude CLI's `--output-format json` schema (snake_case).
interface ClaudeOutput {
  session_id?: string;
  result?: string;
  total_cost_usd?: number;
  stop_reason?: string;
  is_error?: boolean;
}

@Injectable()
export class ClaudeAgentService {
  private readonly logger = new Logger(ClaudeAgentService.name);

  constructor(
    @Inject('DispatcherConfig') private readonly config: DispatcherConfig,
    private readonly mcpDiscovery: McpServerDiscoveryService,
  ) {}

  async spawn(
    skill: string,
    issueIdentifier: string,
    repoPath: string,
    options?: { resumeSessionId?: string },
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
      args.push('--output-format', 'json');
      // Comma-joined into one value: --allowedTools is variadic and would otherwise
      // swallow any argument that follows it.
      if (allowRules.length > 0) args.push('--allowedTools', allowRules.join(','));
      if (permissionMode) args.push('--permission-mode', permissionMode);

      const env = this.buildSafeEnv();

      // No spawn() `timeout` option: it only signals the direct child. The timer below kills
      // the whole process group, which also reaches subprocesses Claude spawns.
      const child = spawn(this.config.executor.claudeBinPath, args, {
        cwd: repoPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      });

      let stdout = '';
      let stderr = '';
      let timeoutHandle: NodeJS.Timeout | null = null;
      let killEscalationHandle: NodeJS.Timeout | null = null;

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('error', (error) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (killEscalationHandle) clearTimeout(killEscalationHandle);
        reject(error);
      });

      child.on('close', (code) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (killEscalationHandle) clearTimeout(killEscalationHandle);

        let sessionId: string | undefined;
        let resultText: string | undefined;
        let totalCostUSD: number | undefined;
        let errorSnippet: string | undefined;
        let isError = false;

        if (stdout) {
          try {
            const output = JSON.parse(stdout) as ClaudeOutput;
            sessionId = output.session_id;
            resultText = output.result;
            totalCostUSD = output.total_cost_usd;
            isError = output.is_error ?? false;
            if (isError) {
              errorSnippet = output.result;
            }
          } catch {
            // Not valid JSON, use stderr
          }
        }

        if (!errorSnippet && stderr) {
          // Raw stderr: the actual error is usually last, so keep the end (curated messages
          // posted to Linear lead with the point and keep the start instead).
          errorSnippet = stderr.slice(-MAX_ERROR_MESSAGE_LENGTH);
        }

        if (code === 0 && !isError && isStopRuleReply(resultText)) {
          this.logger.warn(`Claude spawn stopped to ask: /${skill} (sessionId: ${sessionId})`);
          resolve({
            status: 'needs_input',
            exitCode: code ?? undefined,
            errorSnippet: resultText!.slice(0, MAX_ERROR_MESSAGE_LENGTH),
            sessionId,
            resultText,
            totalCostUSD,
          });
        } else if (code === 0 && !isError) {
          this.logger.log(
            `Claude spawn succeeded: /${skill} (sessionId: ${sessionId}, cost: $${totalCostUSD})`,
          );
          resolve({
            status: 'succeeded',
            exitCode: code ?? undefined,
            sessionId,
            resultText,
            totalCostUSD,
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
            totalCostUSD,
          });
        }
      });

      if (this.config.executor.timeout) {
        timeoutHandle = setTimeout(() => {
          this.logger.warn(
            `Claude run exceeded timeout, sending SIGTERM: /${skill} for ${issueIdentifier} pid=${child.pid}`,
          );
          this.killProcessGroup(child.pid, 'SIGTERM');

          // Escalate to SIGKILL if SIGTERM was ignored; otherwise a hung process outlives its
          // timeout. This timer is cleared on 'close'/'error', so firing means it is still alive.
          killEscalationHandle = setTimeout(() => {
            this.logger.error(
              `Claude run still alive ${SIGKILL_GRACE_MS}ms after SIGTERM, sending SIGKILL: /${skill} for ${issueIdentifier} pid=${child.pid}`,
            );
            this.killProcessGroup(child.pid, 'SIGKILL');
          }, SIGKILL_GRACE_MS);
        }, this.config.executor.timeout);
      }
    });
  }

  /**
   * process.kill() throws if the group already exited (a real race between the timeout and
   * the signal), and an uncaught throw in a timer callback would crash the whole dispatcher.
   */
  private killProcessGroup(pid: number | undefined, signal: NodeJS.Signals): void {
    if (!pid) return;
    try {
      process.kill(-pid, signal);
    } catch (error) {
      const message = errorMessage(error);
      this.logger.debug(
        `killProcessGroup(${pid}, ${signal}) failed (likely already exited): ${message}`,
      );
    }
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
