import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

/** @type {import('@babel/core').TransformOptions} */
const config = {
  presets: [
    [
      '@babel/preset-env',
      {
        bugfixes: true,
      },
    ],
    '@babel/typescript',
  ],
  plugins: ['@babel/proposal-class-properties', '@babel/proposal-numeric-separator'],
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

const rootPath = url.fileURLToPath(path.dirname(import.meta.url));
const packageJson = JSON.parse(fs.readFileSync(path.join(rootPath, 'package.json'), 'utf8'));
const [major, minor] = packageJson.dependencies['core-js'].split('.');

/** @type {import('@babel/core').PluginItem} */
const presetEnvConfig = config.presets[0][1];
presetEnvConfig.useBuiltIns = 'usage';
presetEnvConfig.corejs = `${major}.${minor}`;

export default config;
