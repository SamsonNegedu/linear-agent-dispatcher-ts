import { ReposConfigService } from '../config/repos-config.service';
import { ValidationError } from './validation.error';

/**
 * Validates issue labels for webhook dispatch.
 * Requires exactly one domain label (repo routing) and one mode label (skill selection).
 * Domain and mode labels are in separate namespaces to prevent collisions.
 * Throws ValidationError for expected failures (posted as comments to Linear).
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

    // Validate mode label (needs repo context to know which modes are valid)
    const repoLabel = domainValidation.repoLabel;
    const modeValidation = repoLabel
      ? this.validateModeLabels(labels, repoLabel, reposConfig)
      : { error: 'Domain label required before mode validation' };

    if (modeValidation.error) {
      problems.push(modeValidation.error);
    }

    if (problems.length > 0) {
      const listItems = problems.map((p) => `- ${p}`).join('\n');
      throw new ValidationError(listItems);
    }

    // Both domain and mode labels validated; resolve skill
    const { repoPath } = domainValidation;
    const { modeLabel } = modeValidation;

    const skill = this.resolveSkill(repoLabel!, modeLabel!, reposConfig);

    return { repoLabel: repoLabel!, repoPath: repoPath!, skill };
  }

  private static validateAndResolveDomainLabel(
    labels: string[],
    reposConfig: ReposConfigService,
  ): { repoLabel?: string; repoPath?: string; error?: string } {
    // Check which labels are valid domain labels
    const validDomainLabels = reposConfig.getRepositoryLabels();
    const matchingDomainLabels = labels.filter((label) => validDomainLabels.includes(label));

    if (matchingDomainLabels.length === 0) {
      return {
        error:
          `**Domain label (required)**: Add a System/Domain label to route this issue to a codebase. ` +
          `Your dispatcher supports: ${validDomainLabels.map((l) => `\`${l}\``).join(', ')}. ` +
          `Ensure the label is mapped in your dispatcher's \`repos.config.json\`.`,
      };
    }

    if (matchingDomainLabels.length > 1) {
      return {
        error:
          `**Domain label (conflict)**: Multiple domain labels found (${matchingDomainLabels.map((l) => `\`${l}\``).join(', ')}). ` +
          `Each issue must have exactly one domain label — remove all but one.`,
      };
    }

    const repoLabel = matchingDomainLabels[0];
    const repoPath = reposConfig.getRepoPath(repoLabel);

    return { repoLabel, repoPath };
  }

  private static validateModeLabels(
    labels: string[],
    repoLabel: string,
    reposConfig: ReposConfigService,
  ): { modeLabel?: string; error?: string } {
    const validModes = reposConfig.getValidModesForRepo(repoLabel);
    const validDomainLabels = reposConfig.getRepositoryLabels();

    // Filter out domain labels — mode labels must not be domain labels (separate namespaces)
    const nonDomainLabels = labels.filter((label) => !validDomainLabels.includes(label));

    // Check which non-domain labels are valid modes for this repo
    const matchingModeLabels = nonDomainLabels.filter((label) => validModes.includes(label));

    if (matchingModeLabels.length === 0) {
      const availableModes = validModes.map((m) => `\`${m}\``).join(', ');
      return {
        error:
          `**Mode label (required)**: Add exactly one mode label to specify which Claude skill to invoke. ` +
          `For repo \`${repoLabel}\`, the available modes are: ${availableModes}. ` +
          `Available modes are defined in your dispatcher's \`repos.config.json\`.`,
      };
    }

    if (matchingModeLabels.length > 1) {
      return {
        error:
          `**Mode label (conflict)**: Multiple mode labels found (${matchingModeLabels.map((l) => `\`${l}\``).join(', ')}). ` +
          `Each issue must have exactly one mode label — remove all but one.`,
      };
    }

    return { modeLabel: matchingModeLabels[0] };
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
