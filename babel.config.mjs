import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

/** @type {import('@babel/core').TransformOptions} */
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
  presets: [
    [
      '@babel/preset-env',
      {
        bugfixes: true,
      },
    ],
    '@babel/typescript',
  ],
  plugins: [
    // We should use import assertions until TypeScript supports import attributes.
    // cf. https://github.com/microsoft/TypeScript/issues/53656
    '@babel/plugin-syntax-import-assertions',
    // cf. https://babeljs.io/blog/2023/05/26/7.22.0#import-attributes-15536-15620
    // '@babel/plugin-syntax-import-attributes',
    // cf. https://babeljs.io/blog/2023/05/26/7.22.0#explicit-resource-management-15633-15520
    '@babel/plugin-proposal-explicit-resource-management',
    // cf. https://babeljs.io/blog/2023/05/26/7.22.0#decorators-updates-15570
    [
      '@babel/plugin-proposal-decorators',
      {
        version: '2023-05',
      },
    ],
    ...(process.env.BUILDTS_USE_BABLE_RUNTIME ? ['@babel/plugin-transform-runtime'] : []),
  ],
  env: {
    production: {
      plugins: [
        [
          'transform-remove-console',
          {
            exclude: ['error', 'info', 'warn'],
          },
        ],
      ],
    },
    test: {
      plugins: [
        [
          'transform-remove-console',
          {
            exclude: ['error', 'info', 'warn', 'debug'],
          },
        ],
      ],
      presets: [
        [
          '@babel/preset-env',
          {
            modules: 'auto',
          },
        ],
      ],
    },
  },
};

if (process.env.BUILD_TS_COREJS || process.env.BUILD_TS_COREJS_WITH_PROPOSALS) {
  const rootPath = url.fileURLToPath(path.dirname(import.meta.url));
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootPath, 'package.json'), 'utf8'));
  const [major, minor] = packageJson.dependencies['core-js'].split('.');
  const proposals = process.env.BUILD_TS_COREJS_WITH_PROPOSALS ? { proposals: true } : {};

  if (process.env.BUILD_TS_TARGET_CATEGORY === 'app') {
    /** @type {import('@babel/core').PluginItem} */
    const presetEnvConfig = config.presets[0][1];
    presetEnvConfig.useBuiltIns = 'usage';
    presetEnvConfig.corejs = { version: `${major}.${minor}`, ...proposals };
  } else if (process.env.BUILD_TS_TARGET_CATEGORY === 'lib') {
    // cf. https://github.com/babel/babel-polyfills#injection-methods
    config.plugins.push(['polyfill-corejs3', { method: 'usage-pure', version: `${major}.${minor}`, ...proposals }]);
  }
}

if (process.env.BUILD_TS_TARGET_DETAIL === 'lib-react') {
  config.presets.push([
    '@babel/preset-react',
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
