import { basename } from 'path';
import { z } from 'zod';

const IDENTIFIER = /^[a-zA-Z0-9_-]+$/;
const IDENTIFIER_HINT = 'only letters, digits, dash or underscore';

// A skill name may carry a plugin namespace (`plugin:skill`).
const skillName = z.string().regex(/^[a-zA-Z0-9_-]+(:[a-zA-Z0-9_-]+)?$/, 'not a valid skill name');

// Skills a Linear label may trigger: `agent-<name>` runs `/<name>`.
const exposedSkills = z
  .array(z.string().regex(IDENTIFIER, IDENTIFIER_HINT))
  .describe('Skill names that the label agent-<name> may run');

const repositoryObject = z
  .object({
    // Defaults to the folder name of `path`.
    label: z.string().min(1).regex(IDENTIFIER, IDENTIFIER_HINT).optional(),
    path: z.string().min(1),
    description: z.string().optional(),
    // Added to the top-level `skills` for this repo.
    skills: exposedSkills.optional(),
    // Maps a label to a differently named skill, e.g. { "agent-build": "implement" }.
    issueLabelToSkill: z
      .record(z.string().regex(IDENTIFIER, IDENTIFIER_HINT), skillName)
      .optional(),
  })
  .strict();

// A repo is either just its path, or an object when something needs overriding.
const repository = z.union([z.string().min(1), repositoryObject]);

export const routingConfigSchema = z
  .object({
    $schema: z.string().optional(),
    _comment: z.string().optional(),
    policy: z
      .object({
        skipDoneIssues: z.boolean().optional(),
        duplicateRunWindowMs: z.number().min(0).optional(),
      })
      .strict()
      .optional(),
    // Exposed in every repo (each repo may add more). Nothing is exposed unless listed.
    skills: exposedSkills.optional(),
    repositories: z.array(repository).min(1, 'define at least one repository'),
  })
  .strict()
  .superRefine((config, ctx) => {
    const seen = new Set<string>();
    config.repositories.forEach((repo, index) => {
      const label = repoLabel(repo);
      if (seen.has(label)) {
        ctx.addIssue({
          code: 'custom',
          path: ['repositories', index],
          message: `Duplicate repository label: "${label}"`,
        });
      }
      seen.add(label);
    });
  });

export type RoutingConfigFile = z.infer<typeof routingConfigSchema>;
export type RepositoryEntry = z.infer<typeof repository>;
export type RepositoryObject = z.infer<typeof repositoryObject>;

export function repoPathOf(repo: RepositoryEntry): string {
  return typeof repo === 'string' ? repo : repo.path;
}

export function repoLabel(repo: RepositoryEntry): string {
  if (typeof repo !== 'string' && repo.label) return repo.label;
  const folder = basename(repoPathOf(repo).replace(/\/+$/, ''));
  return folder.replace(/[^a-zA-Z0-9_-]/g, '-');
}

type Issue = z.ZodError['issues'][number];

// A union (repo = path string | object) reports a vague "Invalid input"; surface the
// issues of the branch the user most likely meant (the one whose root type matched).
function flatten(
  issue: Issue,
  prefix: (string | number)[] = [],
): Array<{ path: (string | number)[]; message: string }> {
  const path = [...prefix, ...issue.path.map((p) => (typeof p === 'symbol' ? String(p) : p))];
  if (issue.code === 'invalid_union') {
    const branch = (issue.errors as Issue[][]).find(
      (issues) => !issues.some((i) => i.code === 'invalid_type' && i.path.length === 0),
    );
    if (branch) return branch.flatMap((i) => flatten(i, path));
  }
  return [{ path, message: issue.message }];
}

export function formatSchemaIssues(error: z.ZodError): string {
  return error.issues
    .flatMap((issue) => flatten(issue))
    .map(({ path, message }) => `  - ${path.length ? path.join('.') : '(root)'}: ${message}`)
    .join('\n');
}
