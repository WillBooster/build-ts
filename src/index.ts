import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { app, functions, lib } from './commands/build/build.js';
import { run } from './commands/run.js';

await yargs(hideBin(process.argv))
  .command(app)
  .command(functions)
  .command(lib)
  .command(run)
  .demandCommand()
  .strict()
  .help().argv;
