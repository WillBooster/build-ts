import fs from 'node:fs';
import path from 'node:path';

import { OutputOptions, rollup, RollupBuild } from 'rollup';
import type { CommandModule, InferredOptionTypes } from 'yargs';

import { getNamespaceAndName, readPackageJson } from '../../utils.js';

import { builder } from './builder.js';
import { createPlugins } from './plugin.js';

export const build: CommandModule<unknown, InferredOptionTypes<typeof builder>> = {
  command: 'build [package]',
  describe: 'Build a package',
  builder,
  async handler(argv) {
    if (argv.target !== 'app' && argv.target !== 'lib' && argv.target !== 'functions') {
      console.error('target option must be "app", "lib" or "functions');
      process.exit(1);
    }

    const packageDirPath = path.resolve(argv.package?.toString() ?? '.');
    const packageJson = await readPackageJson(packageDirPath);
    if (!packageJson) {
      console.error('Failed to parse package.json');
      process.exit(1);
    }

    if (argv.coreJs) {
      process.env.BUILD_TS_COREJS = '1';
    }
    if (argv.verbose) {
      process.env.BUILD_TS_VERBOSE = '1';
    }
    process.env.BUILD_TS_TARGET = argv.target;

    const [namespace] = getNamespaceAndName(packageJson);
    const plugins = createPlugins(argv, packageJson, namespace);
    const isEsm = packageJson.type === 'module';

    process.chdir(packageDirPath);
    await fs.promises.rm('dist', { recursive: true, force: true });

    let outputOptionsList: OutputOptions[];
    if (argv.target === 'app' || argv.target === 'functions') {
      packageJson.main = isEsm ? 'index.mjs' : 'index.cjs';
      outputOptionsList = [
        {
          file: path.join('dist', packageJson.main),
          format: isEsm ? 'module' : 'commonjs',
          sourcemap: argv.sourcemap,
        },
      ];
    } else {
      outputOptionsList = [
        {
          file: path.join('dist', 'cjs', 'index.cjs'),
          format: 'commonjs',
          sourcemap: argv.sourcemap,
        },
        {
          dir: path.join('dist', 'esm'),
          entryFileNames: '[name].mjs',
          format: 'module',
          preserveModules: true,
          sourcemap: argv.sourcemap,
        },
      ];
    }
    if (outputOptionsList.length === 0) {
      console.error('Failed to detect output files.');
      process.exit(1);
    }

    let bundle: RollupBuild | undefined;
    let buildFailed = false;
    try {
      const _bundle = await rollup({
        input: argv.input || path.join('src', 'index.ts'),
        plugins,
      });
      bundle = _bundle;

      await Promise.allSettled(outputOptionsList.map((opts) => _bundle.write(opts)));
      if (argv.target === 'functions') {
        packageJson.name += '-dist';
        delete packageJson.devDependencies;
        await fs.promises.writeFile(path.join('dist', 'package.json'), JSON.stringify(packageJson));
      }
    } catch (error) {
      buildFailed = true;
      console.error('Filed to index due to:', error);
    }
    await bundle?.close();
    if (buildFailed) process.exit(1);
  },
};
