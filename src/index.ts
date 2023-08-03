import { removeNpmAndYarnEnvironmentVariables } from '@willbooster/shared-lib-node';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { app, functions, lib } from './commands/build/build.js';
import { run } from './commands/run.js';
import { sharedOptionsBuilder } from './sharedOptionsBuilder.js';

removeNpmAndYarnEnvironmentVariables(process.env);

await yargs(hideBin(process.argv))
  .scriptName('build-ts')
  .options(sharedOptionsBuilder)
  .command(app)
  .command(functions)
  .command(lib)
  .command(run)
  .demandCommand()
  .strict()
  .help().argv;
