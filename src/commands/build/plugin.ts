import path from 'node:path';

import { babel } from '@rollup/plugin-babel';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import terser from '@rollup/plugin-terser';
import { Plugin } from 'rollup';
import analyze from 'rollup-plugin-analyzer';
import { externals } from 'rollup-plugin-node-externals';
import { string } from 'rollup-plugin-string';
import ts from 'rollup-plugin-ts';
import type { PackageJson } from 'type-fest';

import { ArgumentsType, TargetDetail } from '../../types.js';
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
  if (packageJson?.dependencies?.['@prisma/client']) {
    externalDeps.push('prisma-client');
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
