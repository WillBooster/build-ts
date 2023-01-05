import dotenv from 'dotenv';
import { ArgumentsCamelCase, InferredOptionTypes } from 'yargs';

import { builder } from './options.js';

export function loadEnvironmentVariables(
  argv: ArgumentsCamelCase<InferredOptionTypes<typeof builder>>
): Record<string, string> {
  const envVars: Record<string, string> = {};
  for (const name of (argv.env ?? []).map((e) => e.toString())) {
    if (process.env[name] === undefined) continue;

    envVars[`process.env.${name}`] = JSON.stringify(process.env[name]);
  }
  for (const dotenvPath of argv.dotenv ?? []) {
    const parsed = dotenv.config({ path: dotenvPath.toString() }).parsed || {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value === undefined) continue;

      envVars[`process.env.${key}`] = JSON.stringify(value);
    }
  }
  return envVars;
}
