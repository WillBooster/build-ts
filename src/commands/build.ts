import fs from 'node:fs';
import path from 'node:path';

import { babel } from '@rollup/plugin-babel';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import terser from '@rollup/plugin-terser';
import dotenv from 'dotenv';
import { OutputOptions, Plugin, rollup, RollupBuild } from 'rollup';
import analyze from 'rollup-plugin-analyzer';
import { externals } from 'rollup-plugin-node-externals';
import { string } from 'rollup-plugin-string';
import ts from 'rollup-plugin-ts';
import { PackageJson } from 'type-fest';
import type { CommandModule, InferredOptionTypes } from 'yargs';
import { ArgumentsCamelCase } from 'yargs';

import { getBuildTsRootPath } from '../pathUtil.js';

const builder = {
  target: {
    description: 'A target format: app or lib',
    type: 'string',
    require: true,
    alias: 't',
  },
  input: {
    description: 'A file path of main source code. Default value is "src/index.ts" from package directory.',
    type: 'string',
    alias: 'i',
  },
  firebase: {
    description: 'A file path of firebase.json.',
    type: 'string',
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

export const build: CommandModule<unknown, InferredOptionTypes<typeof builder>> = {
  command: 'build [package]',
  describe: 'Build a package',
  builder,
  async handler(argv) {
    if (argv.target !== 'app' && argv.target !== 'lib') {
      console.error('target option must be "app" or "lib"');
      process.exit(1);
    }

    let packageJsonPath = argv.package?.toString() ?? '.';
    if (!packageJsonPath.endsWith('package.json')) {
      packageJsonPath = path.resolve(packageJsonPath, 'package.json');
    }

    const packageJsonText = await fs.promises.readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageJsonText) as PackageJson;
    if (!packageJson || !packageJson.main) {
      console.error('Please add "main" property in package.json.');
      process.exit(1);
    }
    const mainFile = packageJson.main;
    const packageDirPath = path.dirname(packageJsonPath);
    const inputFile = argv.input || path.join(packageDirPath, 'src', 'index.ts');
    let outputFile = path.join(packageDirPath, mainFile);
    if (argv.coreJs) {
      process.env.BUILD_TS_COREJS = '1';
    }
    if (argv.verbose) {
      process.env.BUILD_TS_VERBOSE = '1';
    }
    process.env.BUILD_TS_TARGET = argv.target;

    const [namespace, nameWithoutNamespace] = getNamespaceAndName(packageJson);
    const plugins = createPlugins(argv, packageJson, namespace);

    const isFirebase = argv.target === 'app' && argv.firebase && fs.existsSync(argv.firebase);
    if (isFirebase) {
      outputFile = await analyzeFirebaseJson(argv.firebase, outputFile, packageJson, mainFile);
    }
    const outputOptions = createOutputOptions(argv, outputFile, packageJson, nameWithoutNamespace);

    process.chdir(packageDirPath);
    let bundle: RollupBuild | undefined;
    let buildFailed = false;
    try {
      const [_bundle] = await Promise.all([
        rollup({
          input: inputFile,
          plugins,
        }),
        !isFirebase && fs.promises.rm(path.dirname(outputFile), { recursive: true, force: true }),
      ]);
      await Promise.all(outputOptions.map((opt) => _bundle.write(opt)));
      bundle = _bundle;
    } catch (error) {
      buildFailed = true;
      console.error('Filed to build due to:', error);
    }
    await bundle?.close();
    if (buildFailed) process.exit(1);
  },
};

export function getNamespaceAndName(packageJson: PackageJson): [string | undefined, string | undefined] {
  const packageName = packageJson.name?.toString() || '';
  const match = /@([^/]+)\/(.+)/.exec(packageName);
  const [, namespace, name] = match || [];
  return [namespace, name];
}

function createPlugins(
  argv: ArgumentsCamelCase<InferredOptionTypes<typeof builder>>,
  packageJson: PackageJson,
  namespace: string | undefined
): Plugin[] {
  const externalDeps = [...(argv.external ?? [])].map((item) => item.toString());
  if (packageJson?.dependencies?.['@prisma/client']) {
    externalDeps.push('prisma-client');
  }

  const extensions = ['.cjs', '.mjs', '.js', '.jsx', '.json', '.cts', '.mts', '.ts', '.tsx'];

  const babelConfigPath = path.join(getBuildTsRootPath(), 'babel.config.mjs');

  const plugins: Plugin[] = [
    replace({
      delimiters: ['', ''],
      preventAssignment: true,
      values: loadEnvironmentVariables(argv),
    }),
    json(),
    externals({
      deps: true,
      devDeps: false,
      include: externalDeps,
      exclude: namespace && new RegExp(`${namespace}\\/.+`),
    }),
    resolve({ extensions }),
    commonjs(),
  ];
  if (argv.target === 'app') {
    plugins.push(
      babel({
        configFile: babelConfigPath,
        extensions,
        babelHelpers: 'bundled',
        exclude: 'node_modules/**',
      })
    );
  } else {
    plugins.push(
      ts({
        transpiler: 'babel',
        babelConfig: babelConfigPath,
      })
    );
  }
  plugins.push(string({ include: ['**/*.csv', '**/*.txt'] }));
  if (argv.minify) {
    plugins.push(terser());
  }
  plugins.push(analyze({ summaryOnly: true }));
  return plugins;
}

function loadEnvironmentVariables(
  argv: ArgumentsCamelCase<InferredOptionTypes<typeof builder>>
): Record<string, string> {
  const envVars: Record<string, string> = {};
  for (const name of (argv.env ?? []).map((e) => e.toString())) {
    if (process.env[name] === undefined) continue;

    envVars[`process.env.${name}`] = JSON.stringify(process.env[name]);
  }
  for (const dotenvPath of argv.dotenv ?? []) {
    const parsed = dotenv.config({ path: dotenvPath.toString() }).parsed || {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value === undefined) continue;

      envVars[`process.env.${key}`] = JSON.stringify(value);
    }
  }
  return envVars;
}
async function analyzeFirebaseJson(
  firebaseJsonPath: string,
  outputFile: string,
  packageJson: PackageJson,
  mainFile: string
): Promise<string> {
  const firebaseJsonText = await fs.promises.readFile(firebaseJsonPath, 'utf8');
  const firebaseJson = JSON.parse(firebaseJsonText);
  const packageDirPath = path.resolve(path.dirname(firebaseJsonPath), firebaseJson.functions.source);
  outputFile = path.join(packageDirPath, path.basename(mainFile));

  await fs.promises.rm(packageDirPath, { recursive: true, force: true });
  await fs.promises.mkdir(packageDirPath, { recursive: true });

  packageJson.name += '-dist';
  packageJson.main = path.relative(packageDirPath, outputFile);
  delete packageJson.devDependencies;
  await fs.promises.writeFile(path.join(packageDirPath, 'package.json'), JSON.stringify(packageJson));
  return outputFile;
}

function createOutputOptions(
  argv: ArgumentsCamelCase<InferredOptionTypes<typeof builder>>,
  outputFile: string,
  packageJson: PackageJson,
  nameWithoutNamespace: string | undefined
): OutputOptions[] {
  const outputOptions: OutputOptions[] = [];
  if (argv.target === 'app') {
    outputOptions.push({
      file: outputFile,
      format: path.extname(outputFile) === '.mjs' ? 'module' : 'commonjs',
      sourcemap: argv.sourcemap,
    });
  } else {
    const inputs = [
      [packageJson.main, path.extname(packageJson.main ?? '') === '.mjs' ? 'module' : 'commonjs'],
      [packageJson.module, 'module'],
    ] as const;
    for (const [file, format] of inputs) {
      if (!file) continue;

      outputOptions.push({
        dir: fixOutputDir(path.dirname(file), nameWithoutNamespace),
        format,
        preserveModules: true,
        sourcemap: argv.sourcemap,
      });
    }
  }
  return outputOptions;
}

function fixOutputDir(dirPath: string, packageName?: string): string {
  if (!packageName) return dirPath;

  const index = dirPath.indexOf(packageName);
  if (index < 0) return dirPath;

  return dirPath.slice(0, index);
}
