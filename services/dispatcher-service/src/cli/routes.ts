#!/usr/bin/env node
import { existsSync, readFileSync, statSync, writeFileSync } from 'fs';
import { basename, isAbsolute, resolve } from 'path';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  RoutingConfigService,
  routingConfigPath,
} from '../config/routing-config.service';
import { checkRouting, formatRoutingTable } from '../config/routing-report';
import { formatSchemaIssues, repoLabel, routingConfigSchema } from '../config/routing-schema';
import { listRepoSkills } from '../config/skill-discovery';

const SCHEMA_FILE = 'routing.config.schema.json';

const USAGE = `Usage: pnpm routes [command]

  list               Show repo -> issue label -> skill mappings (default)
  check              Same, but exit 1 if any path or skill is missing
  add <path> [--label=<name>] [--skills=a,b] [--description=<text>]
                     Register a repo (label defaults to the folder name)

Label agent-<name> runs /<name>, for skills listed under "skills" in the config.
  schema             Regenerate ${SCHEMA_FILE} for editor autocomplete`;

function load(): RoutingConfigService {
  return new RoutingConfigService();
}

function printReport(): number {
  const report = checkRouting(load().getResolvedRepos());
  console.log(formatRoutingTable(report));
  console.log('\n✓ found   ✗ missing   ? plugin skill (not checked)');
  if (report.problems.length) {
    console.error(`\n${report.problems.length} problem(s):`);
    report.problems.forEach((p) => console.error(`  - ${p}`));
    return 1;
  }
  return 0;
}

function add(args: string[]): number {
  const flags = Object.fromEntries(
    args
      .filter((a) => a.startsWith('--'))
      .map((a) => a.slice(2).split(/=(.*)/s).slice(0, 2) as [string, string]),
  );
  const target = args.find((a) => !a.startsWith('--'));
  if (!target) {
    console.error(USAGE);
    return 1;
  }

  const repoPath = isAbsolute(target) ? target : resolve(process.cwd(), target);
  if (!existsSync(repoPath) || !statSync(repoPath).isDirectory()) {
    console.error(`Not a directory: ${repoPath}`);
    return 1;
  }

  const label = flags.label ?? basename(repoPath).replace(/[^a-zA-Z0-9_-]/g, '-');
  const configPath = routingConfigPath();
  const raw = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, 'utf-8'))
    : { repositories: [] };

  // Just the path unless something needs to differ from the defaults.
  const skills = flags.skills ? flags.skills.split(',').filter(Boolean) : [];
  const plain = !flags.description && !skills.length && label === repoLabel(repoPath);
  raw.repositories = [
    ...(raw.repositories ?? []),
    plain
      ? repoPath
      : {
          label,
          path: repoPath,
          ...(flags.description ? { description: flags.description } : {}),
          ...(skills.length ? { skills } : {}),
        },
  ];
  const parsed = routingConfigSchema.safeParse(raw);
  if (!parsed.success) {
    console.error(`Cannot add "${label}":\n${formatSchemaIssues(parsed.error)}`);
    return 1;
  }

  writeFileSync(configPath, `${JSON.stringify(raw, null, 2)}\n`);
  console.log(`Added "${label}" -> ${repoPath}\n`);

  const available = listRepoSkills(repoPath);
  if (available.length) {
    console.log(`Skills in this repo: ${available.join(', ')}`);
    console.log('Expose some with --skills=a,b, or under "skills" in routing.config.json.\n');
  } else {
    console.warn(`Warning: no skills found in ${repoPath}/.claude/skills/.\n`);
  }
  return printReport();
}

function schema(): number {
  const json = z.toJSONSchema(routingConfigSchema);
  writeFileSync(resolve(process.cwd(), SCHEMA_FILE), `${JSON.stringify(json, null, 2)}\n`);
  console.log(`Wrote ${SCHEMA_FILE}`);
  return 0;
}

function main(): number {
  const [command = 'list', ...rest] = process.argv.slice(2);
  switch (command) {
    case 'list':
    case 'check':
      return printReport();
    case 'add':
      return add(rest);
    case 'schema':
      return schema();
    default:
      console.error(USAGE);
      return 1;
  }
}

Logger.overrideLogger(false); // keep CLI output clean
try {
  process.exit(main());
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
