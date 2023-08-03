import * as child_process from 'node:child_process';
import path from 'node:path';

import type { CommandModule, InferredOptionTypes } from 'yargs';

import { loadEnvironmentVariablesWithCache } from '../env.js';
import { sharedOptionsBuilder } from '../sharedOptionsBuilder.js';
import { readPackageJson } from '../utils.js';

const builder = {
  ...sharedOptionsBuilder,
  module: {
    description: 'A module type: cjs or esm',
    type: 'string',
    alias: 'm',
  },
  watch: {
    description: 'Whether watch mode is enabled or not',
    type: 'boolean',
    alias: 'w',
  },
} as const;

export const run: CommandModule<unknown, InferredOptionTypes<typeof builder>> = {
  command: 'run <file>',
  describe: 'Run script',
  builder,
  async handler(argv) {
    loadEnvironmentVariablesWithCache(argv, process.cwd());

    const file = argv.file?.toString() || '';
    const module = await detectModuleType(file, argv.module);

    const args: string[] = [];
    if (argv.watch) {
      args.push('--watch');
    }
    if (module === 'cjs') {
      args.push('--require', 'build-ts/register');
    } else {
      args.push('--loader', 'build-ts/loader');
    }
    args.push(file);
    const [, ...additionalArguments] = argv._;
    const ret = child_process.spawnSync('node', [...args, ...additionalArguments.map((arg) => arg.toString())], {
      stdio: 'inherit',
      env: { ...process.env, NODE_NO_WARNINGS: '1', TS_NODE_TRANSPILE_ONLY: '1' },
    });
    process.exit(ret.status ?? 1);
  },
};

async function detectModuleType(file: string, module?: string): Promise<'cjs' | 'esm'> {
  if (module === 'cjs' || file.endsWith('.cts')) {
    return 'cjs';
  }
  if (module === 'esm' || file.endsWith('.mts')) {
    return 'esm';
  }

  let dirPath = path.dirname(file);
  for (;;) {
    const packageJson = await readPackageJson(dirPath);
    if (packageJson) {
      if (packageJson.type === 'module') {
        return 'esm';
      }
      break;
    }

    const nextDirPath = path.dirname(dirPath);
    if (!nextDirPath || nextDirPath === dirPath) {
      break;
    }
    dirPath = nextDirPath;
  }
  return 'cjs';
}
