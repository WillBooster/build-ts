import { removeNpmAndYarnEnvironmentVariables } from '@willbooster/shared-lib-node';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { app, functions, lib } from './commands/build/build.js';
import { run } from './commands/run.js';
import { loadEnvironmentVariablesWithCache } from './env.js';
import { preprocessBuilder } from './preprocessBuilder.js';

await yargs(hideBin(process.argv))
  .scriptName('build-ts')
  .options(preprocessBuilder)
  .middleware((argv) => {
    removeNpmAndYarnEnvironmentVariables(process.env);
    loadEnvironmentVariablesWithCache(argv, process.cwd());
  })
  .command(app)
  .command(functions)
  .command(lib)
  .command(run)
  .demandCommand()
  .strict()
  .help().argv;
