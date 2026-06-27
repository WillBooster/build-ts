import fs from 'node:fs';

import { removeNpmAndYarnEnvironmentVariables, spawnAsync } from '@willbooster/shared-lib-node';
import { describe, expect, it } from 'vitest';

describe('build', { timeout: 60_000 }, () => {
  it('app-node', async () => {
    await buildAndRunApp('app-node', 'app', '--inline', 'A');
    const indexJs = await readGeneratedCode('test/fixtures/app-node/dist/index.js');
    expect(indexJs).to.includes('("1")');
    expect(indexJs).to.includes('console.log');
    expect(indexJs).to.not.includes('core-js');
    expect(indexJs).to.not.includes('@logged');
    expect(indexJs).to.not.includes('process.env.A');
  });

  it('app-node with core-js', async () => {
    await buildWithCommand('app-node', 'app', '--inline', 'A', '--core-js');
    const indexJs = await readGeneratedCode('test/fixtures/app-node/dist/index.js');
    expect(indexJs).to.includes('core-js');
    expect(indexJs).to.includes('("1")');
    await runApp('app-node');
    expect(indexJs).to.not.includes('process.env.A');
  });

  it('app-node with bundled builtin-name dependency', async () => {
    await buildAndRunApp('app-node', 'app', '--inline', 'A', '--bundle-builtins', 'punycode');
    const indexJs = await readGeneratedCode('test/fixtures/app-node/dist/index.js');
    expect(indexJs).to.not.includes('require("punycode")');
  });

  it('functions', async () => {
    await buildAndRunApp('functions', 'functions');
    const packageJson = await fs.promises.readFile('test/fixtures/functions/dist/package.json', 'utf8');
    expect(packageJson).to.includes('lodash.chunk');
    expect(packageJson).to.not.includes('lodash.compact');
    expect(packageJson).to.includes('lodash.concat');
    expect(packageJson).to.includes('"main":"index.js"');
  });

  it.each([
    ['lib', 'index.js', 'index.mjs', "export { add } from './module';"],
    ['lib-esm', 'index.cjs', 'index.js', "export { add } from './module.js';"],
  ])('%s', async (dirName, cjsName, esmName, indexDeclaration) => {
    await buildWithCommand(dirName, 'lib', '--module-type', 'both');
    const [cjsCode, esmCode] = await Promise.all([
      fs.promises.readFile(`test/fixtures/${dirName}/dist/${cjsName}`, 'utf8'),
      fs.promises.readFile(`test/fixtures/${dirName}/dist/${esmName}`, 'utf8'),
    ]);
    expect(cjsCode).to.includes('lodash.chunk');
    expect(esmCode).to.includes('lodash.chunk');
    await expectDeclarationFiles(dirName, {
      'index.d.ts': indexDeclaration,
      'module.d.ts': 'export declare function add(a: number, b: number): number;',
    });

    const execRet = await spawnAsync('node', ['dist/index.js'], { cwd: `test/fixtures/${dirName}` });
    expect(execRet.status).toBe(0);
  });

  it('lib-react', async () => {
    const dirName = 'lib-react';
    await buildWithCommand(dirName, 'lib', '--js-extension', 'both');
    const [cjsCode, esmCode] = await Promise.all([
      fs.promises.readFile(`test/fixtures/${dirName}/dist/index.js`, 'utf8'),
      fs.promises.readFile(`test/fixtures/${dirName}/dist/index.js`, 'utf8'),
    ]);
    expect(cjsCode).to.includes('use client');
    expect(cjsCode).to.includes('use strict');
    expect(esmCode).to.includes('use client');
    expect(esmCode).to.includes('use strict');
    expect(cjsCode).to.includes('lodash.chunk');
    expect(esmCode).to.includes('lodash.chunk');
    const sourceMap = JSON.parse(await fs.promises.readFile(`test/fixtures/${dirName}/dist/index.js.map`, 'utf8'));
    expect(sourceMap.mappings).not.toBe('');
    await expectDeclarationFiles(dirName, {
      'index.d.ts': 'export declare function Component(): import("react/jsx-runtime").JSX.Element;',
    });
  });

  it('lib-react-ts-entry', async () => {
    const dirName = 'lib-react-ts-entry';
    await buildWithCommand(dirName, 'lib', '--module-type', 'both');

    const [cjsCode, esmCode] = await Promise.all([
      fs.promises.readFile(`test/fixtures/${dirName}/dist/component.cjs`, 'utf8'),
      fs.promises.readFile(`test/fixtures/${dirName}/dist/component.js`, 'utf8'),
    ]);
    expect(cjsCode).to.includes('use client');
    expect(esmCode).to.includes('use client');
    expect(cjsCode).to.includes('require("@scope/dep")');
    expect(esmCode).to.includes('from"@scope/dep"');

    await expectFileExists(`test/fixtures/${dirName}/dist/index.cjs`);
    await expectFileExists(`test/fixtures/${dirName}/dist/index.js`);
    await expectPathDoesNotExist(`test/fixtures/${dirName}/dist/src`);
    await expectPathDoesNotExist(`test/fixtures/${dirName}/dist/node_modules`);
    await expectDeclarationFiles(dirName, {
      'component.d.ts': 'export declare function Component(): import("react/jsx-runtime").JSX.Element;',
      'index.d.ts': "export { Component } from './component';",
    });
  });
});

