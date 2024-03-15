import { readAndApplyEnvironmentVariables } from '@willbooster/shared-lib-node';

import type { builder } from './commands/build/builder.js';
import type { sharedOptionsBuilder } from './sharedOptionsBuilder.js';
import type { ArgumentsType } from './types.js';

let envVars: Record<string, string | undefined> | undefined;

/**
 * This function loads environment variables from `.env` files.
 * */
export function loadEnvironmentVariablesWithCache(
  argv: ArgumentsType<typeof sharedOptionsBuilder>,
  cwd: string
): Record<string, string | undefined> {
  if (!envVars) {
    envVars = readAndApplyEnvironmentVariables(argv, cwd);
    if (argv.verbose) {
      console.info('Loaded env vars:', Object.keys(envVars));
    }
  }
  return envVars;
}

/**
 * This function creates a definition of environment variables that will be injected into the build.
 * */
export function createEnvironmentVariablesDefinition(
  argv: ArgumentsType<typeof builder>,
  cwd: string
): Record<string, string> {
  const envVarsDef: Record<string, string> = {};
  const names = new Set([
    ...(argv.inline ?? []).flatMap((e) => e.toString().split(',')),
    ...Object.keys(loadEnvironmentVariablesWithCache(argv, cwd)),
  ]);
  for (const name of names) {
    if (process.env[name] === undefined) continue;

    envVarsDef[`process.env.${name}`] = JSON.stringify(process.env[name]);
  }
  if (argv.verbose) {
    console.info('Inline env vars:', Object.keys(envVarsDef));
  }
  return envVarsDef;
}
