import * as path from 'path';
import dotenv from 'dotenv';
import { rootEnvFile } from '@linear-agent/env-file';

export const dispatcherDir = path.join(
  import.meta.dir,
  '..',
  '..',
  '..',
  '..',
  'services',
  'dispatcher-service',
);
const envPath = rootEnvFile(import.meta.dir);

// `override: true` is required here: dotenv normally refuses to overwrite keys
// already present in process.env, but this gets called again after
// connect-relay/update-relay rewrite the file on disk, and without override
// the stale in-memory values (e.g. RELAY_ENABLED) would never pick up the change.
export const loadEnv = (): void => {
  dotenv.config({ path: envPath, override: true });
};

loadEnv();
