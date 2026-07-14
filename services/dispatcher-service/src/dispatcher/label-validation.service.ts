import { MODE_LABEL_PREFIX } from '../constants/mode-labels.constants';
import { ReposConfigService } from '../config/repos-config.service';

/**
 * Stateless validator for issue labels during webhook dispatch.
 * Validates and resolves labels to routing decisions (repo path, skill).
 *
 * Validates:
 * - Exactly one domain label (System/Domain matching a configured repo)
 * - Exactly one mode label (agent-implement, agent-plan, agent-resume)
 *
 * Collects all validation problems upfront (not one-at-a-time) so operators
 * can fix all issues in a single pass rather than seeing them iteratively.
 */
export class LabelValidationService {
  static resolveRun(
    labels: string[],
    reposConfig: ReposConfigService,
  ): { repoLabel: string; repoPath: string; skill: string } {
    const problems: string[] = [];

    // Validate domain label first
    const domainValidation = this.validateAndResolveDomainLabel(labels, reposConfig);
    if (domainValidation.error) {
      problems.push(domainValidation.error);
    }

    // Validate mode label
    const modeValidation = this.validateModeLabels(labels);
    if (modeValidation.error) {
      problems.push(modeValidation.error);
    }

    if (problems.length > 0) {
      const listItems = problems.map((p) => `- ${p}`).join('\n');
      throw new Error(listItems);
    }

    // Both domain and mode labels validated; resolve skill
    const { repoLabel, repoPath } = domainValidation;
    const { modeLabel } = modeValidation;

    const skill = this.resolveSkill(repoLabel!, modeLabel!, reposConfig);

    return { repoLabel: repoLabel!, repoPath: repoPath!, skill };
  }

  private static validateAndResolveDomainLabel(
    labels: string[],
    reposConfig: ReposConfigService,
  ): { repoLabel?: string; repoPath?: string; error?: string } {
    for (const label of labels) {
      const path = reposConfig.getRepoPath(label);
      if (path) {
        return { repoLabel: label, repoPath: path };
      }
    }

    return {
      error:
        `**Domain label (required)**: Add a System/Domain label to route this issue to a codebase. ` +
        `Your dispatcher supports: ${reposConfig
          .getRepositoryLabels()
          .map((l) => `\`${l}\``)
          .join(', ')}. ` +
        `Ensure the label is mapped in your dispatcher's \`repos.config.json\`.`,
    };
  }

  private static validateModeLabels(labels: string[]): { modeLabel?: string; error?: string } {
    const modeLabels = labels.filter((label) => label.startsWith(MODE_LABEL_PREFIX));

    if (modeLabels.length === 0) {
      return {
        error:
          `**Mode label (required)**: Add exactly one mode label to specify what the agent should do. ` +
          `Options: \`agent-implement\`, \`agent-plan\`, \`agent-resume\`.`,
      };
    }

    if (modeLabels.length > 1) {
      return {
        error:
          `**Mode label (conflict)**: Multiple mode labels found (${modeLabels.map((l) => `\`${l}\``).join(', ')}). ` +
          `Each issue must have exactly one mode label — remove all but one.`,
      };
    }

    return { modeLabel: modeLabels[0] };
  }

  private static resolveSkill(
    repoLabel: string,
    modeLabel: string,
    reposConfig: ReposConfigService,
  ): string {
    const skill = reposConfig.getSkillForMode(repoLabel, modeLabel);
    if (!skill) {
      throw new Error(
        `Mode '${modeLabel}' is not configured for repo '${repoLabel}'. ` +
          `Add '${modeLabel}' to the repo's modes mapping in repos.config.json.`,
      );
    }
    return skill;
  }
}
