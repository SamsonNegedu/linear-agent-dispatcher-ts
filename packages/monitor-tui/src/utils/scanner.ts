import type { Palette } from '../theme';
import type { ScanOutcome, ScannerReport } from '../types';

export const OUTCOME_LABEL: Record<ScanOutcome, string> = {
  dispatched: 'STARTED',
  active: 'ACTIVE',
  done: 'DONE',
  needs_input: 'INPUT',
  exhausted: 'GAVE UP',
  waiting: 'WAITING',
  skipped: 'SKIPPED',
  cancelled: 'STOPPED',
  closed: 'CLOSED',
};

export const outcomeColor = (colors: Palette, outcome: ScanOutcome): string =>
  ({
    dispatched: colors.running,
    active: colors.running,
    done: colors.succeeded,
    needs_input: colors.needs_input,
    exhausted: colors.failed,
    waiting: colors.pending,
    skipped: colors.muted,
    cancelled: colors.cancelled,
    closed: colors.muted,
  })[outcome];

/** One line per thing on screen: a scope header, a watch header, or an issue. */
export type ScannerRow =
  | { kind: 'scope'; text: string; slots: string; error?: string }
  | { kind: 'watch'; text: string }
  | {
      kind: 'issue';
      identifier: string;
      title: string;
      skill?: string;
      outcome: ScanOutcome;
      detail?: string;
    }
  | { kind: 'empty'; text: string }
  | { kind: 'gap' };

export const scannerRows = (report: ScannerReport): ScannerRow[] =>
  report.scopes.flatMap((scope, scopeIndex): ScannerRow[] => [
    ...(scopeIndex > 0 ? [{ kind: 'gap' as const }] : []),
    {
      kind: 'scope' as const,
      text: scope.name,
      slots: `${scope.inFlight}/${scope.maxConcurrent} running`,
      error: scope.error,
    },
    ...scope.watches.flatMap((watch): ScannerRow[] => [
      { kind: 'gap' as const },
      { kind: 'watch' as const, text: `${watch.label} in ${watch.states.join(', ')}` },
      ...(watch.issues.length === 0
        ? [{ kind: 'empty' as const, text: 'nothing matches right now' }]
        : watch.issues.map((issue) => ({ kind: 'issue' as const, ...issue }))),
    ]),
  ]);

/** Issues that need a person: out of attempts, or waiting on an answer. */
export const scannerAttention = (report: ScannerReport): number =>
  report.scopes
    .flatMap((scope) => scope.watches.flatMap((watch) => watch.issues))
    .filter((issue) => issue.outcome === 'exhausted' || issue.outcome === 'needs_input').length;

/** Runs the scanner has going right now, across scopes. */
export const scannerInFlight = (report: ScannerReport): number =>
  report.scopes.reduce((sum, scope) => sum + scope.inFlight, 0);

/** "last scan 12s ago (230ms) · next in 48s", or why there is none yet. */
export const scanTiming = (report: ScannerReport, now: number): string => {
  if (!report.lastScanAt) return 'no scan yet';
  const last = new Date(report.lastScanAt).getTime();
  const seconds = Math.max(0, Math.round((now - last) / 1000));
  const took = report.durationMs === undefined ? '' : ` (${report.durationMs}ms)`;
  const next =
    report.intervalSec === undefined
      ? ''
      : ` · next in ${Math.max(0, report.intervalSec - seconds)}s`;
  return `last scan ${seconds}s ago${took}${next}`;
};

export const scannerText = (report: ScannerReport): string =>
  report.enabled
    ? scannerRows(report)
        .filter((row) => row.kind !== 'gap')
        .map((row) =>
          row.kind === 'scope'
            ? `${row.text}  ${row.slots}${row.error ? `  ERROR: ${row.error}` : ''}`
            : row.kind === 'watch'
              ? `  ${row.text}`
              : row.kind === 'empty'
                ? `    ${row.text}`
                : `    ${row.identifier}\t${row.title}\t${row.skill ? `/${row.skill}` : '—'}\t${OUTCOME_LABEL[row.outcome]}${row.detail ? ` (${row.detail})` : ''}`,
        )
        .join('\n')
    : 'Scanner is off. Add a "scanner" block to routing.config.json.';
