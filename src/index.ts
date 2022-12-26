import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { appBuilder } from './commands/appBuilder.js';

await yargs(hideBin(process.argv)).command(appBuilder).demandCommand().help().argv;
