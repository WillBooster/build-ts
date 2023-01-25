import fs from 'node:fs';
import path from 'node:path';

import { OutputOptions, rollup, RollupBuild } from 'rollup';
import type { CommandModule, InferredOptionTypes } from 'yargs';

import { getNamespaceAndName, readPackageJson } from '../../utils.js';

import { builder } from './builder.js';
import { createPlugins } from './plugin.js';

export const node: CommandModule<unknown, InferredOptionTypes<typeof builder>> = {
  command: 'node [package]',
  describe: 'Build a Node.js app',
  builder,
  async handler(argv) {
    return build(argv, 'node', argv.package);
  },
};

export const functions: CommandModule<unknown, InferredOptionTypes<typeof builder>> = {
  command: 'functions [package]',
  describe: 'Build a GCP/Firebase functions app',
  builder,
  async handler(argv) {
    return build(argv, 'functions', argv.package);
  },
};

export const lib: CommandModule<unknown, InferredOptionTypes<typeof builder>> = {
  command: 'node [package]',
  describe: 'Build a library',
  builder,
  async handler(argv) {
    return build(argv, 'lib', argv.package);
  },
};

export async function build(
  argv: InferredOptionTypes<typeof builder>,
  target: Target,
  relativePackageDirPath?: unknown
): Promise<void> {
  const cwd = process.cwd();

  if (target !== 'node' && target !== 'lib' && target !== 'functions') {
    console.error('target option must be "app", "lib" or "functions"');
    process.exit(1);
  }

  const packageDirPath = path.resolve(relativePackageDirPath?.toString() ?? '.');
  const packageJson = await readPackageJson(packageDirPath);
  if (!packageJson) {
    console.error('Failed to parse package.json');
    process.exit(1);
  }
  const [namespace] = getNamespaceAndName(packageJson);
  const isEsm = packageJson.type === 'module';

  if (argv['core-js']) {
    process.env.BUILD_TS_COREJS = '1';
  }
  if (argv.verbose) {
    process.env.BUILD_TS_VERBOSE = '1';
  }
  process.env.BUILD_TS_TARGET = target;

  let outputOptionsList: OutputOptions[];
  if (target === 'node' || target === 'functions') {
    packageJson.main = isEsm ? 'index.mjs' : 'index.cjs';
    outputOptionsList = [
      {
        file: path.join(packageDirPath, 'dist', packageJson.main),
        format: isEsm ? 'module' : 'commonjs',
        sourcemap: argv.sourcemap,
      },
    ];
  } else {
    outputOptionsList = [
      {
        file: path.join(packageDirPath, 'dist', 'cjs', 'index.cjs'),
        format: 'commonjs',
        sourcemap: argv.sourcemap,
      },
      {
        dir: path.join(packageDirPath, 'dist', 'esm'),
        entryFileNames: '[name].mjs',
        format: 'module',
        preserveModules: true,
        sourcemap: argv.sourcemap,
      },
    ];
  }
  if (outputOptionsList.length === 0) {
    console.error('Failed to detect output files.');
    process.exit(1);
  }

  let bundle: RollupBuild | undefined;
  let buildFailed = false;
  try {
    process.chdir(packageDirPath);
    const [_bundle] = await Promise.all([
      rollup({
        input: argv.input ? path.join(cwd, argv.input) : path.join(packageDirPath, path.join('src', 'index.ts')),
        plugins: createPlugins(argv, target, packageJson, namespace, cwd),
      }),
      fs.promises.rm(path.join(packageDirPath, 'dist'), { recursive: true, force: true }),
    ]);
    bundle = _bundle;

    await Promise.all(outputOptionsList.map((opts) => _bundle.write(opts)));
    if (target === 'functions') {
      packageJson.name += '-dist';
      delete packageJson.devDependencies;
      await fs.promises.writeFile(path.join(packageDirPath, 'dist', 'package.json'), JSON.stringify(packageJson));
    }
  } catch (error) {
    buildFailed = true;
    console.error('Filed to index due to:', error);
  }
  await bundle?.close();
  if (buildFailed) process.exit(1);
}
