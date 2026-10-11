import { Injectable } from '@nestjs/common';
import type {
  DispatchAdapter,
  DispatchDecision,
  NormalizedEvent,
  RoutingDecision,
} from '@webhook-verify/core';
import { ValidationError, IncompleteLabelsError } from '@webhook-verify/core';
import { RoutingConfigService } from '../../config/routing-config.service';
import { ActivityNotifierService } from '../executor/activity-notifier.service';
import { IssueCommentService } from '../executor/issue-comment.service';

// Mode labels determine which Claude skill to invoke for an issue. Teams
// define their own mode labels in routing.config.json (any naming
// convention is allowed), e.g. agent-implement, ready-for-agent, skill-test.

/**
 * Quarantines everything Linear-specific about deciding whether/how to
 * dispatch a run: Linear's action/state model (shouldDispatch), its
 * label-based routing convention (resolveRouting), and its two feedback
 * channels — agent session activity vs. issue comment (postFeedback).
 * Depends on dispatcher-service-local config and API clients, so it's
 * DI-wired here rather than living in the shared webhook-verify package.
 */
@Injectable()
export class LinearDispatchAdapter implements DispatchAdapter {
  readonly provider = 'linear';

  constructor(
    private readonly routingConfig: RoutingConfigService,
    private readonly activityNotifier: ActivityNotifierService,
    private readonly issueComments: IssueCommentService,
  ) {}

  /**
   * Explicit rules, in order:
   * 1. Agent session events always dispatch. A human interacting with an
   *    agent session in Linear's UI is itself the trigger.
   * 2. Issue "create" events always dispatch. There is no prior state on a
   *    create event — the issue's initial fields aren't a "change" to react to.
   * 3. Issue "update" events dispatch if `changedFields` is non-empty, i.e. at
   *    least one real field on the issue changed (labels, delegate, state,
   *    assignee, anything). Linear fires an "Issue update" webhook for *any*
   *    field change, including a side effect of posting a comment — which
   *    bumps only `updatedAt` and touches no other field. Without this check,
   *    our own progress/success comment would re-trigger a run indefinitely:
   *    run -> comment -> webhook -> run -> ...
   * 4. Terminal issues (Done/Canceled) never dispatch when policy.skipDoneIssues
   *    is enabled, even if a trigger field changed in the same webhook.
   * 5. Anything else (unrecognized action) does not dispatch.
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
   * Validates issue labels for webhook dispatch. Requires exactly one domain
   * label (repo routing) and one mode label (skill selection). Domain and
   * mode labels are in separate namespaces to prevent collisions. Throws
   * ValidationError for expected failures (posted as feedback via postFeedback).
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

    // Validate mode label (needs repo context to know which modes are valid). Skipped
    // entirely when the domain label itself isn't resolved yet — with no repo to check
    // modes against, a synthetic placeholder error would only be noise on top of the
    // domain problem already reported above.
    const repoLabel = domainValidation.repoLabel;
    const modeValidation = repoLabel ? this.validateModeLabels(labels, repoLabel) : {};

    if (modeValidation.error) {
      problems.push(modeValidation.error);
      allIncomplete &&= !!modeValidation.incomplete;
    }

    if (problems.length > 0) {
      const listItems = problems.map((p) => `- ${p}`).join('\n');

      // Missing domain/mode labels (not yet set) are a routine, frequent state for
      // issues still being triaged — not a misconfiguration — so handle silently
      // instead of posting feedback on every relabel/update. Conflicts (multiple
      // domain or mode labels) are genuine mistakes and always get feedback.
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

  /**
   * Routes error notification based on webhook type:
   * - Agent sessions: post activity (rich, structured feedback in session timeline)
   * - Issue webhooks: post comment (plain feedback on issue thread)
   */
  async postFeedback(event: NormalizedEvent, message: string): Promise<void> {
    if (event.sessionId) {
      await this.activityNotifier.postElicitation(event.sessionId, message);
    } else if (event.issueId) {
      await this.issueComments.postRequired(event.issueId, message);
    }
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
