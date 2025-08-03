import fs from 'node:fs';
import path from 'node:path';

import { removeNpmAndYarnEnvironmentVariables } from '@willbooster/shared-lib-node';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { app, functions, lib } from './commands/build/build.js';
import { run } from './commands/run.js';
import { sharedOptionsBuilder } from './sharedOptionsBuilder.js';

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
  let packageJsonDir = path.dirname(new URL(import.meta.url).pathname);
  while (!fs.existsSync(path.join(packageJsonDir, 'package.json'))) {
    packageJsonDir = path.dirname(packageJsonDir);
  }
  const packageJson = JSON.parse(fs.readFileSync(path.join(packageJsonDir, 'package.json'), 'utf8')) as {
    version: string;
  };
  return packageJson.version;
}
