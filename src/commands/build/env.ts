import path from 'node:path';

import dotenv from 'dotenv';

import type { ArgumentsType } from '../../types.js';

import type { builder } from './builder.js';

export function loadEnvironmentVariables(argv: ArgumentsType<typeof builder>, cwd: string): Record<string, string> {
  const envVars: Record<string, string> = {};
  for (const name of (argv.env ?? []).map((e) => e.toString())) {
    if (process.env[name] === undefined) continue;

    envVars[`process.env.${name}`] = JSON.stringify(process.env[name]);
  }
  for (const dotenvPath of (argv.dotenv ?? []).map((e) => e.toString())) {
    const parsed = dotenv.config({ path: path.join(cwd, dotenvPath) }).parsed || {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value === undefined) continue;

      envVars[`process.env.${key}`] = JSON.stringify(value);
    }
  }
  return envVars;
}
