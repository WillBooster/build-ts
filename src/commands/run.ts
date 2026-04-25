import * as child_process from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type { CommandModule, InferredOptionTypes } from 'yargs';

import { loadEnvironmentVariablesWithCache } from '../env.js';
import { sharedOptionsBuilder } from '../sharedOptionsBuilder.js';

const builder = {
  ...sharedOptionsBuilder,
  module: {
    description: 'A module type: cjs or esm',
    type: 'string',
    alias: 'm',
  },
  watch: {
    description: 'Whether watch mode is enabled or not',
    type: 'boolean',
    alias: 'w',
  },
} as const;

export const run: CommandModule<unknown, InferredOptionTypes<typeof builder>> = {
  command: 'run <file>',
  describe: 'Run script',
  builder,
  handler(argv) {
    loadEnvironmentVariablesWithCache(argv, process.cwd());

    const file = argv.file?.toString() ?? '';

    // cf. https://bun.sh/guides/util/detect-bun
    const isRunningOnBun = process.versions.bun;
    const runtime = isRunningOnBun ? 'bun' : 'node';
    const args = isRunningOnBun ? ['--bun'] : ['--no-warnings', '--import', 'tsx'];
    const tsconfigPath = isRunningOnBun ? undefined : createTsxTsconfig(process.cwd(), file);
    if (argv.watch) {
      args.push('--watch');
    }
    args.push(file);
    const [, ...additionalArguments] = argv._;
    const runtimeArgs = [...args, ...additionalArguments.map((arg) => arg.toString())];
    if (argv.verbose) {
      console.info(`Running '${runtime} ${runtimeArgs.join(' ')}'`);
    }
    let status = 1;
    try {
      const ret = child_process.spawnSync(runtime, runtimeArgs, {
        stdio: 'inherit',
        env: { ...process.env, ...(tsconfigPath ? { TSX_TSCONFIG_PATH: tsconfigPath } : {}) },
      });
      status = ret.status ?? 1;
    } finally {
      if (tsconfigPath) {
        fs.rmSync(tsconfigPath, { force: true });
      }
    }
    process.exit(status);
  },
};

function createTsxTsconfig(cwd: string, file: string): string {
  const realCwd = fs.realpathSync(cwd);
  const configFile = findConfigFile(realCwd);
  const configDirPath = path.dirname(fs.realpathSync(path.resolve(realCwd, file)));
  const tempConfigFile = path.join(configDirPath, `.build-ts-tsx.${process.pid}.${Date.now()}.json`);
  const config: Record<string, unknown> = {
    compilerOptions: {
      experimentalDecorators: true,
    },
    include: getTsxTsconfigIncludes(configDirPath, realCwd),
  };
  if (configFile) {
    config.extends = toRelativeConfigPath(configDirPath, configFile);
  }
  fs.writeFileSync(tempConfigFile, JSON.stringify(config, undefined, 2));
  return tempConfigFile;
}

function getTsxTsconfigIncludes(configDirPath: string, cwd: string): string[] {
  const relativePath = path.relative(configDirPath, cwd).replaceAll(path.sep, '/');
  if (!relativePath) return ['**/*'];

  const relativeCwdPath = relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
  return ['**/*', `${relativeCwdPath}/**/*`];
}

function findConfigFile(dirPath: string): string | undefined {
  let currentDirPath = path.resolve(dirPath);
  while (true) {
    const configFile = path.join(currentDirPath, 'tsconfig.json');
    if (fs.existsSync(configFile)) return configFile;

    const parentDirPath = path.dirname(currentDirPath);
    if (parentDirPath === currentDirPath) return undefined;
    currentDirPath = parentDirPath;
  }
}

function toRelativeConfigPath(fromDirPath: string, toFilePath: string): string {
  const relativePath = path.relative(fromDirPath, toFilePath).replaceAll(path.sep, '/');
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}
