import dotenv from 'dotenv';
import { rootEnvFile } from '@linear-agent/env-file';

// One env file for the whole repo. Variables already in the environment win, so
// `pnpm dev:up` can set per-process values such as PORT and RELAY_BASE_URL.
dotenv.config({ path: rootEnvFile() });
