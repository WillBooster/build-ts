import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import pluginProposalDecorators from '@babel/plugin-proposal-decorators';
import pluginTransformExplicitResourceManagement from '@babel/plugin-transform-explicit-resource-management';
import presetEnv from '@babel/preset-env';
import presetReact from '@babel/preset-react';
import presetTypescript from '@babel/preset-typescript';
import pluginPolyfillCorejs3 from 'babel-plugin-polyfill-corejs3';

/** @type {import('@babel/core').InputOptions} */
const config = {
  assumptions: {
    constantReexports: true,
    constantSuper: true,
    enumerableModuleMeta: true,
    ignoreFunctionLength: true,
    noClassCalls: true,
    noDocumentAll: true,
    noIncompleteNsImportDetection: true,
    noNewArrows: true,
    privateFieldsAsSymbols: true,
    setClassMethods: true,
    setComputedProperties: true,
    setPublicClassFields: true,
    superIsCallableConstructor: true,
  },
  presets: [[presetEnv, {}], presetTypescript],
  plugins: [
    pluginTransformExplicitResourceManagement,
    // cf. https://babeljs.io/blog/2024/02/28/7.24.0#decorators-updates-16242
    [
      pluginProposalDecorators,
      {
        version: '2023-11',
      },
    ],
  ],
};

if (process.env.BUILD_TS_COREJS || process.env.BUILD_TS_COREJS_WITH_PROPOSALS) {
  const rootPath = url.fileURLToPath(path.dirname(import.meta.url));
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootPath, 'package.json'), 'utf8'));
  const [major, minor] = packageJson.dependencies['core-js'].split('.');
  const proposals = process.env.BUILD_TS_COREJS_WITH_PROPOSALS ? { proposals: true } : {};

  if (process.env.BUILD_TS_TARGET_CATEGORY === 'app') {
    config.plugins.push([
      pluginPolyfillCorejs3,
      { method: 'usage-global', version: `${major}.${minor}`, ...proposals },
    ]);
  } else if (process.env.BUILD_TS_TARGET_CATEGORY === 'lib') {
    // cf. https://github.com/babel/babel-polyfills#injection-methods
    config.plugins.push([pluginPolyfillCorejs3, { method: 'usage-pure', version: `${major}.${minor}`, ...proposals }]);
  }
}

if (process.env.BUILD_TS_TARGET_DETAIL === 'lib-react') {
  config.presets.push([
    presetReact,
    {
      runtime: 'automatic',
    },
  ]);

  /** @type {import('@babel/core').PluginItem} */
  const presetEnvConfig = config.presets[0][1];
  presetEnvConfig.targets = { esmodules: true };
  presetEnvConfig.modules = false;
}

if (process.env.BUILD_TS_VERBOSE) {
  console.info('Babel config:', JSON.stringify(config, undefined, 2));
}

export default config;
