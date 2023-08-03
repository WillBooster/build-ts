import fs from 'node:fs';
import path from 'node:path';

import chalk from 'chalk';
import dateTime from 'date-time';
import ms from 'pretty-ms';
import type { OutputOptions, RollupBuild, RollupOptions } from 'rollup';
import { rollup, watch } from 'rollup';
import type { Handler } from 'signal-exit';
import { onExit } from 'signal-exit';
import type { PackageJson } from 'type-fest';
import type { CommandModule } from 'yargs';

import { loadEnvironmentVariablesWithCache } from '../../env.js';
import type { ArgumentsType, TargetCategory, TargetDetail } from '../../types.js';
import { allTargetCategories } from '../../types.js';
import { getNamespaceAndName, readPackageJson } from '../../utils.js';

import type { AnyBuilderType, builder } from './builder.js';
import { appBuilder, functionsBuilder, libBuilder } from './builder.js';
import { createPlugins } from './plugin.js';
import { handleError } from './rollupLogger.js';

export const app: CommandModule<unknown, ArgumentsType<typeof appBuilder>> = {
  command: 'app [package]',
  describe: 'Build an app',
  builder: appBuilder,
  async handler(argv) {
    return build(argv, 'app');
  },
};

export const functions: CommandModule<unknown, ArgumentsType<typeof functionsBuilder>> = {
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
      await generatePackageJsonForFunctions(packageDirPath, packageJson, argv.moduleType);
    } else {
      return build(argv, 'functions');
    }
  },
};

export const lib: CommandModule<unknown, ArgumentsType<typeof libBuilder>> = {
  command: 'lib [package]',
  describe: 'Build a Node.js / React library',
  builder: libBuilder,
  async handler(argv) {
    return build(argv, 'lib');
  },
};

export async function build(argv: ArgumentsType<AnyBuilderType>, targetCategory: TargetCategory): Promise<void> {
  // `silent` is stronger than `verbose`.
  const verbose = !argv.silent && argv.verbose;
  const cwd = process.cwd();

  const packageDirPath = path.resolve(argv.package?.toString() ?? '.');
  const packageJson = await readPackageJson(packageDirPath);
  if (!packageJson) {
    console.error('Failed to parse package.json.');
    process.exit(1);
  }

  loadEnvironmentVariablesWithCache(argv, packageDirPath);

  const inputs = verifyInput(argv, cwd, packageDirPath);
  const targetDetail = detectTargetDetail(targetCategory, inputs[0]);

  if (verbose) {
    console.info('Target (Category):', `${targetDetail} (${targetCategory})`);
  }

  const [namespace] = getNamespaceAndName(packageJson);
  const isEsmPackage = packageJson.type === 'module';

  if (argv['core-js']) {
    process.env.BUILD_TS_COREJS = '1';
  }
  if (verbose) {
    process.env.BUILD_TS_VERBOSE = '1';
  }
  process.env.BUILD_TS_TARGET_CATEGORY = targetCategory;
  process.env.BUILD_TS_TARGET_DETAIL = targetDetail;

  const outputOptionsList = getOutputOptionsList(argv, packageDirPath, targetDetail, isEsmPackage);
  if (verbose) {
    console.info('OutputOptions:', outputOptionsList);
  }
  if (outputOptionsList.length === 0) {
    console.error('Failed to detect output files.');
    process.exit(1);
  }

  process.chdir(packageDirPath);
  await fs.promises.rm(path.join(packageDirPath, 'dist'), { recursive: true, force: true });
  if (targetDetail === 'functions') {
    await generatePackageJsonForFunctions(packageDirPath, packageJson, argv.moduleType);
  }

  const options: RollupOptions = {
    input:
      targetDetail === 'functions'
        ? Object.fromEntries(
            inputs.map((input, index) => [index === 0 ? 'index' : path.basename(input, path.extname(input)), input])
          )
        : inputs,
    plugins: createPlugins(argv, targetDetail, packageJson, namespace, packageDirPath),
    watch: argv.watch ? { clearScreen: false } : undefined,
  };

  const pathToRelativePath = (paths: string | Readonly<string[]>): string[] =>
    (Array.isArray(paths) ? paths : [paths]).map((p) => path.relative(packageDirPath, p));
  if (argv.watch) {
    watchRollup(argv, packageDirPath, options, outputOptionsList, pathToRelativePath);
  } else {
    if (!argv.silent) {
      console.info(
        chalk.cyan(
          `Bundles ${chalk.bold(pathToRelativePath(inputs).join(', '))} → ${chalk.bold(
            pathToRelativePath(outputOptionsList.map((opts) => opts.file || opts.dir || '')).join(', ')
          )}\non ${packageDirPath} ...`
        )
      );
    }

    let bundle: RollupBuild | undefined;
    let buildFailed = false;
    try {
      const startTime = Date.now();
      const _bundle = await rollup(options);
      bundle = _bundle;
      await Promise.all(outputOptionsList.map((opts) => _bundle.write(opts)));

      if (!argv.silent) {
        console.info(
          chalk.green(
            `Created ${pathToRelativePath(outputOptionsList.map((opts) => opts.file || opts.dir || '')).join(
              ', '
            )} in ${chalk.bold(ms(Date.now() - startTime))}`
          )
        );
      }
    } catch (error) {
      buildFailed = true;
      console.error('Failed to build due to:', error);
    }
    await bundle?.close();
    if (buildFailed) process.exit(1);
  }
}

