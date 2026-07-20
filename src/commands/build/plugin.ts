import fs from 'node:fs';
import path from 'node:path';

import type { InputOptions } from '@babel/core';
import type { Plugin, RolldownPluginOption, SourceMapInput } from 'rolldown';

import { getBuildTsRootPath } from '../../utils.js';

import { containsDecorator } from './decoratorDetection.js';
import { getConsoleRemovalExcludedMethods, removeConsolePlugin } from './removeConsolePlugin.js';
import { isTransformTargetFile } from './transformUtils.js';

export function setupPlugins(): RolldownPluginOption[] {
  const plugins: RolldownPluginOption[] = [];
  const excludedConsoleMethods = getConsoleRemovalExcludedMethods();
  if (excludedConsoleMethods) {
    plugins.push(removeConsolePlugin(excludedConsoleMethods));
  }
  plugins.push(babelDecoratorsPlugin(), textPlugin());
  return plugins;
}

function babelDecoratorsPlugin(): Plugin {
  const babelConfigPath = path.join(getBuildTsRootPath(), 'babel.config.mjs');
  return {
    name: 'babel-decorators',
    async transform(code, id) {
      if (!isTransformTargetFile(id) || !containsDecorator(code)) {
        return undefined;
      }

      const { transformAsync } = await import('@babel/core');
      const options: InputOptions = {
        caller: {
          name: 'build-ts',
          supportsDynamicImport: true,
          supportsExportNamespaceFrom: true,
          supportsStaticESM: true,
        },
        configFile: babelConfigPath,
        filename: id,
        sourceMaps: true,
      };
      const result = await transformAsync(code, options);
      if (!result?.code) return undefined;

      return {
        code: result.code,
        map: result.map as SourceMapInput,
      };
    },
  };
}

function textPlugin(): Plugin {
  return {
    name: 'text',
    async load(id) {
      if (!id.endsWith('.csv') && !id.endsWith('.txt')) return undefined;

      const content = await fs.promises.readFile(id, 'utf8');
      return {
        code: `export default ${JSON.stringify(content)};`,
        moduleType: 'js',
      };
    },
  };
}
