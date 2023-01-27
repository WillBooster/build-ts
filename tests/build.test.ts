import fs from 'node:fs';

import { spawnAsync } from '@willbooster/shared-lib';
import { describe, expect, it } from 'vitest';

describe(
  'build',
  () => {
    it('app-node', async () => {
      await buildAndRun('app-node', 'app');
    });

    it('functions', async () => {
      await buildAndRun('functions', 'functions');
      const packageJson = await fs.promises.readFile(`test-fixtures/functions/dist/package.json`, 'utf8');
      expect(packageJson).to.includes('lodash.chunk');
      expect(packageJson).to.not.includes('lodash.compact');
      expect(packageJson).to.includes('lodash.concat');
    });

    it('lib', async () => {
      await build('lib', 'lib');

      const dirName = 'lib';
      const [cjsCode, esmCode] = await Promise.all([
        fs.promises.readFile(`test-fixtures/${dirName}/dist/cjs/index.cjs`, 'utf8'),
        fs.promises.readFile(`test-fixtures/${dirName}/dist/esm/index.mjs`, 'utf8'),
      ]);
      expect(cjsCode).to.includes('lodash/chunk');
      expect(esmCode).to.includes('lodash/chunk');
      const execRet = await spawnAsync('node', ['dist/cjs/index.cjs'], { cwd: `test-fixtures/${dirName}` });
      expect(execRet.status).toBe(0);
    });
  },
  { timeout: 60_000 }
);

async function build(dirName: string, subCommand: string): Promise<void> {
  await spawnAsync('yarn', [], { cwd: `test-fixtures/${dirName}`, stdio: 'ignore' });
  const buildRet = await spawnAsync('yarn', ['start', subCommand, `test-fixtures/${dirName}`], { stdio: 'ignore' });
  expect(buildRet.status).toBe(0);
}

async function buildAndRun(dirName: string, subCommand: string): Promise<void> {
  await build(dirName, subCommand);
  const [code] = await Promise.all([
    fs.promises.readFile(`test-fixtures/${dirName}/dist/index.cjs`, 'utf8'),
    fs.promises.rm(`test-fixtures/${dirName}/node_modules/lodash.compact`, { recursive: true, force: true }),
  ]);
  expect(code).to.includes('lodash/chunk');
  expect(code).to.not.includes('lodash/compact');
  expect(code).to.includes('lodash/concat');
  const execRet = await spawnAsync('node', ['dist/index.cjs'], { cwd: `test-fixtures/${dirName}` });
  expect(execRet.status).toBe(0);
}
