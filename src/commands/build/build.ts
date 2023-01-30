import fs from 'node:fs';
import path from 'node:path';

import { OutputOptions, rollup, RollupBuild } from 'rollup';
import { PackageJson } from 'type-fest';
import type { CommandModule, InferredOptionTypes } from 'yargs';

import { allTargetCategories, TargetCategory, TargetDetail } from '../../types.js';
import { getNamespaceAndName, readPackageJson } from '../../utils.js';

import { appBuilder, builder, functionsBuilder } from './builder.js';
import { createPlugins } from './plugin.js';

export const app: CommandModule<unknown, InferredOptionTypes<typeof appBuilder>> = {
  command: 'app [package]',
  describe: 'Build an app',
  builder: appBuilder,
  async handler(argv) {
    return build(argv, 'app', argv.package, argv.moduleType);
  },
};

export const functions: CommandModule<unknown, InferredOptionTypes<typeof functionsBuilder>> = {
  command: 'functions [package]',
  describe: 'Build a GCP/Firebase functions app',
  builder: functionsBuilder,
  async handler(argv) {
    if (argv.onlyPackageJson) {
      const packageDirPath = path.resolve(argv.package?.toString() ?? '.');
      const packageJson = await readPackageJson(packageDirPath);
      if (!packageJson) {
        console.error('Failed to parse package.json.');
        process.exit(1);
      }
      await generatePackageJsonForFunctions(packageDirPath, packageJson);
    } else {
      return build(argv, 'functions', argv.package, argv.moduleType);
    }
  },
};

export const lib: CommandModule<unknown, InferredOptionTypes<typeof builder>> = {
  command: 'lib [package]',
  describe: 'Build a Node.js / React library',
  builder,
  async handler(argv) {
    return build(argv, 'lib', argv.package);
  },
};

export async function build(
  argv: InferredOptionTypes<typeof builder>,
  targetCategory: TargetCategory,
  relativePackageDirPath?: unknown,
  moduleType?: string
): Promise<void> {
  const cwd = process.cwd();

  const packageDirPath = path.resolve(relativePackageDirPath?.toString() ?? '.');
  const packageJson = await readPackageJson(packageDirPath);
  if (!packageJson) {
    console.error('Failed to parse package.json.');
    process.exit(1);
  }

  const input = verifyInput(argv, cwd, packageDirPath);
  const targetDetail = detectTargetDetail(targetCategory, input);

  if (argv.verbose) {
    console.info('Target (Category):', `${targetDetail} (${targetCategory})`);
  }

  const [namespace] = getNamespaceAndName(packageJson);
  const isEsm = moduleType === 'esm' || packageJson.type === 'module';

  if (argv['core-js']) {
    process.env.BUILD_TS_COREJS = '1';
  }
  if (argv.verbose) {
    process.env.BUILD_TS_VERBOSE = '1';
  }
  process.env.BUILD_TS_TARGET_CATEGORY = targetCategory;
  process.env.BUILD_TS_TARGET_DETAIL = targetDetail;

  let outputOptionsList: OutputOptions[];
  if (targetDetail === 'app-node' || targetDetail === 'functions') {
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
  if (argv.verbose) {
    console.info('OutputOptions:', outputOptionsList);
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
        input,
        plugins: createPlugins(argv, targetDetail, packageJson, namespace, cwd),
        watch: argv.watch ? { clearScreen: false } : undefined,
      }),
      fs.promises.rm(path.join(packageDirPath, 'dist'), { recursive: true, force: true }),
    ]);
    bundle = _bundle;

    await Promise.all(outputOptionsList.map((opts) => _bundle.write(opts)));
    if (targetDetail === 'functions') {
      await generatePackageJsonForFunctions(packageDirPath, packageJson);
    }
  } catch (error) {
    buildFailed = true;
    console.error('Failed to build due to:', error);
  }
  await bundle?.close();
  if (buildFailed) process.exit(1);
}

function verifyInput(argv: InferredOptionTypes<typeof builder>, cwd: string, packageDirPath: string): string {
  if (argv.input) return path.join(cwd, argv.input);

  let input = path.join(packageDirPath, path.join('src', 'index.ts'));
  if (fs.existsSync(input)) return input;

  input = path.join(packageDirPath, path.join('src', 'index.tsx'));
  if (fs.existsSync(input)) return input;

  console.error('Failed to detect input file.');
  process.exit(1);
}

function detectTargetDetail(targetCategory: string, input: string): TargetDetail {
  switch (targetCategory) {
    case 'app': {
      return 'app-node';
    }
    case 'functions': {
      return 'functions';
    }
    case 'lib': {
      if (input.endsWith('.tsx')) {
        return 'lib-react';
      }
      return 'lib';
    }
    default: {
      console.error('target option must be one of: ' + allTargetCategories.join(', '));
      process.exit(1);
    }
  }
}

async function generatePackageJsonForFunctions(packageDirPath: string, packageJson: PackageJson): Promise<void> {
  packageJson.name += '-dist';
  delete packageJson.devDependencies;
  await fs.promises.writeFile(path.join(packageDirPath, 'dist', 'package.json'), JSON.stringify(packageJson));
}
