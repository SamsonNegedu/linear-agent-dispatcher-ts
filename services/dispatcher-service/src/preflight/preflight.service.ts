import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import type { DispatcherConfig } from '../config/config';
import { ReposConfigService } from '../config/repos-config.service';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execFileAsync = promisify(execFile);

/**
 * Preflight validation runs on startup to catch configuration issues early.
 * Warns if repos are missing, claude binary doesn't exist, or skills are not configured.
 * Skipped if PREFLIGHT_SKIP=1 (for CI/test environments).
 */
@Injectable()
export class PreflightService implements OnModuleInit {
  private readonly logger = new Logger(PreflightService.name);

  constructor(
    @Inject('DispatcherConfig') private readonly config: DispatcherConfig,
    private readonly reposConfig: ReposConfigService,
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

    // 2. Check repos exist and have .claude/settings.json
    const repos = this.reposConfig.getAllRepositories();
    for (const repo of repos) {
      if (!fs.existsSync(repo.path)) {
        warnings.push(`Repo path does not exist: ${repo.path} (domain: ${repo.label})`);
        continue;
      }

      const claudeSettingsPath = path.join(repo.path, '.claude', 'settings.json');
      if (!fs.existsSync(claudeSettingsPath)) {
        warnings.push(
          `Missing .claude/settings.json in repo: ${repo.path} (domain: ${repo.label})`,
        );
      }

      // Check if at least one mode is configured
      if (!repo.modes || Object.keys(repo.modes).length === 0) {
        warnings.push(`No modes configured for repo: ${repo.path} (domain: ${repo.label})`);
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
      for (const err of errors) {
        this.logger.error(`  [ERROR] ${err}`);
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