function watchRollup(
  argv: ArgumentsType<AnyBuilderType>,
  packageDirPath: string,
  options: RollupOptions,
  outputOptionsList: OutputOptions[],
  pathToRelativePath: (paths: string | Readonly<string[]>) => string[]
): void {
  const watcher = watch({ ...options, output: outputOptionsList });

  const close = async (code: number | null | undefined): Promise<void> => {
    process.removeListener('uncaughtException', close);
    process.stdin.removeListener('end', close);
    if (watcher) await watcher.close();
    if (code) process.exit(code);
  };
  onExit(close as unknown as Handler);
  process.on('uncaughtException', close);
  if (!process.stdin.isTTY) {
    process.stdin.on('end', close);
    process.stdin.resume();
  }

  watcher.on('event', (event) => {
    switch (event.code) {
      case 'ERROR': {
        handleError(event.error, true);
        break;
      }
      case 'BUNDLE_START': {
        if (argv.silent) break;

        const eventInput = event.input;
        const inputFiles: string[] = [];
        if (typeof eventInput === 'string') {
          inputFiles.push(eventInput);
        } else {
          inputFiles.push(
            ...(Array.isArray(eventInput) ? eventInput : Object.values(eventInput as Record<string, string>))
          );
        }
        console.info(
          chalk.cyan(
            `Bundles ${chalk.bold(pathToRelativePath(inputFiles).join(', '))} → ${chalk.bold(
              pathToRelativePath(event.output).join(', ')
            )}\non ${packageDirPath} ...`
          )
        );
        break;
      }
      case 'BUNDLE_END': {
        if (argv.silent) break;

        console.info(
          chalk.green(
            `Created ${chalk.bold(pathToRelativePath(event.output).join(', '))} in ${chalk.bold(ms(event.duration))}`
          )
        );
        break;
      }
      case 'END': {
        if (argv.silent) break;

        console.info(`\n[${dateTime()}] waiting for changes...`);
        break;
      }
    }

    if ('result' in event && event.result) {
      event.result.close();
    }
  });
}

function verifyInput(argv: ArgumentsType<typeof builder>, cwd: string, packageDirPath: string): string[] {
  if (argv.input && argv.input.length > 0) return argv.input.map((p) => path.join(cwd, p.toString()));

  const srcDirPath = path.join(packageDirPath, 'src');
  let input = path.join(srcDirPath, 'index.ts');
  if (fs.existsSync(input)) return [input];

  input = path.join(srcDirPath, 'index.tsx');
  if (fs.existsSync(input)) return [input];

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

async function generatePackageJsonForFunctions(
  packageDirPath: string,
  packageJson: PackageJson,
  moduleType: string | undefined
): Promise<void> {
  packageJson.name += '-dist';
  const esmPackage = packageJson.type === 'module';
  const esmOutput = isEsmOutput(esmPackage, moduleType);
  packageJson.main = esmPackage === esmOutput ? 'index.js' : esmOutput ? 'index.mjs' : 'index.cjs';

  // Prevent Firebase Functions from running `build` script since we are building code before deploying.
  delete packageJson.scripts;
  // devDependencies are not required since we are building code before deploying.
  delete packageJson.devDependencies;

  await fs.promises.mkdir(path.join(packageDirPath, 'dist'), { recursive: true });
  await fs.promises.writeFile(path.join(packageDirPath, 'dist', 'package.json'), JSON.stringify(packageJson));
}

function getOutputOptionsList(
  argv: ArgumentsType<AnyBuilderType>,
  packageDirPath: string,
  targetDetail: string,
  isEsmPackage: boolean
): OutputOptions[] {
  if (targetDetail === 'app-node' || targetDetail === 'functions') {
    return [
      {
        dir: path.join(packageDirPath, 'dist'),
        format: isEsmOutput(isEsmPackage, argv.moduleType) ? 'module' : 'commonjs',
        sourcemap: argv.sourcemap,
      },
    ];
  }

  // The following import statement in an esm module causes the following error:
  // Statement:
  //   import { usePrevious } from 'react-use';
  // Error:
  //   Named export 'usePrevious' not found. The requested module 'react-use' is a CommonJS module,
  //   which may not support all module.exports as named exports.
  // We need cjs modules for web apps to avoid the error.
  // Also, splitting a library is useful in both modules, so preserveModules should be true.
  const outputOptionsList: OutputOptions[] = [];
  const moduleType = argv.moduleType || 'both';
  const jsExt = argv.jsExtension || 'either';
  if (moduleType === 'cjs' || moduleType === 'both' || (moduleType === 'either' && !isEsmPackage)) {
    outputOptionsList.push({
      dir: path.join(packageDirPath, 'dist', 'cjs'),
      entryFileNames: jsExt === 'both' || (jsExt === 'either' && !isEsmPackage) ? '[name].js' : '[name].cjs',
      format: 'commonjs',
      preserveModules: true,
      sourcemap: argv.sourcemap,
    });
  }
  if (moduleType === 'esm' || moduleType === 'both' || (moduleType === 'either' && isEsmPackage)) {
    outputOptionsList.push({
      dir: path.join(packageDirPath, 'dist', 'esm'),
      entryFileNames: jsExt === 'both' || (jsExt === 'either' && isEsmPackage) ? '[name].js' : '[name].mjs',
      format: 'module',
      preserveModules: true,
      sourcemap: argv.sourcemap,
    });
  }
  return outputOptionsList;
}

function isEsmOutput(isEsmPackage: boolean, moduleType: string | undefined): boolean {
  return moduleType === 'esm' || ((!moduleType || moduleType === 'either') && isEsmPackage);
}
