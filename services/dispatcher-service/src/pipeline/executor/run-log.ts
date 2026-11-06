import { createWriteStream, mkdirSync } from 'fs';
import { join } from 'path';

// One file per run, written live so `tail -f` shows progress. Never breaks the run.
export const openRunLog = (issueIdentifier: string, skill: string) => {
  try {
    const dir = join(process.cwd(), 'logs', 'runs');
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = join(dir, `${issueIdentifier}__${skill}__${stamp}.log`);
    const stream = createWriteStream(file, { flags: 'a' });
    stream.on('error', () => undefined);
    return { file, stream };
  } catch {
    return undefined;
  }
};
