export const preprocessBuilder = {
  env: {
    description: '.env files to be loaded.',
    type: 'array',
  },
  'cascade-env': {
    description:
      'environment to load cascading .env files (e.g., `.env`, `.env.<environment>`, `.env.local` and `.env.<environment>.local`)',
    type: 'string',
  },
  'cascade-node-env': {
    description:
      'environment to load cascading .env files (e.g., `.env`, `.env.<NODE_ENV>`, `.env.local` and `.env.<NODE_ENV>.local`). Preferred over `cascade`.',
    type: 'boolean',
  },
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
