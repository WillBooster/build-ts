import * as child_process from 'node:child_process';

import type { CommandModule, InferredOptionTypes } from 'yargs';

import { loadEnvironmentVariablesWithCache } from '../env.js';
import { sharedOptionsBuilder } from '../sharedOptionsBuilder.js';

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

    const args: string[] = [];
    if (argv.watch) {
      args.push('--watch');
    }
    args.push('--import', 'tsx', file);
    const [, ...additionalArguments] = argv._;
    if (argv.verbose) {
      console.info(`Running 'node ${[...args, ...additionalArguments.map((arg) => arg.toString())].join(' ')}'`);
    }
    const ret = child_process.spawnSync('node', [...args, ...additionalArguments.map((arg) => arg.toString())], {
      stdio: 'inherit',
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
    process.exit(ret.status ?? 1);
  },
};
