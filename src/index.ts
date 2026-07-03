import fs from 'node:fs';
import path from 'node:path';

import { removeNpmAndYarnEnvironmentVariables } from '@willbooster/shared-lib-node';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { app, functions, lib } from './commands/build/build.js';
import { run } from './commands/run.js';
import { sharedOptionsBuilder } from './sharedOptionsBuilder.js';
import { getBuildTsRootPath } from './utils.js';

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
  .version(getVersion())
  .help().argv;

function getVersion(): string {
  const packageJson = JSON.parse(fs.readFileSync(path.join(getBuildTsRootPath(), 'package.json'), 'utf8')) as {
    version: string;
  };
  return packageJson.version;
}
