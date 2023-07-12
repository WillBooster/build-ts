import path from 'node:path';

import { config } from 'dotenv';

import type { builder } from './commands/build/builder.js';
import type { preprocessBuilder } from './preprocessBuilder.js';
import type { ArgumentsType } from './types.js';

let envVars: Record<string, string> | undefined;

export function loadEnvironmentVariables(
  argv: ArgumentsType<typeof preprocessBuilder>,
  cwd: string
): Record<string, string> {
  if (envVars) return envVars;

  let envPaths = (argv.env ?? []).map((envPath) => envPath.toString());
  const cascade = argv.nodeEnv ? process.env.NODE_ENV : argv.cascade;
  if (typeof cascade === 'string') {
    if (envPaths.length === 0) envPaths.push('.env');
    envPaths = envPaths.flatMap((envPath) =>
      cascade
        ? [`${envPath}.${cascade}.local`, `${envPath}.local`, `${envPath}.${cascade}`, envPath]
        : [`${envPath}.local`, envPath]
    );
  }
  if (argv.verbose) {
    console.info('Loading env files:', envPaths);
  }
  envVars = {};
  for (const envPath of envPaths) {
    envVars = { ...config({ path: path.join(cwd, envPath) }).parsed, ...envVars };
  }
  return envVars;
}

export function createEnvironmentVariablesDefinition(
  argv: ArgumentsType<typeof builder>,
  cwd: string
): Record<string, string> {
  const envVarsDef: Record<string, string> = {};
  const names = new Set(
    ...(argv.envVar ?? []).map((e) => e.toString()),
    ...Object.keys(loadEnvironmentVariables(argv, cwd))
  );
  for (const name of names) {
    if (process.env[name] === undefined) continue;

    envVarsDef[`process.env.${name}`] = JSON.stringify(process.env[name]);
  }
  return envVarsDef;
}
