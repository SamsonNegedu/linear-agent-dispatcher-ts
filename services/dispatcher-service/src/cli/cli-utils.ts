import { join } from 'path';
import { parseArgs, type ParseArgsConfig } from 'util';
import { errorMessage } from '../common/error-message';

/** A failure whose message is the whole story (bad flags, missing file): no stack, exit 1. */
export class CliError extends Error {}

/** The dispatcher's local env file; CLIs run from services/dispatcher-service. */
export const envFilePath = (): string => join(process.cwd(), '.env.local');

/**
 * Parses `--flag=value` / `--flag value`. A leading bare `--` (what `pnpm script -- --flag`
 * passes through) is dropped so the flags after it still count.
 */
export function parseFlags<T extends NonNullable<ParseArgsConfig['options']>>(
  options: T,
  argv: string[] = process.argv.slice(2),
  allowPositionals = false,
) {
  try {
    return parseArgs({
      args: argv[0] === '--' ? argv.slice(1) : argv,
      options,
      allowPositionals,
    });
  } catch (error) {
    throw new CliError(errorMessage(error));
  }
}

/** Runs a CLI entry point: prints the error and exits 1 on failure. */
export function runCli(main: () => Promise<void> | void): void {
  Promise.resolve()
    .then(main)
    .catch((error: unknown) => {
      console.error(error instanceof CliError ? error.message : `Error: ${errorMessage(error)}`);
      process.exit(1);
    });
}
