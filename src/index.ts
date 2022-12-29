import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { build } from './commands/build';
import { run } from './commands/run';

await yargs(hideBin(process.argv)).command(build).command(run).demandCommand().help().argv;
