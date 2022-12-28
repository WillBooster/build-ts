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

import { getBuildTsRootPath } from '../pathUtil.js';

const builder = {
  input: {
    description: 'A file path of main source code',
    type: 'string',
    default: 'src/index.ts',
    alias: 'i',
  },
  firebase: {
    description: 'A file path of firebase.json',
    type: 'string',
    alias: 'f',
  },
  'core-js': {
    description: 'Whether core-js is employed or not',
    type: 'boolean',
    default: true,
  },
  minify: {
    description: 'Whether minification is enabled or not.',
    type: 'boolean',
    default: true,
  },
  sourcemap: {
    description: 'Whether sourcemap is enabled or not',
    type: 'boolean',
    default: true,
  },
  external: {
    description: 'Additional external dependencies',
    type: 'array',
  },
} as const;

export const buildCommand: CommandModule<unknown, InferredOptionTypes<typeof builder>> = {
  command: 'build [package]',
  describe: 'Build a package',
  builder,
  async handler(argv) {
    let packageJsonPath = argv.package?.toString() ?? '.';
    if (!packageJsonPath.endsWith('package.json')) {
      packageJsonPath = path.join(packageJsonPath, 'package.json');
    }
    const packageJsonText = await fs.promises.readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageJsonText);
    if (!packageJson || !packageJson.main) {
      console.error('Please add "main" property in package.json.');
      process.exit(1);
    }
    let outputFile = path.join(path.dirname(packageJsonPath), packageJson.main);

    const externalDeps = [...(argv.external ?? [])].map((item) => item.toString());
    if (packageJson?.dependencies?.['@prisma/client']) {
      externalDeps.push('prisma-client');
    }

    const babelConfigFile = argv.coreJs ? 'babel.app.config.mjs' : 'babel.app-no-core-js.config.json';
    const extensions = ['.cjs', '.mjs', '.js', '.json', '.cts', '.mts', '.ts'];
    const plugins = [
      json(),
      externals({ deps: true, devDeps: false, include: externalDeps }),
      resolve({ extensions }),
      commonjs(),
      babel({
        configFile: path.join(getBuildTsRootPath(), babelConfigFile),
        extensions,
        babelHelpers: 'bundled',
        exclude: 'node_modules/**',
      }),
      string({ include: ['**/*.csv', '**/*.txt'] }),
    ];
    if (argv.minify) {
      plugins.push(terser());
    }

    const isFirebase = argv.firebase && fs.existsSync(argv.firebase);
    if (isFirebase) {
      const firebaseJsonText = await fs.promises.readFile(argv.firebase, 'utf8');
      const firebaseJson = JSON.parse(firebaseJsonText);
      const packageDirPath = path.resolve(path.dirname(argv.firebase), firebaseJson.functions.source);
      outputFile = path.resolve(packageDirPath, path.basename(packageJson.main));

      await fs.promises.rm(packageDirPath, { recursive: true, force: true });
      await fs.promises.mkdir(packageDirPath, { recursive: true });

      packageJson.name += '-dist';
      packageJson.main = path.relative(packageDirPath, outputFile);
      delete packageJson.devDependencies;
      await fs.promises.writeFile(path.join(packageDirPath, 'package.json'), JSON.stringify(packageJson));
    }

    const options = {
      input: argv.input,
      output: {
        file: outputFile,
        format: path.extname(outputFile) === '.mjs' ? 'module' : 'commonjs',
        sourcemap: argv.sourcemap,
      },
      plugins,
    } as const;

    let bundle: RollupBuild | undefined;
    let buildFailed = false;
    try {
      const [_bundle] = await Promise.all([
        rollup(options),
        !isFirebase && fs.promises.rm(path.dirname(outputFile), { recursive: true, force: true }),
      ]);
      bundle = _bundle;
      await bundle.write(options.output);
    } catch (error) {
      buildFailed = true;
      console.error('Filed to build due to:', error);
    }
    await bundle?.close();
    if (buildFailed) process.exit(1);
  },
};
