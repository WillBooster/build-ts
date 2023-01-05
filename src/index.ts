import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { build } from './commands/build/build.js';
import { run } from './commands/run.js';

await yargs(hideBin(process.argv)).command(build).command(run).demandCommand().help().argv;
