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
import { externals } from 'rollup-plugin-node-externals';
import { string } from 'rollup-plugin-string';
import ts from 'rollup-plugin-ts';
import type { PackageJson } from 'type-fest';

import type { ArgumentsType, TargetDetail } from '../../types.js';
import { getBuildTsRootPath } from '../../utils.js';

import type { builder } from './builder.js';
import { loadEnvironmentVariables } from './env.js';

export function createPlugins(
  argv: ArgumentsType<typeof builder>,
  targetDetail: TargetDetail,
  packageJson: PackageJson,
  namespace: string | undefined,
  cwd: string
): Plugin[] {
  const externalDeps = [...(argv.external ?? [])].map((item) => item.toString());
  if (packageJson.dependencies?.['@prisma/client']) {
    externalDeps.push('prisma-client');
  }
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
      values: loadEnvironmentVariables(argv, cwd),
    }),
    json(),
    externals({
      deps: true,
      devDeps: false,
      peerDeps: true,
      optDeps: true,
      include: externalDeps,
      exclude: namespace && new RegExp(`${namespace}\\/.+`),
    }),
    resolve({ extensions }),
    commonjs(),
    keepImport({ moduleNames: argv.keepImport?.map((item) => item.toString()) ?? [] }),
  ];
  if (targetDetail === 'app-node' || targetDetail === 'functions') {
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
