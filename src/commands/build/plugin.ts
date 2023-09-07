import fs from 'node:fs';
import path from 'node:path';

import { babel } from '@rollup/plugin-babel';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import terser from '@rollup/plugin-terser';
import type { Plugin } from 'rollup';
import analyze from 'rollup-plugin-analyzer';
import { keepImport } from 'rollup-plugin-keep-import';
import { nodeExternals } from 'rollup-plugin-node-externals';
import { string } from 'rollup-plugin-string';
import type { PackageJson } from 'type-fest';

import { createEnvironmentVariablesDefinition } from '../../env.js';
import type { ArgumentsType, TargetDetail } from '../../types.js';
import { getBuildTsRootPath } from '../../utils.js';

import type { builder } from './builder.js';

export function createPlugins(
  argv: ArgumentsType<typeof builder>,
  targetDetail: TargetDetail,
  packageJson: PackageJson,
  namespace: string | undefined,
  packageDirPath: string
): Plugin[] {
  const externalDeps = [...(argv.external ?? [])].map((item) => item.toString());
  if (packageJson.dependencies?.['@prisma/client']) {
    externalDeps.push('prisma-client');
  }
  // Since `deps: true` does not work for `import chunk from 'lodash/chunk.js';`
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
  const plugins: Plugin[] = [
    replace({
      delimiters: ['', ''],
      preventAssignment: true,
      values: createEnvironmentVariablesDefinition(argv, packageDirPath),
    }),
    json(),
    nodeExternals({
      deps: true,
      devDeps: false,
      peerDeps: true,
      optDeps: true,
      include: externalDeps.map((name) => new RegExp(`^${name}(?:\\/.+)?`)),
      exclude: namespace && new RegExp(`^${namespace}(?:\\/.+)?`),
    }),
    resolve({ extensions }),
    commonjs(),
    keepImport({ moduleNames: argv.keepImport?.map((item) => item.toString()) ?? [] }),
  ];
  plugins.push(
    babel({
      configFile: babelConfigPath,
      extensions,
      // Prefer polyfill-corejs3 over @babel/plugin-transform-runtime and @babel/runtime
      babelHelpers: 'bundled',
      exclude: /^(.+\/)?node_modules\/.+$/,
    }),
    string({ include: ['**/*.csv', '**/*.txt'] })
  );
  if (argv.minify) {
    plugins.push(terser());
  }
  plugins.push(analyze({ summaryOnly: true }));
  return plugins;
}
