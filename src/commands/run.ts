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
    // Check if cascading should be disabled
    const shouldDisableCascading = !argv.autoCascadeEnv && !argv.cascadeEnv && !argv.cascadeNodeEnv;

    let childEnv: NodeJS.ProcessEnv;

    if (shouldDisableCascading) {
      // When cascading is disabled, we need to determine what variables to exclude
      // First, get what variables would be loaded if cascading was enabled
      const tempArgv = { ...argv, autoCascadeEnv: true };
      const wouldBeLoadedEnvVars = loadEnvironmentVariablesWithCache(tempArgv, process.cwd());

      // Create a clean environment by excluding the loaded variables
      childEnv = { ...process.env };
      for (const key of Object.keys(wouldBeLoadedEnvVars)) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete childEnv[key];
      }

      // Restore process.env with the loaded variables so they're available for this process
      for (const [key, value] of Object.entries(wouldBeLoadedEnvVars)) {
        if (value !== undefined) {
          process.env[key] = value;
        }
      }
    } else {
      // When cascading is enabled, load environment variables normally
      loadEnvironmentVariablesWithCache(argv, process.cwd());
      childEnv = { ...process.env };
    }

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
      env: childEnv,
    });
    process.exit(ret.status ?? 1);
  },
};
