import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { existsSync } from 'fs';

// Mode labels determine which Claude skill to invoke for an issue. Teams
// define their own mode labels in routing.config.json (any naming
// convention is allowed), e.g. agent-implement, ready-for-agent, skill-test.
const MODE_LABEL_PATTERN = /^[a-zA-Z0-9_-]+$/;

interface RepositoryConfig {
  label: string;
  path: string;
  description?: string;
  issueLabelToSkill?: Record<string, string>; // Linear issue label → Claude skill name mapping
}

interface RoutingPolicy {
  // When true, an update on an issue whose Linear state is Completed/Canceled
  // never dispatches, even if a trigger label was added in the same webhook.
  skipDoneIssues: boolean;
  // Minimum time between two runs for the same (issue, domain, skill) before
  // a new one is rejected as a duplicate (e.g. a relay redelivering the same
  // event via overlapping subscriber registrations).
  duplicateRunWindowMs: number;
}

const DEFAULT_POLICY: RoutingPolicy = {
  skipDoneIssues: false,
  duplicateRunWindowMs: 60_000,
};

interface RoutingConfigFile {
  repositories: RepositoryConfig[];
  policy?: Partial<RoutingPolicy>;
}

/**
 * Load and manage repository routing configuration from routing.config.json
 * Validates structure and uniqueness of labels
 */
@Injectable()
export class RoutingConfigService {
  private readonly logger = new Logger(RoutingConfigService.name);
  private readonly config: RoutingConfigFile;
  private readonly repoMapping: Map<string, string>;
  private readonly policy: RoutingPolicy;

  constructor() {
    this.config = this.loadRoutingConfig();
    this.repoMapping = this.buildRepoMapping();
    this.policy = { ...DEFAULT_POLICY, ...this.config.policy };
  }

  /**
   * Global dispatch policy (skipDoneIssues, duplicateRunWindowMs, etc.),
   * defaulted for any field the config file omits.
   */
  getPolicy(): RoutingPolicy {
    return this.policy;
  }

  /**
   * Get the repository path for a given label
   * Returns undefined if label not found
   */
  getRepoPath(label: string): string | undefined {
    return this.repoMapping.get(label);
  }

  /**
   * Get all configured repositories
   */
  getAllRepositories(): RepositoryConfig[] {
    return this.config.repositories;
  }

  /**
   * Get all configured repository labels
   */
  getRepositoryLabels(): string[] {
    return this.config.repositories.map((r) => r.label);
  }

  /**
   * Get all valid mode labels for a given repository
   * Returns empty array if repo not found or has no modes
   */
  getValidModesForRepo(repoLabel: string): string[] {
    const repo = this.config.repositories.find((r) => r.label === repoLabel);
    if (!repo || !repo.issueLabelToSkill) {
      return [];
    }
    return Object.keys(repo.issueLabelToSkill);
  }

  /**
   * Get skill for a given mode label on a specific repository
   * Returns undefined if repo not found or mode not configured
   */
  getSkillForMode(repoLabel: string, modeLabel: string): string | undefined {
    const repo = this.config.repositories.find((r) => r.label === repoLabel);
    if (!repo || !repo.issueLabelToSkill) {
      return undefined;
    }
    return repo.issueLabelToSkill[modeLabel];
  }

  /**
   * Get repo mapping as plain object (for compatibility)
   */
  getRepoMapping(): Record<string, string> {
    const mapping: Record<string, string> = {};
    for (const [label, path] of this.repoMapping.entries()) {
      mapping[label] = path;
    }
    return mapping;
  }

  private loadRoutingConfig(): RoutingConfigFile {
    // Try to load routing.config.json from project root
    const configPath = join(process.cwd(), 'routing.config.json');

    if (!existsSync(configPath)) {
      throw new Error(
        `routing.config.json not found at ${configPath}. ` +
          `Copy routing.config.example.json to routing.config.json and configure your repositories.`,
      );
    }

    try {
      const content = readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content) as RoutingConfigFile;
      this.validateRoutingConfig(config);
      this.logger.log(
        `Loaded ${config.repositories.length} repositories from routing.config.json`,
      );
      return config;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in routing.config.json: ${error.message}`);
      }
      throw error;
    }
  }

  private validateRoutingConfig(config: RoutingConfigFile): void {
    if (config.policy !== undefined) {
      if (typeof config.policy !== 'object' || Array.isArray(config.policy)) {
        throw new Error('routing.config.json "policy" must be an object');
      }
      if (
        config.policy.skipDoneIssues !== undefined &&
        typeof config.policy.skipDoneIssues !== 'boolean'
      ) {
        throw new Error('routing.config.json "policy.skipDoneIssues" must be a boolean');
      }
      if (
        config.policy.duplicateRunWindowMs !== undefined &&
        (typeof config.policy.duplicateRunWindowMs !== 'number' ||
          config.policy.duplicateRunWindowMs < 0)
      ) {
        throw new Error(
          'routing.config.json "policy.duplicateRunWindowMs" must be a non-negative number',
        );
      }
    }

    if (!config.repositories || !Array.isArray(config.repositories)) {
      throw new Error('routing.config.json must have a "repositories" array');
    }

    if (config.repositories.length === 0) {
      throw new Error('routing.config.json must define at least one repository');
    }

    const labels = new Set<string>();

    for (const repo of config.repositories) {
      // Validate required fields
      if (!repo.label || typeof repo.label !== 'string') {
        throw new Error(`Each repository must have a "label" field (string)`);
      }

      if (!repo.path || typeof repo.path !== 'string') {
        throw new Error(`Repository "${repo.label}" must have a "path" field (string)`);
      }

      // Validate label is unique
      if (labels.has(repo.label)) {
        throw new Error(`Duplicate repository label: "${repo.label}"`);
      }
      labels.add(repo.label);

      // Validate label format (no spaces, valid characters)
      if (!/^[a-zA-Z0-9_-]+$/.test(repo.label)) {
        throw new Error(
          `Invalid label format: "${repo.label}". Labels must contain only alphanumeric, dash, or underscore.`,
        );
      }

      // Validate issueLabelToSkill if present
      if (repo.issueLabelToSkill) {
        if (typeof repo.issueLabelToSkill !== 'object' || Array.isArray(repo.issueLabelToSkill)) {
          throw new Error(
            `Repository "${repo.label}" issueLabelToSkill must be an object mapping issue labels to skills`,
          );
        }

        for (const [modeLabel, skill] of Object.entries(repo.issueLabelToSkill)) {
          if (!modeLabel || typeof modeLabel !== 'string') {
            throw new Error(
              `Repository "${repo.label}" has invalid mode label (must be non-empty string)`,
            );
          }
          if (!skill || typeof skill !== 'string') {
            throw new Error(
              `Repository "${repo.label}" mode "${modeLabel}" must map to a skill name (string)`,
            );
          }
          // Validate mode label format
          if (!MODE_LABEL_PATTERN.test(modeLabel)) {
            throw new Error(
              `Invalid mode format in "${repo.label}": "${modeLabel}". ` +
                `Modes must contain only alphanumeric, dash, or underscore.`,
            );
          }
        }
      }
    }
  }

  private buildRepoMapping(): Map<string, string> {
    const mapping = new Map<string, string>();

    for (const repo of this.config.repositories) {
      mapping.set(repo.label, repo.path);
    }

    return mapping;
  }
}
