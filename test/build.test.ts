import fs from 'node:fs';

import { removeNpmAndYarnEnvironmentVariables, spawnAsync } from '@willbooster/shared-lib-node';
import { describe, expect, it } from 'vitest';

describe('build', { timeout: 60_000 }, () => {
  it('app-node', async () => {
    await buildAndRunApp('app-node', 'app', '--inline', 'A');
    const indexJs = await readGeneratedCode('test/fixtures/app-node/dist/index.js');
    // The minifier may emit string literals with double quotes or backticks.
    expect(indexJs).to.match(/\((?:"1"|`1`)\)/);
    expect(indexJs).to.not.includes('console.log');
    expect(indexJs).to.not.includes('console.table');
    expect(indexJs).to.includes('console.info');
    expect(indexJs).to.includes('console.warn');
    expect(indexJs).to.includes('console.error');
    expect(indexJs).to.includes('console.debug');
    expect(indexJs).to.not.includes('core-js');
    expect(indexJs).to.not.includes('@logged');
    expect(indexJs).to.not.includes('process.env.A');
  });

  it('app-node removes only global console calls in valid statements', async () => {
    const fixtureDirPath = '.tmp/test-fixtures/app-node-console-scope';
    await fs.promises.rm(fixtureDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(`${fixtureDirPath}/src`, { recursive: true });
    await fs.promises.writeFile(
      `${fixtureDirPath}/package.json`,
      JSON.stringify({
        packageManager: 'yarn@4.17.0',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/yarn.lock`, '');
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/index.ts`,
      `import './declare.js';
import './exported.js';
import './static-block.js';
import './type-only.js';

if (Math.random() < 0) console.log('global-if');
else process.stdout.write('else');
if (Math.random() < 0) console.log;
else process.stdout.write(':member-else');
if (Math.random() < 0) console.log.bind(console)();
else process.stdout.write(':bind-else');
for (let i = 0; i < 0; i++) console.log('global-for');
\\u0063onsole.log('escaped-global');
console.log || process.stdout.write(':fallback');
console.log.bind(console)();
if (Math.random() < 0) console?.log('optional-member');
console.log?.(process.stdout.write(':optional-call'));
if (Math.random() < 0) console.error?.('kept-error');
if (Math.random() < 0) {
  console.log++;
  for (console.log in { done: 1 }) {}
  ({ x: console.log } = { x: 'done' });
}
{
  const console = { log: (value: string) => process.stdout.write(value) };
  console.log(':block');
}

function localVarConsole() {
  {
    var console = { log: (value: string) => process.stdout.write(value) };
  }
  console.log(':var');
}

function localFunctionConsole() {
  function console() {}
  console.log = (value: string) => process.stdout.write(value);
  console.log(':function');
}

localVarConsole();
localFunctionConsole();

const power = console.log('power-global') ** 2;
void power;

if (Math.random() < 0) {
  class Derived extends console.log('extends-global') {}
  void Derived;
}

function foo() {
  process.stdout.write(':foo');
}

foo()
console.log('asi-global');
(function () {
  process.stdout.write(':iife');
})();
foo()
console.log?.(process.stdout.write(':optional-asi'));

function asiFunction(value: unknown) {
  process.stdout.write(':bad-asi');
  return value;
}

asiFunction
console.log('call-expression-asi-global') + 2;

function createLogger() {
  process.stdout.write(':logger');
  return 5;
}

createLogger()
console.log;
createLogger()
console.log.bind(console)();
switch (1) {
  case 1:
    createLogger()
    console.log;
}

function parameterDefault(value = console.log('param-default-global')) {
  const console = { log: (message: string) => process.stdout.write(message) };
  console.log(':param-body');
  return value;
}

parameterDefault();
`
    );
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/declare.ts`,
      `declare const console: { log: (value: string) => void };

console.log('declare-global');
`
    );
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/exported.ts`,
      `export const console = { log: (value: string) => process.stdout.write(value) };

console.log(':export');
`
    );
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/static-block.ts`,
      `class StaticBlock {
  static {
    if (Math.random() > -1) {
      var console = { log: (value: string) => process.stdout.write(value) };
    }
    console.log(':static');
  }
}

console.log('static-global');
void StaticBlock;
`
    );
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/type-only.ts`,
      `import type { console } from './types.js';

console.log('type-only-global');
`
    );
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/types.ts`,
      `export type console = { log: (value: string) => void };
`
    );

    await buildWithPackagePath(fixtureDirPath, 'app');
    const code = await readGeneratedCode(`${fixtureDirPath}/dist/index.js`);
    expect(code).to.not.includes('global-if');
    expect(code).to.not.includes('global-for');
    expect(code).to.not.includes('escaped-global');
    expect(code).to.not.includes('asi-global');
    expect(code).to.not.includes('call-expression-asi-global');
    expect(code).to.not.includes('extends-global');
    expect(code).to.not.includes('declare-global');
    expect(code).to.not.includes('param-default-global');
    expect(code).to.not.includes('power-global');
    expect(code).to.not.includes('static-global');
    expect(code).to.not.includes('type-only-global');
    expect(code).to.includes('optional-member');
    expect(code).to.includes('optional-call');
    expect(code).to.includes('kept-error');
    expect(code).to.includes(':block');
    expect(code).to.includes(':var');
    expect(code).to.includes(':function');
    expect(code).to.includes(':export');
    expect(code).to.includes(':static');
    expect(code).to.includes(':param-body');
    const execRet = await spawnAsync('node', ['dist/index.js'], { cwd: fixtureDirPath });
    expect(execRet.status).toBe(0);
    expect(execRet.stdout.toString()).toBe(
      ':export:staticelse:member-else:bind-else:optional-call:block:var:function:foo:iife:foo:optional-asi:logger:logger:logger:param-body'
    );
  });

  it('app-node removes console calls in CommonJS inputs with top-level return', async () => {
    const fixtureDirPath = '.tmp/test-fixtures/app-node-cjs-return';
    await fs.promises.rm(fixtureDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(`${fixtureDirPath}/src`, { recursive: true });
    await fs.promises.writeFile(`${fixtureDirPath}/package.json`, JSON.stringify({ packageManager: 'yarn@4.17.0' }));
    await fs.promises.writeFile(`${fixtureDirPath}/yarn.lock`, '');
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/index.cjs`,
      `console.log('cjs-before');
return;
console.log('cjs-after');
`
    );

    await buildWithPackagePath(fixtureDirPath, 'app', '--input', `${fixtureDirPath}/src/index.cjs`);
    const code = await readGeneratedCode(`${fixtureDirPath}/dist/index.js`);
    expect(code).to.not.includes('cjs-before');
    expect(code).to.not.includes('cjs-after');

    const jsFixtureDirPath = '.tmp/test-fixtures/app-node-cjs-js-return';
    await fs.promises.rm(jsFixtureDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(`${jsFixtureDirPath}/src`, { recursive: true });
    await fs.promises.writeFile(`${jsFixtureDirPath}/package.json`, JSON.stringify({ packageManager: 'yarn@4.17.0' }));
    await fs.promises.writeFile(`${jsFixtureDirPath}/yarn.lock`, '');
    await fs.promises.writeFile(
      `${jsFixtureDirPath}/src/index.js`,
      `console.log('cjs-js-before');
return;
console.log('cjs-js-after');
`
    );

    await buildWithPackagePath(jsFixtureDirPath, 'app', '--input', `${jsFixtureDirPath}/src/index.js`);
    const jsCode = await readGeneratedCode(`${jsFixtureDirPath}/dist/index.js`);
    expect(jsCode).to.not.includes('cjs-js-before');
    expect(jsCode).to.not.includes('cjs-js-after');
  });

  it('app-node with multiple inputs', async () => {
    const fixtureDirPath = '.tmp/test-fixtures/app-node-multiple-inputs';
    await fs.promises.rm(fixtureDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(`${fixtureDirPath}/src`, { recursive: true });
    await fs.promises.writeFile(`${fixtureDirPath}/package.json`, JSON.stringify({ packageManager: 'yarn@4.17.0' }));
    await fs.promises.writeFile(`${fixtureDirPath}/yarn.lock`, '');
    await fs.promises.writeFile(`${fixtureDirPath}/src/a.ts`, `console.log('a');\n`);
    await fs.promises.writeFile(`${fixtureDirPath}/src/b.ts`, `console.log('b');\n`);

    await buildWithPackagePath(
      fixtureDirPath,
      'app',
      '--input',
      `${fixtureDirPath}/src/a.ts`,
      '--input',
      `${fixtureDirPath}/src/b.ts`
    );
    await expectFileExists(`${fixtureDirPath}/dist/a.js`);
    await expectFileExists(`${fixtureDirPath}/dist/b.js`);
  });

  it('app-node preserves dynamic import chunks', async () => {
    const fixtureDirPath = '.tmp/test-fixtures/app-node-dynamic-import';
    await fs.promises.rm(fixtureDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(`${fixtureDirPath}/src`, { recursive: true });
    await fs.promises.writeFile(
      `${fixtureDirPath}/package.json`,
      JSON.stringify({
        packageManager: 'yarn@4.17.0',
        type: 'module',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/yarn.lock`, '');
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/index.ts`,
      `const mod = await import('./lazy.js');
process.stdout.write(mod.marker);
`
    );
    await fs.promises.writeFile(`${fixtureDirPath}/src/lazy.ts`, `export const marker = 'lazy-loaded';\n`);

    await buildWithPackagePath(fixtureDirPath, 'app', '--module-type', 'esm');
    const distFileNames = await fs.promises.readdir(`${fixtureDirPath}/dist`);
    expect(distFileNames.filter((fileName) => fileName.endsWith('.js')).length).toBeGreaterThan(1);
    const execRet = await spawnAsync('node', ['dist/index.js'], { cwd: fixtureDirPath });
    expect(execRet.status).toBe(0);
    expect(execRet.stdout.trim()).toBe('lazy-loaded');
  });

  it('app-node preserves explicit js imports when ts sibling exists', async () => {
    const fixtureDirPath = '.tmp/test-fixtures/app-node-explicit-js-import';
    await fs.promises.rm(fixtureDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(`${fixtureDirPath}/src`, { recursive: true });
    await fs.promises.writeFile(
      `${fixtureDirPath}/package.json`,
      JSON.stringify({
        packageManager: 'yarn@4.17.0',
        type: 'module',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/yarn.lock`, '');
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/index.ts`,
      `import { marker } from './mod.js';
process.stdout.write(marker);
`
    );
    await fs.promises.writeFile(`${fixtureDirPath}/src/mod.js`, `export const marker = 'js-file';\n`);
    await fs.promises.writeFile(`${fixtureDirPath}/src/mod.ts`, `export const marker = 'ts-file';\n`);

    await buildWithPackagePath(fixtureDirPath, 'app', '--module-type', 'esm');
    const execRet = await spawnAsync('node', ['dist/index.js'], { cwd: fixtureDirPath });
    expect(execRet.status).toBe(0);
    expect(execRet.stdout.trim()).toBe('js-file');
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
    await buildWithCommand(dirName, 'lib', '--module-type', 'both');
    const [cjsCode, esmCode] = await Promise.all([
      fs.promises.readFile(`test/fixtures/${dirName}/dist/index.js`, 'utf8'),
      fs.promises.readFile(`test/fixtures/${dirName}/dist/index.mjs`, 'utf8'),
    ]);
    expect(cjsCode).to.includes('use client');
    expect(cjsCode).to.includes('use strict');
    expect(esmCode).to.includes('use client');
    expect(cjsCode).to.includes('lodash.chunk');
    expect(esmCode).to.includes('lodash.chunk');
    const sourceMap = JSON.parse(await fs.promises.readFile(`test/fixtures/${dirName}/dist/index.js.map`, 'utf8'));
    expect(sourceMap.mappings).not.toBe('');
    await expectDeclarationFiles(dirName, {
      'index.d.ts': 'export declare function Component(): import("react/jsx-runtime").JSX.Element;',
    });
  });

  it('lib with --out-dir and --declaration-only', async () => {
    const fixtureDirPath = '.tmp/test-fixtures/lib-custom-out';
    await fs.promises.rm(fixtureDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(`${fixtureDirPath}/src`, { recursive: true });
    await fs.promises.writeFile(
      `${fixtureDirPath}/package.json`,
      JSON.stringify({
        type: 'module',
        packageManager: 'yarn@4.17.0',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/yarn.lock`, '');
    await fs.promises.writeFile(
      `${fixtureDirPath}/tsconfig.json`,
      JSON.stringify({
        // `declarationDir` and `include` must be overridden by build-ts; otherwise declarations
        // would go to `configured-types` and cover `unreachable.ts` despite the explicit `--input`.
        compilerOptions: {
          declarationDir: 'configured-types',
          module: 'esnext',
          moduleResolution: 'bundler',
          strict: true,
          target: 'es2022',
        },
        include: ['src/**/*'],
      })
    );
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/routes.ts`,
      `import { helper } from './helper.js';
export const routes = { helper };
`
    );
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/helper.ts`,
      'export function helper(): number {\n  return 1;\n}\n'
    );
    await fs.promises.writeFile(`${fixtureDirPath}/src/unreachable.ts`, 'export const secret = 42;\n');

    const runtimeOutDirPath = '.tmp/test-fixtures/lib-custom-out-runtime';
    await fs.promises.rm(runtimeOutDirPath, { recursive: true, force: true });
    await buildWithPackagePath(
      fixtureDirPath,
      'lib',
      '--module-type',
      'esm',
      '--input',
      `${fixtureDirPath}/src/routes.ts`,
      '--out-dir',
      runtimeOutDirPath
    );
    const runtimeFileNames = await fs.promises.readdir(runtimeOutDirPath);
    expect(runtimeFileNames.toSorted()).toEqual([
      'helper.d.ts',
      'helper.js',
      'helper.js.map',
      'routes.d.ts',
      'routes.js',
      'routes.js.map',
    ]);
    expect(fs.existsSync(`${fixtureDirPath}/dist`)).toBe(false);

    const typesOutDirPath = '.tmp/test-fixtures/lib-custom-out-types';
    await fs.promises.rm(typesOutDirPath, { recursive: true, force: true });
    await buildWithPackagePath(
      fixtureDirPath,
      'lib',
      '--declaration-only',
      '--input',
      `${fixtureDirPath}/src/routes.ts`,
      '--out-dir',
      typesOutDirPath
    );
    const typesFileNames = await fs.promises.readdir(typesOutDirPath);
    expect(typesFileNames.toSorted()).toEqual(['helper.d.ts', 'routes.d.ts']);
    expect(fs.existsSync(`${fixtureDirPath}/configured-types`)).toBe(false);

    const failedRet = await buildWithPackagePathAndGetStatus(
      fixtureDirPath,
      'lib',
      '--input',
      `${fixtureDirPath}/src/routes.ts`,
      '--out-dir',
      `${fixtureDirPath}/src`
    );
    expect(failedRet.status).not.toBe(0);
    expect(fs.existsSync(`${fixtureDirPath}/src/routes.ts`)).toBe(true);

    // An input outside `src` still must not be erased by the output directory.
    await fs.promises.mkdir(`${fixtureDirPath}/scripts`, { recursive: true });
    await fs.promises.writeFile(`${fixtureDirPath}/scripts/main.ts`, 'export const main = 1;\n');
    const containedRet = await buildWithPackagePathAndGetStatus(
      fixtureDirPath,
      'lib',
      '--input',
      `${fixtureDirPath}/scripts/main.ts`,
      '--out-dir',
      `${fixtureDirPath}/scripts`
    );
    expect(containedRet.status).not.toBe(0);
    expect(fs.existsSync(`${fixtureDirPath}/scripts/main.ts`)).toBe(true);
  });

  it('lib with glob --input builds every matched module as an entry', async () => {
    const fixtureDirPath = '.tmp/test-fixtures/lib-glob-input';
    await fs.promises.rm(fixtureDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(`${fixtureDirPath}/src/sub`, { recursive: true });
    await fs.promises.writeFile(
      `${fixtureDirPath}/package.json`,
      JSON.stringify({
        type: 'module',
        packageManager: 'yarn@4.17.0',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/yarn.lock`, '');
    await fs.promises.writeFile(
      `${fixtureDirPath}/tsconfig.json`,
      JSON.stringify({
        compilerOptions: {
          module: 'esnext',
          moduleResolution: 'bundler',
          strict: true,
          target: 'es2022',
        },
        include: ['src/**/*'],
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/src/index.ts`, 'export function main(): number {\n  return 1;\n}\n');
    // Not imported from index.ts, so a single-entry build would drop its exports.
    await fs.promises.writeFile(`${fixtureDirPath}/src/schemas.ts`, 'export const schema = { id: 1 };\n');
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/sub/util.ts`,
      'export function util(): number {\n  return 2;\n}\n'
    );
    await fs.promises.writeFile(`${fixtureDirPath}/src/ambient.d.ts`, 'declare const AMBIENT: string;\n');
    // A broken symlink matched by the glob must be skipped, not crash the build.
    await fs.promises.symlink('missing.ts', `${fixtureDirPath}/src/broken.ts`);

    await buildWithPackagePath(
      fixtureDirPath,
      'lib',
      '--module-type',
      'esm',
      '--input',
      `${fixtureDirPath}/src/**/*.ts`
    );

    await expectFileExists(`${fixtureDirPath}/dist/index.js`);
    await expectFileExists(`${fixtureDirPath}/dist/schemas.js`);
    await expectFileExists(`${fixtureDirPath}/dist/schemas.d.ts`);
    await expectFileExists(`${fixtureDirPath}/dist/sub/util.js`);
    expect(fs.existsSync(`${fixtureDirPath}/dist/ambient.js`)).toBe(false);
    expect(fs.existsSync(`${fixtureDirPath}/dist/broken.js`)).toBe(false);

    const ret = await spawnAsync(
      'node',
      ['-e', "import('./dist/schemas.js').then((mod) => process.exit(mod.schema.id === 1 ? 0 : 1))"],
      { cwd: fixtureDirPath }
    );
    expect(ret.status).toBe(0);

    // A brace alternation expands to each listed entry.
    const braceOutDirPath = '.tmp/test-fixtures/lib-glob-input-brace';
    await buildWithPackagePath(
      fixtureDirPath,
      'lib',
      '--declaration-only',
      '--input',
      `${fixtureDirPath}/src/{index,schemas}.ts`,
      '--out-dir',
      braceOutDirPath
    );
    expect(fs.readdirSync(braceOutDirPath).toSorted()).toEqual(['index.d.ts', 'schemas.d.ts']);
  });

  it('functions fails on conflicting entry names instead of silently dropping one', async () => {
    const fixtureDirPath = '.tmp/test-fixtures/functions-conflicting-entries';
    await fs.promises.rm(fixtureDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(`${fixtureDirPath}/src/one`, { recursive: true });
    await fs.promises.mkdir(`${fixtureDirPath}/src/two`, { recursive: true });
    await fs.promises.writeFile(
      `${fixtureDirPath}/package.json`,
      JSON.stringify({ type: 'module', packageManager: 'yarn@4.17.0' })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/yarn.lock`, '');
    await fs.promises.writeFile(`${fixtureDirPath}/src/index.ts`, 'export const main = 1;\n');
    await fs.promises.writeFile(`${fixtureDirPath}/src/one/handler.ts`, 'export const marker = "one";\n');
    await fs.promises.writeFile(`${fixtureDirPath}/src/two/handler.ts`, 'export const marker = "two";\n');

    const ret = await buildWithPackagePathAndGetStatus(
      fixtureDirPath,
      'functions',
      '--input',
      `${fixtureDirPath}/src/index.ts`,
      '--input',
      `${fixtureDirPath}/src/one/handler.ts`,
      '--input',
      `${fixtureDirPath}/src/two/handler.ts`
    );
    expect(ret.status).not.toBe(0);
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
  await buildWithPackagePath(`test/fixtures/${dirName}`, subCommand, ...options);
}

async function buildWithPackagePath(packagePath: string, subCommand: string, ...options: string[]): Promise<void> {
  const buildRet = await buildWithPackagePathAndGetStatus(packagePath, subCommand, ...options);
  expect(buildRet.status).toBe(0);
}

async function buildWithPackagePathAndGetStatus(
  packagePath: string,
  subCommand: string,
  ...options: string[]
): Promise<Awaited<ReturnType<typeof spawnAsync>>> {
  const fixtureEnv = createFixtureCommandEnv();
  await fs.promises.rm(`${packagePath}/node_modules`, { recursive: true, force: true });
  const installRet = await spawnAsync('yarn', [], { cwd: packagePath, env: fixtureEnv, stdio: 'inherit' });
  expect(installRet.status).toBe(0);
  return spawnAsync('yarn', ['start', subCommand, packagePath, ...options], {
    env: fixtureEnv,
    stdio: 'inherit',
  });
}

function createFixtureCommandEnv(): NodeJS.ProcessEnv {
  const fixtureEnv = { ...process.env };
  removeNpmAndYarnEnvironmentVariables(fixtureEnv);
  fixtureEnv.YARN_ENABLE_HARDENED_MODE = '0';
  delete fixtureEnv.CI;
  delete fixtureEnv.GITHUB_ACTIONS;
  delete fixtureEnv.GITHUB_EVENT_NAME;
  delete fixtureEnv.GITHUB_EVENT_PATH;
  return fixtureEnv;
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
