import { yargsOptionsBuilderForEnv } from '@willbooster/shared-lib-node';

export const sharedOptionsBuilder = {
  ...yargsOptionsBuilderForEnv,
  verbose: {
    description: 'Whether or not verbose mode is enabled.',
    type: 'boolean',
    alias: 'v',
  },
  silent: {
    description: 'Whether watch mode is enabled or not',
    type: 'boolean',
    alias: 's',
  },
} as const;
