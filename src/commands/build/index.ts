import fs from 'node:fs';
import path from 'node:path';

import { babel } from '@rollup/plugin-babel';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import terser from '@rollup/plugin-terser';
import { OutputOptions, Plugin, rollup, RollupBuild } from 'rollup';
import analyze from 'rollup-plugin-analyzer';
import { externals } from 'rollup-plugin-node-externals';
import { string } from 'rollup-plugin-string';
import ts from 'rollup-plugin-ts';
import { PackageJson } from 'type-fest';
import type { ArgumentsCamelCase, CommandModule, InferredOptionTypes } from 'yargs';

import { getBuildTsRootPath } from '../../pathUtil.js';

import { loadEnvironmentVariables } from './env.js';
import { builder } from './options.js';

export const index: CommandModule<unknown, InferredOptionTypes<typeof builder>> = {
  command: 'index [package]',
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
    const mainFile = packageJson.main;
    const packageDirPath = path.dirname(packageJsonPath);
    const inputFile = argv.input || path.join(packageDirPath, 'src', 'index.ts');
    if (argv.coreJs) {
      process.env.BUILD_TS_COREJS = '1';
    }
    if (argv.verbose) {
      process.env.BUILD_TS_VERBOSE = '1';
    }
    process.env.BUILD_TS_TARGET = argv.target;

    const [namespace, nameWithoutNamespace] = getNamespaceAndName(packageJson);
    const plugins = createPlugins(argv, packageJson, namespace);

    let outputOptions;
    if (argv.target === 'app') {
      if (!mainFile) {
        console.error('Please add "main" property always in package.json.');
        process.exit(1);
      }
      let outputFile = path.join(packageDirPath, mainFile);
      const isFirebase = argv.firebase && fs.existsSync(argv.firebase);
      if (isFirebase) {
        outputFile = await analyzeFirebaseJson(argv.firebase, outputFile, packageJson, mainFile);
      } else {
        await fs.promises.rm(path.dirname(outputFile), { recursive: true, force: true });
      }
      outputOptions = [createOutputOptionsForApp(argv, outputFile, packageJson)];
    } else {
      outputOptions = await createOutputOptionsForLibrary(argv, packageJson, nameWithoutNamespace);
    }
    if (outputOptions.length === 0) {
      console.error('Failed to detect output files.');
      process.exit(1);
    }

    process.chdir(packageDirPath);
    let bundle: RollupBuild | undefined;
    let buildFailed = false;
    try {
      const _bundle = await rollup({
        input: inputFile,
        plugins,
      });
      await Promise.all(outputOptions.map((opt) => _bundle.write(opt)));
      bundle = _bundle;
    } catch (error) {
      buildFailed = true;
      console.error('Filed to index due to:', error);
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
function createOutputOptionsForApp(
  argv: ArgumentsCamelCase<InferredOptionTypes<typeof builder>>,
  outputFile: string,
  packageJson: PackageJson
): OutputOptions {
  return {
    file: outputFile,
    format: packageJson?.type === 'module' ? 'module' : 'commonjs',
    sourcemap: argv.sourcemap,
  };
}

async function createOutputOptionsForLibrary(
  argv: ArgumentsCamelCase<InferredOptionTypes<typeof builder>>,
  packageJson: PackageJson,
  nameWithoutNamespace: string | undefined
): Promise<OutputOptions[]> {
  const outputOptions: OutputOptions[] = [];
  const promises: Promise<void>[] = [];
  const inputs = [
    [packageJson.main, 'commonjs'],
    [packageJson.module, 'module'],
  ] as const;
  for (const [file, format] of inputs) {
    if (!file) continue;

    promises.push(fs.promises.rm(path.dirname(file), { recursive: true, force: true }));
    outputOptions.push({
      dir: fixOutputDirForMonorepo(path.dirname(file), nameWithoutNamespace),
      entryFileNames: format === 'commonjs' ? '[name].cjs' : '[name].mjs',
      format,
      preserveModules: true,
      sourcemap: argv.sourcemap,
    });
  }
  await Promise.allSettled(promises);
  return outputOptions;
}

function fixOutputDirForMonorepo(dirPath: string, packageName?: string): string {
  if (!packageName) return dirPath;

  const index = dirPath.indexOf(packageName);
  if (index < 0) return dirPath;

  // e.g. dist/cjs/packageA/src/index.js -> dist/cjs
  return dirPath.slice(0, index);
}
