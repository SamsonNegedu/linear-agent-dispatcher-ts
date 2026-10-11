#!/usr/bin/env node
import { existsSync, readFileSync, statSync, writeFileSync } from 'fs';
import { isAbsolute, resolve } from 'path';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { RoutingConfigService, routingConfigPath } from '../config/routing-config.service';
import { checkRouting, formatRoutingTable } from '../config/routing-report';
import { formatSchemaIssues, repoLabel, routingConfigSchema } from '../config/routing-schema';
import { listRepoSkills } from '../config/skill-discovery';
import { CliError, parseFlags, runCli } from './cli-utils';

const SCHEMA_FILE = 'routing.config.schema.json';

const USAGE = `Usage: pnpm routes [command]

  list               Show repo -> issue label -> skill mappings (default)
  check              Same, but exit 1 if any path or skill is missing
  add <path> [--label=<name>] [--skills=a,b] [--description=<text>]
                     Register a repo (label defaults to the folder name)
  schema             Regenerate ${SCHEMA_FILE} for editor autocomplete

Label agent-<name> runs /<name>, for skills listed under "skills" in the config.`;

function printReport(): number {
  const report = checkRouting(new RoutingConfigService().getResolvedRepos());
  console.log(formatRoutingTable(report));
  console.log('\n✓ found   ✗ missing   ? plugin skill (not checked)');
  if (report.problems.length) {
    console.error(`\n${report.problems.length} problem(s):`);
    report.problems.forEach((p) => console.error(`  - ${p}`));
    return 1;
  }
  return 0;
}

function add(argv: string[]): number {
  const { values, positionals } = parseFlags(
    { label: { type: 'string' }, skills: { type: 'string' }, description: { type: 'string' } },
    argv,
    true,
  );
  const target = positionals[0];
  if (!target) throw new CliError(USAGE);

  const repoPath = isAbsolute(target) ? target : resolve(process.cwd(), target);
  if (!existsSync(repoPath) || !statSync(repoPath).isDirectory()) {
    throw new CliError(`Not a directory: ${repoPath}`);
  }

  const label = values.label ?? repoLabel(repoPath);
  const skills = values.skills?.split(',').filter(Boolean) ?? [];
  const configPath = routingConfigPath();
  const raw = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, 'utf-8'))
    : { repositories: [] };

  // Just the path unless something needs to differ from the defaults.
  const plain = !values.description && !skills.length && label === repoLabel(repoPath);
  raw.repositories = [
    ...(raw.repositories ?? []),
    plain
      ? repoPath
      : {
          label,
          path: repoPath,
          ...(values.description ? { description: values.description } : {}),
          ...(skills.length ? { skills } : {}),
        },
  ];
  const parsed = routingConfigSchema.safeParse(raw);
  if (!parsed.success)
    throw new CliError(`Cannot add "${label}":\n${formatSchemaIssues(parsed.error)}`);

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

Logger.overrideLogger(false); // keep CLI output clean
runCli(() => {
  const [command = 'list', ...rest] = process.argv.slice(2);
  const commands: Record<string, () => number> = {
    list: () => (printReport(), 0),
    check: printReport,
    add: () => add(rest),
    schema,
  };
  const run = commands[command];
  if (!run) throw new CliError(USAGE);
  process.exitCode = run();
});
