import fs from 'node:fs';
import path from 'node:path';

import { babel } from '@rollup/plugin-babel';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import { rollup, RollupBuild } from 'rollup';
import { externals } from 'rollup-plugin-node-externals';
import { string } from 'rollup-plugin-string';
import type { CommandModule, InferredOptionTypes } from 'yargs';

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
      (json as any)(),
      externals({ deps: true, devDeps: false }),
      (resolve as any)({ extensions }),
      (commonjs as any)(),
      babel({ extensions, babelHelpers: 'bundled', exclude: 'node_modules/**' }),
      string({ include: ['**/*.csv', '**/*.txt'] }),
    ];
    if (process.env.NODE_ENV === 'production') {
      plugins.push((terser as any)());
    }

    const packageJsonText = fs.readFileSync(argv.packageJson, 'utf8');
    const packageJson = JSON.parse(packageJsonText);
    let outputFile = packageJson.main;

    const isFirebase = argv.firebaseJson && fs.existsSync(argv.firebaseJson);
    if (isFirebase) {
      const firebaseJsonText = fs.readFileSync(argv.firebaseJson, 'utf8');
      const firebaseJson = JSON.parse(firebaseJsonText);
      outputFile = path.resolve(
        path.dirname(argv.firebaseJson),
        firebaseJson.functions.source,
        path.basename(packageJson.main)
      );
    }

    const options = {
      input: argv.input,
      output: {
        file: outputFile,
        format: 'commonjs',
        sourcemap: true,
      },
      plugins,
    } as const;

    let bundle: RollupBuild | undefined;
    let buildFailed = false;
    try {
      const [_bundle] = await Promise.all([
        rollup(options),
        fs.promises.rm(path.dirname(outputFile), { recursive: true, force: true }),
      ]);
      bundle = _bundle;
      await bundle.write(options.output);
    } catch (error) {
      buildFailed = true;
      // do some error reporting
      console.error(error);
    }
    await bundle?.close();
    process.exit(buildFailed ? 1 : 0);
  },
};
