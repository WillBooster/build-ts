import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { app, functions, lib } from './commands/build/build.js';
import { run } from './commands/run.js';
import { loadEnvironmentVariables } from './env.js';
import { preprocessBuilder } from './preprocessBuilder.js';

await yargs(hideBin(process.argv))
  .scriptName('build-ts')
  .options(preprocessBuilder)
  .middleware((argv) => {
    // Remove npm & yarn environment variables from process.env
    for (const key of Object.keys(process.env)) {
      const lowerKey = key.toLowerCase();
      if (lowerKey.startsWith('npm_') || lowerKey.startsWith('yarn_') || lowerKey.startsWith('berry_')) {
        delete process.env[key];
      }
    }

    loadEnvironmentVariables(argv, process.cwd());
  })
  .command(app)
  .command(functions)
  .command(lib)
  .command(run)
  .demandCommand()
  .strict()
  .help().argv;
