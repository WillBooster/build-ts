import fs from 'node:fs';

import { removeNpmAndYarnEnvironmentVariables, spawnAsync } from '@willbooster/shared-lib-node';
import { describe, expect, it } from 'vitest';

describe('build', { timeout: 60_000 }, () => {
  it.concurrent('app-node', async () => {
    await buildAndRunApp('app-node', 'app', '--inline', 'A');
    const indexJs = await fs.promises.readFile('test-fixtures/app-node/dist/index.js', 'utf8');
    expect(indexJs).to.includes('("1")');
    expect(indexJs).to.not.includes('process.env.A');
  });

  it.concurrent('functions', async () => {
    await buildAndRunApp('functions', 'functions');
    const packageJson = await fs.promises.readFile('test-fixtures/functions/dist/package.json', 'utf8');
    expect(packageJson).to.includes('lodash.chunk');
    expect(packageJson).to.not.includes('lodash.compact');
    expect(packageJson).to.includes('lodash.concat');
    expect(packageJson).to.includes('"main":"index.js"');
  });

  it.concurrent.each([
    ['lib', 'index.js', 'index.mjs'],
    ['lib-esm', 'index.cjs', 'index.js'],
  ])('%s', async (dirName, cjsName, esmName) => {
    await buildWithCommand(dirName, 'lib', '--module-type', 'both');
    const [cjsCode, esmCode] = await Promise.all([
      fs.promises.readFile(`test-fixtures/${dirName}/dist/${cjsName}`, 'utf8'),
      fs.promises.readFile(`test-fixtures/${dirName}/dist/${esmName}`, 'utf8'),
    ]);
    expect(cjsCode).to.includes('lodash.chunk');
    expect(esmCode).to.includes('lodash.chunk');
    expect(fs.existsSync(`test-fixtures/${dirName}/dist/index.d.ts`)).toBeTruthy();
    expect(fs.existsSync(`test-fixtures/${dirName}/dist/module.d.ts`)).toBeTruthy();

    const execRet = await spawnAsync('node', ['dist/index.js'], { cwd: `test-fixtures/${dirName}` });
    expect(execRet.status).toBe(0);
  });

  it.concurrent('lib-react', async () => {
    const dirName = 'lib-react';
    await buildWithCommand(dirName, 'lib', '--js-extension', 'both');
    const [cjsCode, esmCode] = await Promise.all([
      fs.promises.readFile(`test-fixtures/${dirName}/dist/index.js`, 'utf8'),
      fs.promises.readFile(`test-fixtures/${dirName}/dist/index.js`, 'utf8'),
    ]);
    expect(cjsCode).to.includes('use client');
    expect(esmCode).to.includes('use client');
    expect(cjsCode).to.includes('lodash.chunk');
    expect(esmCode).to.includes('lodash.chunk');
    expect(fs.existsSync(`test-fixtures/${dirName}/dist/index.d.ts`)).toBeTruthy();
  });
});

async function buildAndRunApp(dirName: string, subCommand: string, ...options: string[]): Promise<void> {
  await buildWithCommand(dirName, subCommand, ...options);

  const [code] = await Promise.all([
    fs.promises.readFile(`test-fixtures/${dirName}/dist/index.js`, 'utf8'),
    fs.promises.rm(`test-fixtures/${dirName}/node_modules/lodash.compact`, { recursive: true, force: true }),
  ]);
  expect(code).to.includes('lodash.chunk');
  expect(code).to.not.includes('lodash.compact');
  expect(code).to.includes('lodash.concat');
  const execRet = await spawnAsync('node', ['dist/index.js'], { cwd: `test-fixtures/${dirName}` });
  expect(execRet.status).toBe(0);
}

async function buildWithCommand(dirName: string, subCommand: string, ...options: string[]): Promise<void> {
  removeNpmAndYarnEnvironmentVariables(process.env);
  await spawnAsync('yarn', [], { cwd: `test-fixtures/${dirName}`, stdio: 'inherit' });
  const buildRet = await spawnAsync('yarn', ['start', subCommand, `test-fixtures/${dirName}`, ...options], {
    stdio: 'inherit',
  });
  expect(buildRet.status).toBe(0);
}