async function buildAndRunApp(dirName: string, subCommand: string, ...options: string[]): Promise<void> {
  await buildWithCommand(dirName, subCommand, ...options);

  const [code] = await Promise.all([
    fs.promises.readFile(`test/fixtures/${dirName}/dist/index.js`, 'utf8'),
    fs.promises.rm(`test/fixtures/${dirName}/node_modules/lodash.compact`, { recursive: true, force: true }),
  ]);
  expect(code).to.includes('lodash.chunk');
  expect(code).to.not.includes('lodash.compact');
  expect(code).to.includes('lodash.concat');
  await runApp(dirName);
}

async function buildWithCommand(dirName: string, subCommand: string, ...options: string[]): Promise<void> {
  removeNpmAndYarnEnvironmentVariables(process.env);
  await spawnAsync('yarn', [], { cwd: `test/fixtures/${dirName}`, stdio: 'inherit' });
  const buildRet = await spawnAsync('yarn', ['start', subCommand, `test/fixtures/${dirName}`, ...options], {
    stdio: 'inherit',
  });
  expect(buildRet.status).toBe(0);
}

async function readGeneratedCode(filePath: string): Promise<string> {
  const code = await fs.promises.readFile(filePath, 'utf8');
  return code.split('\n//# sourceMappingURL=')[0] ?? code;
}

async function runApp(dirName: string): Promise<void> {
  const execRet = await spawnAsync('node', ['dist/index.js'], { cwd: `test/fixtures/${dirName}` });
  expect(execRet.status).toBe(0);
}

async function expectDeclarationFiles(dirName: string, expectedDeclarations: Record<string, string>): Promise<void> {
  const fixtureDirPath = `test/fixtures/${dirName}`;
  await Promise.all(
    Object.entries(expectedDeclarations).map(async ([fileName, expected]) => {
      const declaration = await fs.promises.readFile(`${fixtureDirPath}/dist/${fileName}`, 'utf8');
      expect(declaration.trim()).toBe(expected);
    })
  );
  const fixtureFileNames = await fs.promises.readdir(fixtureDirPath);
  const tempConfigFiles = fixtureFileNames.filter((fileName) => fileName.startsWith('.build-ts-tsgo.'));
  expect(tempConfigFiles).toEqual([]);
}

async function expectFileExists(filePath: string): Promise<void> {
  await expect(fs.promises.stat(filePath)).resolves.toBeDefined();
}

async function expectPathDoesNotExist(filePath: string): Promise<void> {
  await expect(fs.promises.stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
}
