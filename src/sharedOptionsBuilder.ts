import { yargsOptionsBuilderForEnv } from '@willbooster/shared-lib-node';

export const sharedOptionsBuilder = {
  ...yargsOptionsBuilderForEnv,
  silent: {
    description: 'Whether watch mode is enabled or not',
    type: 'boolean',
    alias: 's',
  },
} as const;
