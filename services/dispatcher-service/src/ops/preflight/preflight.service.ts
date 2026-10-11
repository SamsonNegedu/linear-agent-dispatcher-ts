import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import type { DispatcherConfig } from '../../config/config';
import { RoutingConfigService } from '../../config/routing-config.service';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import { findSkill } from '../../config/skill-discovery';

const execFileAsync = promisify(execFile);

/**
 * Preflight validation runs on startup to catch configuration issues early.
 * Fails if the claude binary, a repo path, or a mapped skill is missing (see `pnpm routes check`).
 * Skipped if PREFLIGHT_SKIP=1 (for CI/test environments).
 */
@Injectable()
export class PreflightService implements OnModuleInit {
  private readonly logger = new Logger(PreflightService.name);

  constructor(
    @Inject('DispatcherConfig') private readonly config: DispatcherConfig,
    private readonly routingConfig: RoutingConfigService,
  ) {}

  async onModuleInit() {
    if (this.config.preflight.skip) {
      this.logger.log('Preflight validation skipped (PREFLIGHT_SKIP=1)');
      return;
    }

    await this.validate();
  }

  private async validate() {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Check claude binary exists
    try {
      // Validate claudeBinPath format to prevent command injection
      if (!this.isValidBinaryPath(this.config.executor.claudeBinPath)) {
        throw new Error(
          'Invalid claudeBinPath format: must contain only alphanumeric, dots, slashes, and dashes',
        );
      }
      await execFileAsync('which', [this.config.executor.claudeBinPath]);
      this.logger.log(`Claude binary found: ${this.config.executor.claudeBinPath}`);
    } catch {
      errors.push(`Claude binary not found: ${this.config.executor.claudeBinPath}`);
    }

    // 2. Check every repo path exists and every mapped skill resolves on disk
    for (const repo of this.routingConfig.getAllRepositories()) {
      if (!fs.existsSync(repo.path)) {
        errors.push(`[${repo.label}] repo path does not exist: ${repo.path}`);
        continue;
      }

      const mappings = Object.entries(repo.issueLabelToSkill ?? {});
      if (mappings.length === 0) {
        errors.push(
          `[${repo.label}] no skills exposed. List some under "skills" in routing.config.json ` +
            `(e.g. "skills": ["implement"]).`,
        );
      }
      for (const [issueLabel, skill] of mappings) {
        if (findSkill(repo.path, skill).status === 'missing') {
          errors.push(
            `[${repo.label}] ${issueLabel} -> /${skill}: skill not found ` +
              `(expected ${repo.path}/.claude/skills/${skill}/SKILL.md)`,
          );
        }
      }
    }

    // 3. Check Linear API key if activities enabled
    if (this.config.linear.apiKey) {
      this.logger.log('Linear API key configured (activity posting enabled)');
    } else {
      warnings.push('Linear API key not configured (activity posting will be skipped)');
    }

    // 4. Report
    if (errors.length > 0) {
      this.logger.error('Preflight validation failed:');
      for (const error of errors) {
        this.logger.error(`  [ERROR] ${error}`);
      }
      throw new Error('Preflight validation failed');
    }

    if (warnings.length > 0) {
      this.logger.warn('Preflight validation warnings:');
      for (const warn of warnings) {
        this.logger.warn(`  [WARN] ${warn}`);
      }
    }

    this.logger.log('Preflight validation passed');
  }

  private isValidBinaryPath(path: string): boolean {
    return /^[a-zA-Z0-9._/-]+$/.test(path);
  }
}
