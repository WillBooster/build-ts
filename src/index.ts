import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { appBuilder } from './commands/appBuilder';

export async function cli(): Promise<void> {
  await yargs(hideBin(process.argv)).command(appBuilder).demandCommand().help().argv;
}
