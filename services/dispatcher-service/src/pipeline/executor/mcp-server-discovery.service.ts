import { Inject, Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import type { DispatcherConfig } from '../../config/config';

const CACHE_TTL_MS = 10 * 60 * 1000;
const LIST_TIMEOUT_MS = 45_000;

/**
 * Claude Code names an MCP tool `mcp__<server>__<tool>`, where <server> is the
 * configured name with every char outside [A-Za-z0-9_-] replaced by `_`
 * (e.g. "plugin:playwright:playwright" -> "plugin_playwright_playwright").
 * A permission rule that is just `mcp__<server>` allows every tool of that server.
 */
export function toMcpRule(serverName: string): string {
  return `mcp__${serverName.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

/**
 * Parse `claude mcp list` output. Each server line looks like
 * `<name>: <url-or-command> - <status>`; names may contain ":" but never ": ".
 */
export function parseMcpList(output: string): string[] {
  const names = new Set<string>();
  for (const line of output.split('\n')) {
    const match = line.match(/^(\S.*?):\s+\S.*\s-\s+\S/);
    if (match) names.add(match[1].trim());
  }
  return [...names];
}

/**
 * Finds the MCP servers a repo's headless Claude session will have (user,
 * project, plugin and claude.ai connectors alike) by asking Claude itself, so
 * unattended runs can be allowed to use every configured server without
 * listing tools per repo. Results are cached per repo since `claude mcp list`
 * health-checks every server (a few seconds).
 */
@Injectable()
export class McpServerDiscoveryService {
  private readonly logger = new Logger(McpServerDiscoveryService.name);
  private readonly cache = new Map<string, { at: number; rules: Promise<string[]> }>();

  constructor(@Inject('DispatcherConfig') private readonly config: DispatcherConfig) {}

  /** Permission rules (`mcp__<server>`) for every MCP server configured for the repo. */
  allowRules(repoPath: string): Promise<string[]> {
    const cached = this.cache.get(repoPath);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rules;

    const rules = this.discover(repoPath);
    this.cache.set(repoPath, { at: Date.now(), rules });
    // Don't cache failures: retry on the next run.
    void rules.then((r) => r.length === 0 && this.cache.delete(repoPath));
    return rules;
  }

  private discover(repoPath: string): Promise<string[]> {
    const env: NodeJS.ProcessEnv = {};
    for (const key of this.config.executor.allowedEnvVars) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }

    return new Promise((resolve) => {
      execFile(
        this.config.executor.claudeBinPath,
        ['mcp', 'list'],
        { cwd: repoPath, env, timeout: LIST_TIMEOUT_MS },
        (error, stdout) => {
          if (error && !stdout) {
            this.logger.warn(`Could not list MCP servers for ${repoPath}: ${error.message}`);
            return resolve([]);
          }
          const rules = parseMcpList(stdout).map(toMcpRule);
          this.logger.log(`MCP servers allowed for ${repoPath}: ${rules.join(', ') || '(none)'}`);
          resolve(rules);
        },
      );
    });
  }
}
