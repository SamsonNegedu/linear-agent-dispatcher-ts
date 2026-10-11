import { existsSync } from 'fs';
import type { ResolvedRepo } from './routing-config.service';
import { SkillLookup, findSkill } from './skill-discovery';

export interface RoutingRow {
  repo: string;
  path: string;
  issueLabel: string;
  skill: string;
  source: string;
  lookup: SkillLookup;
}

export interface RoutingReport {
  rows: RoutingRow[];
  problems: string[];
}

const mark = (lookup: SkillLookup): string =>
  lookup.status === 'found' ? '✓' : lookup.status === 'missing' ? '✗' : '?';

/** Check every repo path and mapped skill against disk. */
export function checkRouting(repos: ResolvedRepo[], home?: string): RoutingReport {
  const rows: RoutingRow[] = [];
  const problems: string[] = [];

  for (const repo of repos) {
    const pathExists = existsSync(repo.path);
    if (!pathExists) problems.push(`[${repo.label}] repo path does not exist: ${repo.path}`);
    if (repo.mappings.length === 0) {
      problems.push(
        `[${repo.label}] no skills exposed. List some under "skills" in routing.config.json ` +
          `(e.g. "skills": ["implement"]).`,
      );
    }

    for (const m of repo.mappings) {
      const lookup: SkillLookup = pathExists
        ? findSkill(repo.path, m.skill, home)
        : { status: 'missing' };
      rows.push({
        repo: repo.label,
        path: repo.path,
        issueLabel: m.issueLabel,
        skill: m.skill,
        source: m.source,
        lookup,
      });
      if (pathExists && lookup.status === 'missing') {
        problems.push(
          `[${repo.label}] ${m.issueLabel} -> /${m.skill}: skill not found ` +
            `(expected ${repo.path}/.claude/skills/${m.skill}/SKILL.md)`,
        );
      }
    }
  }

  return { rows, problems };
}

export function formatRoutingTable(report: RoutingReport): string {
  if (report.rows.length === 0) return '(no mappings)';
  const header = ['', 'REPO', 'ISSUE LABEL', 'SKILL', 'FROM'];
  const body = report.rows.map((r) => [
    mark(r.lookup),
    r.repo,
    r.issueLabel,
    `/${r.skill}`,
    r.source,
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((row) => row[i].length)));
  const line = (cells: string[]): string =>
    cells
      .map((c, i) => c.padEnd(widths[i]))
      .join('  ')
      .trimEnd();
  return [line(header), ...body.map(line)].join('\n');
}
