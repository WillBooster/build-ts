import { preprocessBuilder } from '../../preprocessBuilder.js';

export const builder = {
  ...preprocessBuilder,
  input: {
    description:
      'Paths of source code files to be built. The first file is main. If no option is given, "src/index.{ts,tsx}" from package directory is targeted.',
    type: 'array',
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
  'env-var': {
    description: 'Environment variables to be inlined.',
    type: 'array',
    alias: 'ev',
  },
  watch: {
    description: 'Whether watch mode is enabled or not',
    type: 'boolean',
    alias: 'w',
  },
  keepImport: {
    description: 'Identifiers to be kept as import statements.',
    type: 'array',
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
  // .js files in a package with `"type": "module"` are treated as esm.
  // However, we want to treat them as cjs in the case where a cjs project imports an esm package.
  // To deal with the case, we use .cjs and .mjs extensions instead of .js extension.
  jsExtension: {
    description: 'Whether to use .js in cjs and/or esm: either (default), both, or none.',
    type: 'string',
    alias: 'j',
  },
} as const;

export type AnyBuilderType = typeof appBuilder | typeof functionsBuilder | typeof libBuilder;
