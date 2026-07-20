import fs from 'node:fs';
import path from 'node:path';
import { styleText } from 'node:util';

import { rolldown, watch } from 'rolldown';
import type { OutputOptions, RolldownBuild, RolldownOptions } from 'rolldown';
import { onExit } from 'signal-exit';
import type { PackageJson } from 'type-fest';
import type { CommandModule } from 'yargs';

import { createEnvironmentVariablesDefinition, loadEnvironmentVariablesWithCache } from '../../env.js';
import type { ArgumentsType, TargetCategory, TargetDetail } from '../../types.js';
import { allTargetCategories } from '../../types.js';
import { formatDateTime, formatDuration, getNamespaceAndName, readPackageJson } from '../../utils.js';

import type { AnyBuilderType, builder } from './builder.js';
import { appBuilder, functionsBuilder, libBuilder } from './builder.js';
import { handleError } from './bundlerLogger.js';
import { createExternalMatcher } from './externals.js';
import { setupPlugins } from './plugin.js';
import { generateDeclarationFiles } from './typeScript.js';

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
      const [packageJson, packageJsonPath] = await readPackageJson(packageDirPath);
      if (!packageJson) {
        console.error(`Failed to parse package.json (${packageJsonPath}).`);
        process.exit(1);
      }
      await generatePackageJsonForFunctions(
        resolveOutDirPath(argv, process.cwd(), packageDirPath, undefined, 'functions'),
        packageJson,
        argv.moduleType
      );
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
  process.env.NODE_ENV ||= 'production';

  // `silent` is stronger than `verbose`.
  const verbose = !argv.silent && argv.verbose;
  const cwd = process.cwd();

  const packageDirPath = path.resolve(argv.package?.toString() ?? '.');
  const [packageJson, packageJsonPath] = await readPackageJson(packageDirPath);
  if (!packageJson) {
    console.error(`Failed to parse package.json (${packageJsonPath}).`);
    process.exit(1);
  }

  loadEnvironmentVariablesWithCache(argv, packageDirPath);

  const inputs = verifyInput(argv, cwd, packageDirPath);
  const targetDetail = detectTargetDetail(targetCategory, inputs, packageDirPath);
  const outDirPath = resolveOutDirPath(argv, cwd, packageDirPath, inputs, targetCategory);
  // Restrict declaration files to the entry files (and their imports) only when inputs are explicit,
  // to keep the default behavior of emitting declarations for all files under src/.
  const declarationInputs = argv.input?.length ? inputs : undefined;

  if (verbose) {
    console.info('argv:', argv);
    console.info('packageJsonPath:', packageJsonPath);
    console.info('Target (Category):', `${targetDetail} (${targetCategory})`);
  }

  const [namespace] = getNamespaceAndName(packageJson);
  const isEsmPackage = packageJson.type === 'module';

  if (argv['core-js']) {
    process.env.BUILD_TS_COREJS = '1';
  } else if (argv['core-js-proposals']) {
    process.env.BUILD_TS_COREJS_WITH_PROPOSALS = '1';
  }

  if (verbose) {
    process.env.BUILD_TS_VERBOSE = '1';
  }
  process.env.BUILD_TS_TARGET_CATEGORY = targetCategory;
  process.env.BUILD_TS_TARGET_DETAIL = targetDetail;

  const declarationOnly = 'declarationOnly' in argv && argv.declarationOnly;
  if (declarationOnly && argv.watch) {
    console.error('--declaration-only cannot be used with --watch.');
    process.exit(1);
  }

  const outputOptionsList = getOutputOptionsList(argv, targetDetail, outDirPath, isEsmPackage, packageDirPath);
  if (verbose) {
    console.info('OutputOptions:', outputOptionsList);
  }
  if (outputOptionsList.length === 0) {
    console.error('Failed to detect output files.');
    process.exit(1);
  }

  process.chdir(packageDirPath);
  await fs.promises.rm(outDirPath, { recursive: true, force: true });
  if (targetDetail === 'functions') {
    await generatePackageJsonForFunctions(outDirPath, packageJson, argv.moduleType);
  }

  if (declarationOnly) {
    if (!argv.silent) {
      console.info(
        styleText(
          'cyan',
          `Generates declaration files → ${styleText('bold', path.relative(packageDirPath, outDirPath))}\non ${packageDirPath} ...`
        )
      );
    }
    if (!(await generateDeclarationFiles(argv, packageDirPath, outDirPath, declarationInputs))) {
      process.exit(1);
    }
    return;
  }

  const options: RolldownOptions = {
    checks: { preferBuiltinFeature: false },
    external: createExternalMatcher(argv, targetDetail, packageJson, namespace, packageDirPath),
    input:
      targetDetail === 'functions' ? createFunctionsInputEntries(inputs) : inputs,
    plugins: setupPlugins(argv, outputOptionsList, packageDirPath),
    resolve: {
      extensionAlias: {
        '.cjs': ['.cjs', '.cts'],
        '.js': ['.js', '.ts', '.tsx'],
        '.mjs': ['.mjs', '.mts'],
      },
      extensions: ['.cts', '.mts', '.ts', '.tsx', '.cjs', '.mjs', '.js', '.jsx', '.json'],
    },
    treeshake: argv['core-js'] || argv['core-js-proposals'] ? false : undefined,
    transform: getTransformOptions(argv, packageDirPath),
    watch: argv.watch ? { clearScreen: false } : undefined,
  };

  const pathToRelativePath = (paths: string | Readonly<string[]>): string[] =>
    (Array.isArray(paths) ? paths : [paths]).map((p) => path.relative(packageDirPath, p));
  const printBundlingMessage = (inputPaths: string | Readonly<string[]>): void => {
    const outputPaths = pathToRelativePath(outputOptionsList.map((opts) => opts.file || opts.dir || ''));
    console.info(
      styleText(
        'cyan',
        `Bundles ${styleText('bold', pathToRelativePath(inputPaths).join(', '))} → ${styleText(
          'bold',
          outputPaths.join(', ')
        )}\non ${packageDirPath} ...`
      )
    );
  };
  if (argv.watch) {
    watchRolldown(
      argv,
      targetDetail,
      packageDirPath,
      outDirPath,
      declarationInputs,
      options,
      outputOptionsList,
      pathToRelativePath,
      printBundlingMessage
    );
  } else {
    if (!argv.silent) {
      printBundlingMessage(inputs);
    }

    let bundle: RolldownBuild | undefined;
    let buildFailed = false;
    try {
      const startTime = Date.now();
      const _bundle = await rolldown(options);
      bundle = _bundle;
      await Promise.all(outputOptionsList.map((opts) => _bundle.write(opts)));

      if (!argv.silent) {
        console.info(
          styleText(
            'green',
            `Created ${pathToRelativePath(outputOptionsList.map((opts) => opts.file || opts.dir || '')).join(
              ', '
            )} in ${styleText('bold', formatDuration(Date.now() - startTime))}`
          )
        );
      }
    } catch (error) {
      buildFailed = true;
      console.error('Failed to build due to:', error);
    }
    await bundle?.close();
    if (buildFailed) process.exit(1);

    if (
      targetDetail !== 'app-node' &&
      targetDetail !== 'functions' &&
      !(await generateDeclarationFiles(argv, packageDirPath, outDirPath, declarationInputs))
    ) {
      process.exit(1);
    }
  }
}

