import fs from 'node:fs';

import { spawnAsync } from '@willbooster/shared-lib';
import { describe, expect, it } from 'vitest';

describe(
  'build',
  () => {
    it.concurrent('app-node', async () => {
      await buildAndRunApp('app-node', 'app');
    });

    it.concurrent('functions', async () => {
      await buildAndRunApp('functions', 'functions');
      const packageJson = await fs.promises.readFile(`test-fixtures/functions/dist/package.json`, 'utf8');
      expect(packageJson).to.includes('lodash.chunk');
      expect(packageJson).to.not.includes('lodash.compact');
      expect(packageJson).to.includes('lodash.concat');
      expect(packageJson).to.includes('"main":"index.cjs"');
    });

    it.concurrent('lib', async () => {
      const dirName = 'lib';
      await buildWithCommand(dirName, 'lib', '--module-type', 'both');
      const [cjsCode, esmCode] = await Promise.all([
        fs.promises.readFile(`test-fixtures/${dirName}/dist/cjs/index.js`, 'utf8'),
        fs.promises.readFile(`test-fixtures/${dirName}/dist/esm/index.mjs`, 'utf8'),
      ]);
      expect(cjsCode).to.includes('lodash/chunk');
      expect(esmCode).to.includes('lodash/chunk');

      const execRet = await spawnAsync('node', ['dist/cjs/index.js'], { cwd: `test-fixtures/lib` });
      expect(execRet.status).toBe(0);
    });

    it.concurrent('lib-react', async () => {
      const dirName = 'lib-react';
      await buildWithCommand(dirName, 'lib', '--js-extension', 'both');
      const [cjsCode, esmCode] = await Promise.all([
        fs.promises.readFile(`test-fixtures/${dirName}/dist/cjs/index.js`, 'utf8'),
        fs.promises.readFile(`test-fixtures/${dirName}/dist/esm/index.js`, 'utf8'),
      ]);
      expect(cjsCode).to.includes('lodash/chunk');
      expect(esmCode).to.includes('lodash/chunk');
    });
  },
  { timeout: 60_000 }
);

async function buildAndRunApp(dirName: string, subCommand: string): Promise<void> {
  await buildWithCommand(dirName, subCommand);

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

async function buildWithCommand(dirName: string, subCommand: string, ...options: string[]): Promise<void> {
  await spawnAsync('yarn', [], { cwd: `test-fixtures/${dirName}`, stdio: 'ignore' });
  const buildRet = await spawnAsync('yarn', ['start', subCommand, `test-fixtures/${dirName}`, ...options], {
    stdio: 'ignore',
  });
  expect(buildRet.status).toBe(0);
}
