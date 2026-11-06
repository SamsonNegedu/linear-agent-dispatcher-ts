import { MAX_ERROR_MESSAGE_LENGTH } from './constants';

export interface ClaudeSpawnResult {
  status: 'succeeded' | 'failed' | 'needs_input' | 'cancelled';
  exitCode?: number;
  errorSnippet?: string;
  sessionId?: string;
  resultText?: string;
  totalCostUSD?: number;
}

// Field names are the Claude CLI's `result` event in `--output-format stream-json` (snake_case).
interface ClaudeOutput {
  type?: string;
  session_id?: string;
  result?: string;
  total_cost_usd?: number;
  stop_reason?: string;
  is_error?: boolean;
}

// A skill that must stop to ask something (nobody can answer an unattended run)
// begins its final reply with "Stop rule:". Tolerates leading markdown such as `**`.
const STOP_RULE_PATTERN = /^[\s*_`>#-]*Stop rule:/i;

export const isStopRuleReply = (text: string | undefined): boolean =>
  !!text && STOP_RULE_PATTERN.test(text);

const parseResultEvent = (stdout: string): ClaudeOutput | undefined => {
  const lines = stdout.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const event = JSON.parse(lines[i]) as ClaudeOutput;
      if (event.type === 'result') return event;
    } catch {
      // not a JSON line
    }
  }
  return undefined;
};

/** Turns a finished Claude process (exit code and captured output) into a run outcome. */
export const classifyExit = (input: {
  code: number | null;
  stdout: string;
  stderr: string;
  cancelled: boolean;
}): ClaudeSpawnResult => {
  const { code, stdout, stderr, cancelled } = input;
  const exitCode = code ?? undefined;
  const output = stdout ? parseResultEvent(stdout) : undefined;
  const sessionId = output?.session_id;
  const resultText = output?.result;
  const totalCostUSD = output?.total_cost_usd;
  const isError = output?.is_error ?? false;

  let errorSnippet = isError ? output?.result : undefined;
  if (!errorSnippet && stderr) {
    // Raw stderr: the actual error is usually last, so keep the end (curated messages
    // posted to Linear lead with the point and keep the start instead).
    errorSnippet = stderr.slice(-MAX_ERROR_MESSAGE_LENGTH);
  }

  if (cancelled) return { status: 'cancelled', exitCode, sessionId, totalCostUSD };

  if (code === 0 && !isError && isStopRuleReply(resultText)) {
    return {
      status: 'needs_input',
      exitCode,
      errorSnippet: resultText!.slice(0, MAX_ERROR_MESSAGE_LENGTH),
      sessionId,
      resultText,
      totalCostUSD,
    };
  }
  if (code === 0 && !isError) {
    return { status: 'succeeded', exitCode, sessionId, resultText, totalCostUSD };
  }
  return {
    status: 'failed',
    exitCode,
    errorSnippet: errorSnippet || `Process exited with code ${code} and produced no output`,
    sessionId,
    totalCostUSD,
  };
};
