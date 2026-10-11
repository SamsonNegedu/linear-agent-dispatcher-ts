import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export type SkillLookup =
  | { status: 'found'; location: string }
  | { status: 'missing' }
  // Plugin skills (`plugin:skill`) live outside the repo and cannot be checked on disk.
  | { status: 'unverifiable' };

function candidates(base: string, skill: string): string[] {
  return [
    join(base, '.claude', 'skills', skill, 'SKILL.md'),
    join(base, '.claude', 'commands', `${skill}.md`),
  ];
}

/** Look for `/skill` in the repo's .claude/{skills,commands}, then the user's. */
export function findSkill(repoPath: string, skill: string, home: string = homedir()): SkillLookup {
  if (skill.includes(':')) return { status: 'unverifiable' };
  const location = [...candidates(repoPath, skill), ...candidates(home, skill)].find((p) =>
    existsSync(p),
  );
  return location ? { status: 'found', location } : { status: 'missing' };
}

export const MODE_LABEL_PREFIX = 'agent-';

/** The Linear label that triggers a skill: `agent-<name>`. */
export function labelForSkill(skill: string): string {
  return MODE_LABEL_PREFIX + skill;
}

/** Every skill/command defined in the repo's own .claude directory. */
export function listRepoSkills(repoPath: string): string[] {
  const names = new Set<string>();
  const list = (dir: string): string[] => {
    try {
      return readdirSync(dir) ?? [];
    } catch {
      return [];
    }
  };

  for (const entry of list(join(repoPath, '.claude', 'skills'))) {
    if (existsSync(join(repoPath, '.claude', 'skills', entry, 'SKILL.md'))) names.add(entry);
  }
  for (const entry of list(join(repoPath, '.claude', 'commands'))) {
    if (entry.endsWith('.md')) names.add(entry.slice(0, -3));
  }

  return [...names].sort();
}
