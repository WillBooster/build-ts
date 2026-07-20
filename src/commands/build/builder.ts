import { sharedOptionsBuilder } from '../../sharedOptionsBuilder.js';

export const builder = {
  ...sharedOptionsBuilder,
  input: {
    description:
      'Paths or glob patterns (e.g. "src/**/*.ts") of source code files to be built. The first file is main. If no option is given, "src/index.{ts,tsx,cts,mts}" from package directory is targeted.',
    type: 'array',
    alias: 'i',
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
  outDir: {
    description: 'Output directory. Defaults to "dist" in the package directory.',
    type: 'string',
    alias: 'o',
  },
  inline: {
    description: 'Environment variables to be inlined.',
    type: 'array',
  },
  'auto-inline': {
    description: 'Inline environment variables defined at env files.',
    type: 'boolean',
    default: false,
  },
  watch: {
    description: 'Whether watch mode is enabled or not',
    type: 'boolean',
    alias: 'w',
  },
} as const;

export const appBuilder = {
  ...builder,
  moduleType: {
    description: 'esm, cjs, or either (default).',
    type: 'string',
    alias: 'm',
  },
} as const;

export const functionsBuilder = {
  ...appBuilder,
  onlyPackageJson: {
    description: 'Whether to generate only package.json.',
    type: 'boolean',
  },
} as const;

export const libBuilder = {
  ...builder,
  moduleType: {
    description: 'esm, cjs, either, or both (default).',
    type: 'string',
    alias: 'm',
  },
  declarationOnly: {
    description: 'Emit only declaration (.d.ts) files without bundling JavaScript.',
    type: 'boolean',
    default: false,
  },
} as const;

export type AnyBuilderType = typeof appBuilder | typeof functionsBuilder | typeof libBuilder;
