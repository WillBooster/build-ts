import config from './babel.config.mjs';

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

export default config;
