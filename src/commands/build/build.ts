import fs from 'node:fs';
import path from 'node:path';

import chalk from 'chalk';
import dateTime from 'date-time';
import ms from 'pretty-ms';
import { OutputOptions, rollup, RollupBuild, RollupOptions, watch } from 'rollup';
import onExit from 'signal-exit';
import { PackageJson } from 'type-fest';
import type { CommandModule } from 'yargs';

import { allTargetCategories, ArgumentsType, TargetCategory, TargetDetail } from '../../types.js';
import { getNamespaceAndName, readPackageJson } from '../../utils.js';

import { appBuilder, builder, functionsBuilder } from './builder.js';
import { createPlugins } from './plugin.js';
import { handleError } from './rollupLogger.js';

export const app: CommandModule<unknown, ArgumentsType<typeof appBuilder>> = {
  command: 'app [package]',
  describe: 'Build an app',
  builder: appBuilder,
  async handler(argv) {
    return build(argv, 'app', argv.package, argv.moduleType);
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
      await generatePackageJsonForFunctions(packageDirPath, packageJson);
    } else {
      return build(argv, 'functions', argv.package, argv.moduleType);
    }
  },
};

export const lib: CommandModule<unknown, ArgumentsType<typeof builder>> = {
  command: 'lib [package]',
  describe: 'Build a Node.js / React library',
  builder,
  async handler(argv) {
    return build(argv, 'lib', argv.package);
  },
};

export async function build(
  argv: ArgumentsType<typeof builder>,
  targetCategory: TargetCategory,
  relativePackageDirPath?: unknown,
  moduleType?: string
): Promise<void> {
  // `silent` is stronger than `verbose`.
  const verbose = !argv.silent && argv.verbose;
  const cwd = process.cwd();

  const packageDirPath = path.resolve(relativePackageDirPath?.toString() ?? '.');
  const packageJson = await readPackageJson(packageDirPath);
  if (!packageJson) {
    console.error('Failed to parse package.json.');
    process.exit(1);
  }

  const input = verifyInput(argv, cwd, packageDirPath);
  const targetDetail = detectTargetDetail(targetCategory, input);

  if (verbose) {
    console.info('Target (Category):', `${targetDetail} (${targetCategory})`);
  }

  const [namespace] = getNamespaceAndName(packageJson);
  const isEsm = moduleType === 'esm' || packageJson.type === 'module';

  if (argv['core-js']) {
    process.env.BUILD_TS_COREJS = '1';
  }
  if (verbose) {
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
    // The following import statement causes the following error:
    // Statement:
    //   import { usePrevious } from 'react-use';
    // Error:
    //   Named export 'usePrevious' not found. The requested module 'react-use' is a CommonJS module,
    //   which may not support all module.exports as named exports.
    // Also, we still need split files for tree-shaking even though we import cjs module.
    outputOptionsList = [
      {
        dir: path.join(packageDirPath, 'dist', 'cjs'),
        format: 'commonjs',
        preserveModules: true,
        sourcemap: argv.sourcemap,
      },
      {
        dir: path.join(packageDirPath, 'dist', 'esm'),
        format: 'module',
        preserveModules: true,
        sourcemap: argv.sourcemap,
      },
    ];
  }
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
    await generatePackageJsonForFunctions(packageDirPath, packageJson);
  }

  const options: RollupOptions = {
    input,
    plugins: createPlugins(argv, targetDetail, packageJson, namespace, cwd),
    watch: argv.watch ? { clearScreen: false } : undefined,
  };

  const mapToRelatives = (paths: string | Readonly<string[]>): string[] =>
    (Array.isArray(paths) ? paths : [paths]).map((p) => path.relative(packageDirPath, p));
  if (argv.watch) {
    const watcher = watch({ ...options, output: outputOptionsList });

    const close = async (code: number | null): Promise<void> => {
      process.removeListener('uncaughtException', close);
      process.stdin.removeListener('end', close);
      if (watcher) await watcher.close();
      if (code) process.exit(code);
    };
    onExit(close);
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
              `Bundles ${chalk.bold(mapToRelatives(inputFiles).join(', '))} → ${chalk.bold(
                mapToRelatives(event.output).join(', ')
              )}\non ${packageDirPath} ...`
            )
          );
          break;
        }
        case 'BUNDLE_END': {
          if (argv.silent) break;

          console.info(
            chalk.green(
              `Created ${chalk.bold(mapToRelatives(event.output).join(', '))} in ${chalk.bold(ms(event.duration))}`
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
  } else {
    if (!argv.silent) {
      console.info(
        chalk.cyan(
          `Bundles ${chalk.bold(mapToRelatives(input).join(', '))} → ${chalk.bold(
            mapToRelatives(outputOptionsList.map((opts) => opts.file || opts.dir || '')).join(', ')
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
            `Created ${mapToRelatives(outputOptionsList.map((opts) => opts.file || opts.dir || '')).join(
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

function verifyInput(argv: ArgumentsType<typeof builder>, cwd: string, packageDirPath: string): string {
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
  await fs.promises.mkdir(path.join(packageDirPath, 'dist'), { recursive: true });
  await fs.promises.writeFile(path.join(packageDirPath, 'dist', 'package.json'), JSON.stringify(packageJson));
}
