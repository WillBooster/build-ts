import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { functions, lib, node } from './commands/build/build.js';
import { run } from './commands/run.js';

await yargs(hideBin(process.argv))
  .command(node)
  .command(functions)
  .command(lib)
  .command(run)
  .demandCommand()
  .strict()
  .help().argv;
