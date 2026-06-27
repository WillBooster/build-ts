import fs from 'node:fs';
import path from 'node:path';

import { babel } from '@rollup/plugin-babel';
import * as replace from '@rollup/plugin-replace';
import * as terser from '@rollup/plugin-terser';
import type { OutputOptions, RolldownPluginOption } from 'rolldown';
import * as analyze from 'rollup-plugin-analyzer';
import { keepImport } from 'rollup-plugin-keep-import';
import { nodeExternals } from 'rollup-plugin-node-externals';
import preserveDirectives from 'rollup-plugin-preserve-directives';
import { string } from 'rollup-plugin-string';
import type { PackageJson } from 'type-fest';

import { createEnvironmentVariablesDefinition } from '../../env.js';
import type { ArgumentsType, TargetDetail } from '../../types.js';
import { getBuildTsRootPath } from '../../utils.js';

import type { builder } from './builder.js';

export function setupPlugins(
  argv: ArgumentsType<typeof builder>,
  targetDetail: TargetDetail,
  packageJson: PackageJson,
  namespace: string | undefined,
  packageDirPath: string,
  outputOptionsList: OutputOptions[]
): RolldownPluginOption[] {
  const externalDeps = [...(argv.external ?? [])].map((item) => item.toString());
  if (packageJson.dependencies?.['@prisma/client']) {
    externalDeps.push('prisma-client');
  }
  // Since `deps: true` does not work for `import chunk from 'lodash.chunk/index.js';`
  externalDeps.push(
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {})
  );
  // Add external dependencies from sibling packages
  if (fs.existsSync(path.join('..', '..', 'package.json'))) {
    const packageDirs = fs.readdirSync(path.join('..'), { withFileTypes: true });
    for (const packageDir of packageDirs) {
      if (!packageDir.isDirectory()) continue;

      const packageJsonPath = path.join('..', packageDir.name, 'package.json');
      if (!fs.existsSync(packageJsonPath)) continue;

      const otherPackageJson: PackageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      if (packageJson.dependencies?.[otherPackageJson.name ?? '']) {
        externalDeps.push(
          ...Object.keys(otherPackageJson.dependencies ?? {}),
          ...Object.keys(otherPackageJson.peerDependencies ?? {}),
          ...Object.keys(otherPackageJson.optionalDependencies ?? {})
        );
      }
    }
  }

  const extensions = ['.cjs', '.mjs', '.js', '.jsx', '.json', '.cts', '.mts', '.ts', '.tsx'];
  const babelConfigPath = path.join(getBuildTsRootPath(), 'babel.config.mjs');
  const replacePlugin = getDefaultPluginFactory(replace);
  const terserPlugin = getDefaultPluginFactory(terser);
  const analyzePlugin = getDefaultPluginFactory(analyze);
  const plugins: RolldownPluginOption[] = [
    asRolldownPlugin(
      replacePlugin({
        // Ignore word boundaries and replace every instance of the string.
        // cf. https://github.com/rollup/plugins/tree/master/packages/replace#word-boundaries
        delimiters: ['', ''],
        preventAssignment: true,
        values: createEnvironmentVariablesDefinition(argv, packageDirPath),
      })
    ),
    asRolldownPlugin(
      nodeExternals({
        deps: true,
        devDeps: false,
        peerDeps: true,
        optDeps: true,
        include: externalDeps.map((name) => new RegExp(`^${name}(?:\\/.+)?`)),
        exclude:
          shouldBundleSameNamespaceDependencies(targetDetail) && namespace && new RegExp(`^@?${namespace}(?:\\/.+)?`),
      })
    ),
    asRolldownPlugin(keepImport({ moduleNames: argv.keepImport?.map((item) => item.toString()) ?? [] })),
  ];
  const isBabelHelpersBundled =
    targetDetail === 'app-node' || targetDetail === 'functions' || !externalDeps.includes('@babel/runtime');
  process.env.BUILDTS_USE_BABLE_RUNTIME = isBabelHelpersBundled ? '' : '1';
  plugins.push(
    asRolldownPlugin(
      babel({
        configFile: babelConfigPath,
        extensions,
        // We need `runtime since `bundled` may break directory structure by creating _virtual directory.
        babelHelpers: isBabelHelpersBundled ? 'bundled' : 'runtime',
        exclude: /^(.+\/)?node_modules\/.+$/,
      })
    ),
    ...(outputOptionsList.some((opts) => opts.preserveModules) ? [asRolldownPlugin(preserveDirectives())] : []),
    asRolldownPlugin(string({ include: ['**/*.csv', '**/*.txt'] }))
  );
  if (argv.minify && !outputOptionsList.some((opts) => opts.preserveModules)) {
    plugins.push(asRolldownPlugin(terserPlugin({ compress: { directives: false } })));
  }
  plugins.push(asRolldownPlugin(analyzePlugin({ summaryOnly: true })));
  return plugins;
}

function shouldBundleSameNamespaceDependencies(targetDetail: TargetDetail): boolean {
  return targetDetail === 'app-node' || targetDetail === 'functions';
}

type PluginFactory = (options?: unknown) => unknown;

function getDefaultPluginFactory(module: { default: unknown }): PluginFactory {
  return module.default as PluginFactory;
}

function asRolldownPlugin(plugin: unknown): RolldownPluginOption {
  return plugin as RolldownPluginOption;
}
