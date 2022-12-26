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
  packagePath: {
    description: 'A directory path containing package.json',
    type: 'string',
    default: '.',
    alias: 'p',
  },
  firebaseJson: {
    description: 'A file path of firebase.json',
    type: 'string',
    alias: 'f',
  },
  'core-js': {
    description: 'Whether core-js is employed or not',
    type: 'boolean',
    default: true,
  },
} as const;

export const appBuilder: CommandModule<unknown, InferredOptionTypes<typeof builder>> = {
  command: 'app',
  describe: 'Build app',
  builder,
  async handler(argv) {
    const babelConfigFile = argv.coreJs ? 'babel.app.config.mjs' : 'babel.app-no-core-js.config.json';
    const extensions = ['.cjs', '.mjs', '.js', '.json', '.cts', '.mts', '.ts'];
    const plugins = [
      json(),
      externals({ deps: true, devDeps: false }),
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
    if (process.env.NODE_ENV === 'production') {
      plugins.push(terser());
    }

    let packageJsonPath = argv.packagePath;
    if (!packageJsonPath.endsWith('package.json')) {
      packageJsonPath = path.join(packageJsonPath, 'package.json');
    }
    const packageJsonText = await fs.promises.readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageJsonText);
    if (!packageJson.main) {
      console.error('Please add "main" property in package.json.');
      process.exit(1);
    }
    let outputFile = path.join(argv.packagePath, packageJson.main);

    const isFirebase = argv.firebaseJson && fs.existsSync(argv.firebaseJson);
    if (isFirebase) {
      const firebaseJsonText = await fs.promises.readFile(argv.firebaseJson, 'utf8');
      const firebaseJson = JSON.parse(firebaseJsonText);
      const packageDirPath = path.resolve(path.dirname(argv.firebaseJson), firebaseJson.functions.source);
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
        sourcemap: true,
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
    process.exit(buildFailed ? 1 : 0);
  },
};
