import { yargsOptionsBuilderForEnv } from '@willbooster/shared-lib-node';

export const sharedOptionsBuilder = {
  ...yargsOptionsBuilderForEnv,
  silent: {
    description: 'Whether to suppress non-error output or not',
    type: 'boolean',
    alias: 's',
  },
} as const;
