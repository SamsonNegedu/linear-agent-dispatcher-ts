import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { existsSync } from 'fs';
import { MODE_LABEL_PATTERN } from '../constants/mode-labels.constants';

export interface RepositoryConfig {
  label: string;
  path: string;
  description?: string;
  modes?: Record<string, string>; // mode label → skill name mapping
}

export interface ReposConfigFile {
  repositories: RepositoryConfig[];
}

/**
 * Load and manage repository configuration from repos.config.json
 * Validates structure and uniqueness of labels
 */
@Injectable()
export class ReposConfigService {
  private readonly logger = new Logger(ReposConfigService.name);
  private readonly config: ReposConfigFile;
  private readonly repoMapping: Map<string, string>;

  constructor() {
    this.config = this.loadReposConfig();
    this.repoMapping = this.buildRepoMapping();
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
    if (!repo || !repo.modes) {
      return [];
    }
    return Object.keys(repo.modes);
  }

  /**
   * Get skill for a given mode label on a specific repository
   * Returns undefined if repo not found or mode not configured
   */
  getSkillForMode(repoLabel: string, modeLabel: string): string | undefined {
    const repo = this.config.repositories.find((r) => r.label === repoLabel);
    if (!repo || !repo.modes) {
      return undefined;
    }
    return repo.modes[modeLabel];
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

  private loadReposConfig(): ReposConfigFile {
    // Try to load repos.config.json from project root
    const configPath = join(process.cwd(), 'repos.config.json');

    if (!existsSync(configPath)) {
      throw new Error(
        `repos.config.json not found at ${configPath}. ` +
          `Copy repos.config.json.dist to repos.config.json and configure your repositories.`,
      );
    }

    try {
      const content = readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content) as ReposConfigFile;
      this.validateReposConfig(config);
      this.logger.log(`Loaded ${config.repositories.length} repositories from repos.config.json`);
      return config;
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error(`Invalid JSON in repos.config.json: ${err.message}`);
      }
      throw err;
    }
  }

  private validateReposConfig(config: ReposConfigFile): void {
    if (!config.repositories || !Array.isArray(config.repositories)) {
      throw new Error('repos.config.json must have a "repositories" array');
    }

    if (config.repositories.length === 0) {
      throw new Error('repos.config.json must define at least one repository');
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

      // Validate modes if present
      if (repo.modes) {
        if (typeof repo.modes !== 'object' || Array.isArray(repo.modes)) {
          throw new Error(
            `Repository "${repo.label}" modes must be an object mapping mode labels to skills`,
          );
        }

        for (const [modeLabel, skill] of Object.entries(repo.modes)) {
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
