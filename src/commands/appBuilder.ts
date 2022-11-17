import { OutputOptions, rollup, RollupBuild, RollupOptions } from 'rollup';

import type { CommandModule, InferredOptionTypes } from 'yargs';
import fs from 'node:fs';
import path from 'node:path';

import { babel } from '@rollup/plugin-babel';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import { externals } from 'rollup-plugin-node-externals';
import { terser } from 'rollup-plugin-terser';

const builder = {
  input: {
    description: 'A file path of main source code',
    type: 'string',
    default: 'src/index.ts',
    alias: 'i',
  },
  packageJson: {
    description: 'A file path of package.json',
    type: 'string',
    default: 'package.json',
    alias: 'p',
  },
  firebaseJson: {
    description: 'A file path of firebase.json',
    type: 'string',
    default: 'firebase.json',
    alias: 'f',
  },
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
    const extensions = ['.cjs', '.mjs', '.js', '.json', '.cts', '.mts', '.ts'];
    const plugins = [
      json(),
      externals({ deps: true, devDeps: false }),
      resolve({ extensions }),
      commonjs(),
      babel({ extensions, babelHelpers: 'bundled', exclude: 'node_modules/**' }),
    ];
    // if (process.env.NODE_ENV === 'production') {
    //   plugins.push(terser());
    // }

    const packageJsonText = fs.readFileSync(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageJsonText);
    const mainFileName = packageJson.main.split('/')[1];

    const firebaseJsonText = fs.readFileSync(firebaseJsonPath, 'utf8');
    const firebaseJson = JSON.parse(firebaseJsonText);

    const options = {
      input: argv.input,
      output: {
        file: path.resolve(path.dirname(firebaseJsonPath), firebaseJson.functions.source, mainFileName),
        format: 'commonjs',
        sourcemap: true,
      },
      plugins,
    };

    let bundle: RollupBuild | undefined;
    let buildFailed = false;
    try {
      // create a bundle
      bundle = await rollup(inputOptions);

      // an array of file names this bundle depends on
      console.log(bundle.watchFiles);

      for (const outputOptions of outputOptions) {
        const output = await bundle.write(outputOptions);
        console.log(output);
      }
    } catch (error) {
      buildFailed = true;
      // do some error reporting
      console.error(error);
    }
    if (bundle) {
      // closes the bundle
      await bundle.close();
    }
    process.exit(buildFailed ? 1 : 0);
  },
};

// see below for details on these options
const inputOptions: RollupOptions = {};

// you can create multiple outputs from the same input to generate e.g.
// different formats like CommonJS and ESM
const outputOptions: OutputOptions[] = [{}, {}];

async function build(): Promise<void> {}
