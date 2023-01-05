import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { index } from './commands/build/index.js';
import { run } from './commands/run.js';

await yargs(hideBin(process.argv)).command(index).command(run).demandCommand().help().argv;