function getTransformOptions(argv: ArgumentsType<AnyBuilderType>, packageDirPath: string): RolldownOptions['transform'] {
  return {
    define: createEnvironmentVariablesDefinition(argv, packageDirPath),
    jsx: 'react-jsx',
    target: 'es2022',
  };
}

function watchRolldown(
  argv: ArgumentsType<AnyBuilderType>,
  targetDetail: string,
  packageDirPath: string,
  outDirPath: string,
  declarationInputs: string[] | undefined,
  options: RolldownOptions,
  outputOptionsList: OutputOptions[],
  pathToRelativePath: (paths: string | Readonly<string[]>) => string[],
  printBundlingMessage: (inputPaths: string | Readonly<string[]>) => void
): void {
  const watcher = watch({ ...options, output: outputOptionsList });

  const close = async (code?: number | null): Promise<void> => {
    process.removeListener('uncaughtException', closeOnUncaughtException);
    process.stdin.removeListener('end', closeOnStdinEnd);
    await watcher.close();
    if (code) process.exit(code);
  };
  const closeOnUncaughtException = (error: unknown): void => {
    console.error(error);
    void close(1);
  };
  const closeOnStdinEnd = (): void => {
    void close();
  };
  onExit((code) => void close(code));
  process.on('uncaughtException', closeOnUncaughtException);
  if (!process.stdin.isTTY) {
    process.stdin.on('end', closeOnStdinEnd);
    process.stdin.resume();
  }

  watcher.on('event', async (event) => {
    try {
      switch (event.code) {
        case 'ERROR': {
          handleError(event.error, true);
          break;
        }
        case 'BUNDLE_START': {
          if (argv.silent) break;

          printBundlingMessage(getInputFiles(options.input));
          break;
        }
        case 'BUNDLE_END': {
          if (!argv.silent) {
            console.info(
              styleText(
                'green',
                `Created ${styleText('bold', pathToRelativePath(event.output).join(', '))} in ${styleText(
                  'bold',
                  formatDuration(event.duration)
                )}`
              )
            );
          }

          if (targetDetail !== 'app-node' && targetDetail !== 'functions') {
            await generateDeclarationFiles(argv, packageDirPath, outDirPath, declarationInputs);
          }
          break;
        }
        case 'END': {
          if (argv.silent) break;

          console.info(`\n[${formatDateTime(new Date())}] waiting for changes...`);
          break;
        }
      }
    } catch (error) {
      // Keep the watcher alive even if handling an event (e.g. declaration file generation) fails.
      console.error('Failed to handle watch event due to:', error);
    } finally {
      if ('result' in event && event.result) {
        void event.result.close();
      }
    }
  });
}

