import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { app, functions, lib } from './commands/build/build.js';
import { run } from './commands/run.js';

// cf. https://stackoverflow.com/a/73525885
const emit = process.emit;
process.emit = function (name: string, data: any) {
  if (name === `warning` && typeof data === `object` && data.name === `ExperimentalWarning`) {
    return false;
  }
  // eslint-disable-next-line prefer-rest-params
  return emit.apply(process, arguments as any);
} as any;

await yargs(hideBin(process.argv))
  .scriptName('build-ts')
  .command(app)
  .command(functions)
  .command(lib)
  .command(run)
  .demandCommand()
  .strict()
  .help().argv;
