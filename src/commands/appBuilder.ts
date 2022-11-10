import child_process from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { CommandModule, InferredOptionTypes } from 'yargs';

const builder = {
  command: {
    description: 'A build command',
    type: 'string',
    default: 'yarn build',
    alias: 'c',
  },
} as const;

export const appBuilder: CommandModule<unknown, InferredOptionTypes<typeof builder>> = {
  command: 'app',
  describe: 'Build app',
  builder,
  async handler(argv) {
    console.log(argv);
  },
};