function resolveOutDirPath(
  argv: ArgumentsType<AnyBuilderType>,
  cwd: string,
  packageDirPath: string,
  inputs?: string[],
  targetCategory?: TargetCategory
): string {
  if (Array.isArray(argv.outDir)) {
    console.error('Multiple --out-dir options are not allowed.');
    process.exit(1);
  }
  // yargs also accepts `--no-out-dir`, which yields `false` despite the declared string type.
  const outDirOption = typeof argv.outDir === 'string' ? argv.outDir : undefined;
  if (outDirOption === '') {
    console.error('--out-dir must not be empty.');
    process.exit(1);
  }

  // The output directory is removed before building, so refuse locations that would delete source files.
  // Containment checks compare both the lexical and the canonical (symlink-resolved) forms: canonical
  // ones catch symlinked parent components (`fs.rm` follows them), and lexical ones catch an output path
  // that is itself a symlink inside a protected directory. The lexical path is returned so that removing
  // a symlinked output directory deletes the symlink itself rather than its target's contents.
  const lexicalOutDirPath = path.resolve(cwd, outDirOption ?? path.join(packageDirPath, 'dist'));
  const outDirPath = toCanonicalPath(lexicalOutDirPath);
  const containedInput = inputs?.find(
    (input) => containsPath(outDirPath, toCanonicalPath(input)) || containsPath(lexicalOutDirPath, input)
  );
  if (containedInput) {
    console.error(`The output directory (${outDirPath}) must not contain the input file (${containedInput}).`);
    process.exit(1);
  }
  if (!outDirOption) return lexicalOutDirPath;

  const canonicalPackageDirPath = toCanonicalPath(packageDirPath);
  if (containsPath(outDirPath, canonicalPackageDirPath) || containsPath(lexicalOutDirPath, packageDirPath)) {
    console.error(`--out-dir (${outDirPath}) must not contain the package directory (${canonicalPackageDirPath}).`);
    process.exit(1);
  }
  // `src` itself may be a symlink, so it needs its own canonicalization.
  const srcDirPath = toCanonicalPath(path.join(canonicalPackageDirPath, 'src'));
  if (containsPath(srcDirPath, outDirPath) || containsPath(path.join(packageDirPath, 'src'), lexicalOutDirPath)) {
    console.error(`--out-dir (${outDirPath}) must not be inside the source directory (${srcDirPath}).`);
    process.exit(1);
  }
  // A package.json at the output directory root indicates another package's directory. The functions
  // target is exempt because it generates a package.json there itself.
  if (targetCategory !== 'functions' && fs.existsSync(path.join(outDirPath, 'package.json'))) {
    console.error(`--out-dir (${outDirPath}) contains a package.json, so it looks like a package directory.`);
    process.exit(1);
  }
  return lexicalOutDirPath;
}

// Resolves symlinks in the longest existing ancestor of the given path, keeping the non-existent tail.
function toCanonicalPath(targetPath: string): string {
  const suffixes: string[] = [];
  let currentPath = targetPath;
  while (!fs.existsSync(currentPath)) {
    suffixes.unshift(path.basename(currentPath));
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) break;
    currentPath = parentPath;
  }
  try {
    currentPath = fs.realpathSync(currentPath);
  } catch {
    // Keep the original path when it cannot be resolved (e.g. removed concurrently).
  }
  return path.join(currentPath, ...suffixes);
}

