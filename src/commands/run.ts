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
  handler(argv) {
    loadEnvironmentVariablesWithCache(argv, process.cwd());

    const file = argv.file?.toString() ?? '';

    // cf. https://bun.sh/guides/util/detect-bun
    const isRunningOnBun = process.versions.bun;
    const runtime = isRunningOnBun ? 'bun' : 'node';
    const args = isRunningOnBun ? ['--bun'] : ['--no-warnings', '--import', 'tsx'];
    if (argv.watch) {
      args.push('--watch');
    }
    args.push(file);
    const [, ...additionalArguments] = argv._;
    const runtimeArgs = [...args, ...additionalArguments.map((arg) => arg.toString())];
    if (argv.verbose) {
      console.info(`Running '${runtime} ${runtimeArgs.join(' ')}'`);
    }
    const ret = child_process.spawnSync(runtime, runtimeArgs, {
      stdio: 'inherit',
      env: { ...process.env },
    });
    process.exit(ret.status ?? 1);
  },
};
