import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { buildCommand } from './commands/buildCommand.js';
import { runCommand } from './commands/runCommand.js';

await yargs(hideBin(process.argv)).command(buildCommand).command(runCommand).demandCommand().help().argv;
