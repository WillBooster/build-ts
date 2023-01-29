export const builder = {
  input: {
    description: 'A file path of main source code. Default value is "src/index.{ts,tsx}" from package directory.',
    type: 'string',
    alias: 'i',
  },
  'core-js': {
    description: 'Whether or not core-js is employed.',
    type: 'boolean',
    default: false,
  },
  minify: {
    description: 'Whether or not minification is enabled.',
    type: 'boolean',
    default: true,
  },
  sourcemap: {
    description: 'Whether or not sourcemap is enabled.',
    type: 'boolean',
    default: true,
  },
  external: {
    description: 'Additional external dependencies.',
    type: 'array',
  },
  verbose: {
    description: 'Whether or not verbose mode is enabled.',
    type: 'boolean',
    alias: 'v',
  },
  env: {
    description: 'Environment variables to be inlined.',
    type: 'array',
    alias: 'e',
  },
  dotenv: {
    description: '.env files to be inlined.',
    type: 'array',
  },
} as const;

export const appBuilder = {
  ...builder,
  moduleType: {
    description: 'esm or cjs. Automatically detected by default.',
    type: 'string',
    alias: 'm',
  },
} as const;
