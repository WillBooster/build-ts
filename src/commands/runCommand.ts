import * as child_process from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type { CommandModule, InferredOptionTypes } from 'yargs';

const builder = {
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

export const runCommand: CommandModule<unknown, InferredOptionTypes<typeof builder>> = {
  command: 'run <file>',
  describe: 'Run script',
  builder,
  async handler(argv) {
    const file = argv.file?.toString() || '';
    const module = await detectModuleType(file, argv.module);

    const args = ['--no-warnings'];
    if (argv.watch) {
      args.push('--watch');
    }
    if (module === 'cjs') {
      args.push('--require', 'ts-node/register');
    } else {
      args.push('--loader', 'ts-node/esm');
    }
    args.push(file);
    child_process.spawnSync('node', args, {
      shell: true,
      stdio: 'inherit',
      env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' },
    });
  },
};

async function detectModuleType(file: string, module?: string): Promise<'cjs' | 'esm'> {
  if (module === 'cjs' || file.endsWith('.cts')) {
    return 'cjs';
  }
  if (module === 'esm' || file.endsWith('.mts')) {
    return 'esm';
  }

  let dirPath = path.dirname(file);
  for (;;) {
    const packageJsonPath = path.join(dirPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJsonText = await fs.promises.readFile(packageJsonPath, 'utf8');
        const packageJson = JSON.parse(packageJsonText);
        if (packageJson.type === 'module') {
          return 'esm';
        }
      } catch {
        // do nothing
      }
      break;
    }

    const nextDirPath = path.dirname(dirPath);
    if (!nextDirPath || nextDirPath === dirPath) {
      break;
    }
    dirPath = nextDirPath;
  }
  return 'cjs';
}
