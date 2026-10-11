import { Injectable } from '@nestjs/common';
import type {
  DispatchAdapter,
  DispatchDecision,
  NormalizedEvent,
  RoutingDecision,
} from '@webhook-verify/core';
import { ValidationError, IncompleteLabelsError } from '@webhook-verify/core';
import { RoutingConfigService } from '../../config/routing-config.service';
import { RunFeedbackService } from '../executor/run-feedback.service';

/**
 * Everything Linear-specific about dispatching: whether a webhook triggers a run
 * (shouldDispatch), which repo and skill it routes to (resolveRouting), and where user
 * feedback goes (postFeedback). Lives here, not in webhook-verify, because it needs
 * the dispatcher's routing config and feedback service.
 */
@Injectable()
export class LinearDispatchAdapter implements DispatchAdapter {
  readonly provider = 'linear';

  constructor(
    private readonly routingConfig: RoutingConfigService,
    private readonly feedback: RunFeedbackService,
  ) {}

  /**
   * Agent sessions and issue creates always dispatch; an issue update dispatches only if a
   * real field changed (a comment bumps only `updatedAt`, and would otherwise loop:
   * run -> comment -> webhook -> run); terminal issues are skipped when
   * policy.skipDoneIssues is set. Full rules: shouldTriggerDispatch in webhook-verify.
   */
  shouldDispatch(event: NormalizedEvent): DispatchDecision {
    if (event.kind === 'agent_session') {
      return { shouldDispatch: true, reason: 'agent session event' };
    }

    if (this.routingConfig.getPolicy().skipDoneIssues && event.isTerminal) {
      return {
        shouldDispatch: false,
        reason: 'issue state is terminal and policy.skipDoneIssues is enabled',
      };
    }

    if (event.action === 'create') {
      return { shouldDispatch: true, reason: 'issue created' };
    }

    if (event.action === 'update') {
      const changed = event.changedFields ?? [];
      if (changed.length > 0) {
        return { shouldDispatch: true, reason: `fields changed: ${changed.join(', ')}` };
      }
      return {
        shouldDispatch: false,
        reason: 'update changed no issue fields (e.g. a comment, which only bumps updatedAt)',
      };
    }

    return { shouldDispatch: false, reason: `unrecognized action: ${String(event.action)}` };
  }

  /**
   * Requires exactly one repo label and one mode label (`agent-<skill>`) among the issue's
   * labels. Throws ValidationError for fixable mistakes (posted back via postFeedback).
   */
  resolveRouting(event: NormalizedEvent): RoutingDecision {
    const labels = event.routingTags;
    const problems: string[] = [];
    let allIncomplete = true;

    const domainValidation = this.validateAndResolveDomainLabel(labels);
    if (domainValidation.error) {
      problems.push(domainValidation.error);
      allIncomplete &&= !!domainValidation.incomplete;
    }

    // Mode labels are per repo, so they're only checked once the repo label resolved.
    const repoLabel = domainValidation.repoLabel;
    const modeValidation = repoLabel ? this.validateModeLabels(labels, repoLabel) : {};

    if (modeValidation.error) {
      problems.push(modeValidation.error);
      allIncomplete &&= !!modeValidation.incomplete;
    }

    if (problems.length > 0) {
      const listItems = problems.map((p) => `- ${p}`).join('\n');

      // Missing labels are routine for issues still being triaged: stay silent. Conflicting
      // labels are mistakes and always get feedback.
      if (allIncomplete) {
        throw new IncompleteLabelsError(listItems);
      }

      throw new ValidationError(listItems);
    }

    const { repoPath } = domainValidation;
    const { modeLabel } = modeValidation;
    const skill = this.resolveSkill(repoLabel!, modeLabel!);

    return {
      repoLabel: repoLabel!,
      repoPath: repoPath!,
      skill,
      dedupeWindowMs: this.routingConfig.getPolicy().duplicateRunWindowMs,
    };
  }

  /** Tells the user what to fix: in the agent session when there is one, else on the issue. */
  async postFeedback(event: NormalizedEvent, message: string): Promise<void> {
    await this.feedback.needsInput({ issueId: event.issueId, sessionId: event.sessionId }, message);
  }

  private validateAndResolveDomainLabel(labels: string[]): {
    repoLabel?: string;
    repoPath?: string;
    error?: string;
    incomplete?: boolean;
  } {
    const validDomainLabels = this.routingConfig.getRepositoryLabels();
    const matchingDomainLabels = labels.filter((label) => validDomainLabels.includes(label));

    if (matchingDomainLabels.length === 0) {
      return {
        incomplete: true,
        error:
          `**Domain label (required)**: Add a System/Domain label to route this issue to a codebase. ` +
          `Your dispatcher supports: ${validDomainLabels.map((l) => `\`${l}\``).join(', ')}. ` +
          `Ensure the repo is registered (\`pnpm routes add <path>\`).`,
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
    const repoPath = this.routingConfig.getRepoPath(repoLabel);

    return { repoLabel, repoPath };
  }

  private validateModeLabels(
    labels: string[],
    repoLabel: string,
  ): { modeLabel?: string; error?: string; incomplete?: boolean } {
    const validModes = this.routingConfig.getValidModesForRepo(repoLabel);
    const validDomainLabels = this.routingConfig.getRepositoryLabels();

    // Filter out domain labels — mode labels must not be domain labels (separate namespaces)
    const nonDomainLabels = labels.filter((label) => !validDomainLabels.includes(label));

    const matchingModeLabels = nonDomainLabels.filter((label) => validModes.includes(label));

    if (matchingModeLabels.length === 0) {
      const availableModes = validModes.map((m) => `\`${m}\``).join(', ');
      return {
        incomplete: true,
        error:
          `**Mode label (required)**: Add exactly one mode label to specify which Claude skill to invoke. ` +
          `For repo \`${repoLabel}\`, the available modes are: ${availableModes}. ` +
          `Modes come from \`skills\` in routing.config.json (label \`agent-<name>\` runs \`/<name>\`).`,
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

  private resolveSkill(repoLabel: string, modeLabel: string): string {
    const skill = this.routingConfig.getSkillForMode(repoLabel, modeLabel);
    if (!skill) {
      throw new Error(
        `Mode '${modeLabel}' is not configured for repo '${repoLabel}'. ` +
          `Add the skill to \`skills\` in routing.config.json (see \`pnpm routes\`).`,
      );
    }
    return skill;
  }
}
