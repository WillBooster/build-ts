import { loadEnvironmentVariables } from '@willbooster/shared-lib-node';

import type { builder } from './commands/build/builder.js';
import type { preprocessBuilder } from './preprocessBuilder.js';
import type { ArgumentsType } from './types.js';

let envVars: Record<string, string> | undefined;

/**
 * This function loads environment variables from `.env` files.
 * */
export function loadEnvironmentVariablesWithCache(
  argv: ArgumentsType<typeof preprocessBuilder>,
  cwd: string
): Record<string, string> {
  if (!envVars) {
    envVars = loadEnvironmentVariables(argv, cwd);
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
  const names = new Set(
    ...(argv.envVar ?? []).map((e) => e.toString()),
    ...Object.keys(loadEnvironmentVariablesWithCache(argv, cwd))
  );
  for (const name of names) {
    if (process.env[name] === undefined) continue;

    envVarsDef[`process.env.${name}`] = JSON.stringify(process.env[name]);
  }
  return envVarsDef;
}
