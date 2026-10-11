import { Injectable, Logger } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import {
  RepositoryEntry,
  RoutingConfigFile,
  formatSchemaIssues,
  repoLabel,
  repoPathOf,
  routingConfigSchema,
} from './routing-schema';
import { labelForSkill } from './skill-discovery';
import { errorMessage } from '../common/error-message';

// auto = skill listed in `skills` (label agent-<name>); override = issueLabelToSkill
export type MappingSource = 'auto' | 'override';

export interface ResolvedMapping {
  issueLabel: string;
  skill: string;
  source: MappingSource;
}

export interface ResolvedRepo {
  label: string;
  path: string;
  description?: string;
  mappings: ResolvedMapping[];
}

interface RepositoryConfig {
  label: string;
  path: string;
  description?: string;
  issueLabelToSkill: Record<string, string>; // Linear issue label -> Claude skill name (fully resolved)
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

export const ROUTING_CONFIG_FILE = 'routing.config.json';

export function routingConfigPath(): string {
  return join(process.cwd(), ROUTING_CONFIG_FILE);
}

function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') ? join(homedir(), p.slice(1)) : p;
}

/**
 * Load routing.config.json (schema-validated). The top-level `skills` (plus a
 * repo's own `skills`) are the only skills a Linear label can trigger:
 * `agent-<name>` runs `/<name>`. `issueLabelToSkill` maps a label to a
 * differently named skill. Whether paths and skills exist on disk is checked
 * by preflight / `pnpm routes check`.
 */
@Injectable()
export class RoutingConfigService {
  private readonly logger = new Logger(RoutingConfigService.name);
  private readonly config: RoutingConfigFile;
  private readonly policy: RoutingPolicy;

  constructor() {
    this.config = this.loadRoutingConfig();
    this.policy = { ...DEFAULT_POLICY, ...this.config.policy };
  }

  /**
   * Global dispatch policy (skipDoneIssues, duplicateRunWindowMs, etc.),
   * defaulted for any field the config file omits.
   */
  getPolicy(): RoutingPolicy {
    return this.policy;
  }

  /** Repos with every mapping annotated by where it came from (reads disk). */
  getResolvedRepos(): ResolvedRepo[] {
    return this.config.repositories.map((repo) => this.resolveRepo(repo));
  }

  getRepoPath(label: string): string | undefined {
    return this.findRepo(label)?.path;
  }

  getAllRepositories(): RepositoryConfig[] {
    return this.getResolvedRepos().map((repo) => ({
      label: repo.label,
      path: repo.path,
      description: repo.description,
      issueLabelToSkill: Object.fromEntries(repo.mappings.map((m) => [m.issueLabel, m.skill])),
    }));
  }

  getRepositoryLabels(): string[] {
    return this.config.repositories.map(repoLabel);
  }

  /** Issue labels that trigger a skill for the repo; empty if repo unknown. */
  getValidModesForRepo(repoLabelName: string): string[] {
    return this.findRepo(repoLabelName)?.mappings.map((m) => m.issueLabel) ?? [];
  }

  getSkillForMode(repoLabelName: string, modeLabel: string): string | undefined {
    return this.findRepo(repoLabelName)?.mappings.find((m) => m.issueLabel === modeLabel)?.skill;
  }

  private findRepo(label: string): ResolvedRepo | undefined {
    const entry = this.config.repositories.find((r) => repoLabel(r) === label);
    return entry ? this.resolveRepo(entry) : undefined;
  }

  private resolveRepo(entry: RepositoryEntry): ResolvedRepo {
    const path = expandHome(repoPathOf(entry));
    const overrides = typeof entry === 'string' ? {} : (entry.issueLabelToSkill ?? {});
    const merged = new Map<string, ResolvedMapping>();

    const exposed = new Set([
      ...(this.config.skills ?? []),
      ...(typeof entry === 'string' ? [] : (entry.skills ?? [])),
    ]);
    for (const skill of exposed) {
      const issueLabel = labelForSkill(skill);
      merged.set(issueLabel, { issueLabel, skill, source: 'auto' });
    }
    for (const [issueLabel, skill] of Object.entries(overrides)) {
      merged.set(issueLabel, { issueLabel, skill, source: 'override' });
    }

    return {
      label: repoLabel(entry),
      path,
      description: typeof entry === 'string' ? undefined : entry.description,
      mappings: [...merged.values()].sort((a, b) => a.issueLabel.localeCompare(b.issueLabel)),
    };
  }

  private loadRoutingConfig(): RoutingConfigFile {
    const configPath = routingConfigPath();

    if (!existsSync(configPath)) {
      throw new Error(
        `routing.config.json not found at ${configPath}. ` +
          `Copy routing.config.example.json to routing.config.json, or run \`pnpm routes add <repo-path>\`.`,
      );
    }

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch (error) {
      throw new Error(`Invalid JSON in routing.config.json: ${errorMessage(error)}`);
    }

    const parsed = routingConfigSchema.safeParse(raw);
    if (!parsed.success) {
      const duplicate = parsed.error.issues.find((i) => i.message.startsWith('Duplicate'));
      throw new Error(
        duplicate
          ? duplicate.message
          : `Invalid routing.config.json:\n${formatSchemaIssues(parsed.error)}`,
      );
    }

    this.logger.log(
      `Loaded ${parsed.data.repositories.length} repositories from routing.config.json`,
    );
    return parsed.data;
  }
}
