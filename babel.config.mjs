import pluginProposalDecorators from '@babel/plugin-proposal-decorators';
import presetTypescript from '@babel/preset-typescript';

// Only decorators need Babel: Oxc lowers only legacy decorators, and Rolldown transforms the rest
// (TypeScript leftovers, JSX, and syntax above the target) after this config runs.
/** @type {import('@babel/core').InputOptions} */
const config = {
  presets: [presetTypescript],
  plugins: [
    // cf. https://babeljs.io/blog/2024/02/28/7.24.0#decorators-updates-16242
    [pluginProposalDecorators, { version: '2023-11' }],
  ],
  // Babel 8 parses JSX only with this parser plugin, and `.ts` files must not enable it.
  overrides: [{ test: /\.(?:[cm]?jsx?|tsx)$/, parserOpts: { plugins: ['jsx'] } }],
};

if (process.env.BUILD_TS_VERBOSE) {
  console.info('Babel config:', JSON.stringify(config, undefined, 2));
}

export default config;