function containsPath(parentPath: string, childPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath);
  if (relativePath === '') return true;
  if (path.isAbsolute(relativePath)) return false;
  // Only an actual `..` segment means "outside"; a child name like `..foo` also starts with `..`.
  return relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`);
}

function createFunctionsInputEntries(inputs: string[]): Record<string, string> {
  // A null prototype avoids false conflicts with inherited members (e.g. an entry named "toString").
  const entries: Record<string, string> = Object.create(null);
  for (const [index, input] of inputs.entries()) {
    const name = index === 0 ? 'index' : path.basename(input, path.extname(input));
    if (entries[name]) {
      console.error(
        `Entry names conflict in the functions build: "${name}" (${entries[name]} vs ${input}). List --input files explicitly with unique base names, keeping the main entry first.`
      );
      process.exit(1);
    }
    entries[name] = input;
  }
  return entries;
}

function getInputFiles(input: RolldownOptions['input']): string[] {
  if (!input) return [];
  if (typeof input === 'string') return [input];
  return Array.isArray(input) ? input : Object.values(input);
}

function verifyInput(argv: ArgumentsType<typeof builder>, cwd: string, packageDirPath: string): string[] {
  if (argv.input && argv.input.length > 0) {
    const inputs = argv.input.flatMap((p) => {
      const raw = p.toString();
      // An existing file always wins over glob interpretation (e.g. "src/entry[1].ts").
      const literalPath = path.resolve(cwd, raw);
      if (fs.existsSync(literalPath)) return [literalPath];

      // `fs.globSync` requires "/" as the separator even on Windows (a no-op on POSIX).
      const pattern = raw.split(path.sep).join('/');
      // Ambient declaration files always participate in type checking, so they must not become entries.
      // `throwIfNoEntry: false` skips broken symlinks instead of crashing.
      const matches = fs
        .globSync(pattern, { cwd })
        .filter(
          (m) => !/\.d\.[cm]?ts$/.test(m) && fs.statSync(path.resolve(cwd, m), { throwIfNoEntry: false })?.isFile()
        )
        .sort()
        .map((m) => path.resolve(cwd, m));
      if (matches.length > 0) return matches;
      if (/[*?{[(!@+]/.test(raw)) {
        console.error(`No files matched the input pattern: ${raw}`);
        process.exit(1);
      }
      // A non-existing non-pattern path may still be resolvable by the bundler (e.g. an extension-less path).
      return [literalPath];
    });
    return [...new Set(inputs)];
  }

  const srcDirPath = path.join(packageDirPath, 'src');
  for (const ext of ['ts', 'tsx', 'cts', 'mts']) {
    const input = path.join(srcDirPath, `index.${ext}`);
    if (fs.existsSync(input)) return [input];
  }

  console.error('Failed to detect input file.');
  process.exit(1);
}

function detectTargetDetail(targetCategory: string, inputs: string[], packageDirPath: string): TargetDetail {
  switch (targetCategory) {
    case 'app': {
      return 'app-node';
    }
    case 'functions': {
      return 'functions';
    }
    case 'lib': {
      if (inputs.some((input) => input.endsWith('.tsx')) || doesSrcContainTsx(packageDirPath)) {
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

function doesSrcContainTsx(packageDirPath: string): boolean {
  const srcDirPath = path.join(packageDirPath, 'src');
  return doesDirectoryContainTsx(srcDirPath);
}

function doesDirectoryContainTsx(dirPath: string): boolean {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries.some((entry) => {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) return doesDirectoryContainTsx(entryPath);
      return entry.isFile() && entry.name.endsWith('.tsx');
    });
  } catch {
    return false;
  }
}

async function generatePackageJsonForFunctions(
  outDirPath: string,
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

  await fs.promises.mkdir(outDirPath, { recursive: true });
  await fs.promises.writeFile(path.join(outDirPath, 'package.json'), JSON.stringify(packageJson));
}

function getOutputOptionsList(
  argv: ArgumentsType<AnyBuilderType>,
  targetDetail: TargetDetail,
  outDirPath: string,
  isEsmPackage: boolean,
  packageDirPath: string
): OutputOptions[] {
  if (targetDetail === 'app-node' || targetDetail === 'functions') {
    const esmOutput = isEsmOutput(isEsmPackage, argv.moduleType);
    return [
      {
        dir: outDirPath,
        format: esmOutput ? 'module' : 'commonjs',
        minify: argv.minify,
        sourcemap: argv.sourcemap && 'inline',
        strict: !esmOutput,
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
      dir: outDirPath,
      entryFileNames: jsExt === 'both' || (jsExt === 'either' && !isEsmPackage) ? '[name].js' : '[name].cjs',
      format: 'commonjs',
      minify: argv.minify,
      preserveModules: true,
      preserveModulesRoot: path.join(packageDirPath, 'src'),
      sourcemap: argv.sourcemap,
      strict: true,
    });
  }
  if (moduleType === 'esm' || moduleType === 'both' || (moduleType === 'either' && isEsmPackage)) {
    outputOptionsList.push({
      dir: outDirPath,
      entryFileNames: jsExt === 'both' || (jsExt === 'either' && isEsmPackage) ? '[name].js' : '[name].mjs',
      format: 'module',
      minify: argv.minify,
      preserveModules: true,
      preserveModulesRoot: path.join(packageDirPath, 'src'),
      sourcemap: argv.sourcemap,
    });
  }
  return outputOptionsList;
}

function isEsmOutput(isEsmPackage: boolean, moduleType: string | undefined): boolean {
  return moduleType === 'esm' || ((!moduleType || moduleType === 'either') && isEsmPackage);
}
