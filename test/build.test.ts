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
    expect(indexJs.startsWith('"use strict";')).toBe(true);
    expect(indexJs).to.includes('__commonJSMin');
    expect(indexJs).to.not.includes('require("core-js');
    expect(indexJs).to.includes('("1")');
    await runApp('app-node');
    expect(indexJs).to.not.includes('process.env.A');
  });

  it('app-node ESM with core-js', async () => {
    const fixtureDirPath = '.tmp/test-fixtures/app-node-esm-core-js';
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
      `#!/usr/bin/env node
const values = [1, 2, 3].toReversed();
console.log(values.join(','));
`
    );

    await buildWithPackagePath(fixtureDirPath, 'app', '--core-js', '--module-type', 'esm');
    const execRet = await spawnAsync('node', ['dist/index.js'], { cwd: fixtureDirPath });
    expect(execRet.status).toBe(0);
    expect(execRet.stdout.trim()).toBe('3,2,1');
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
console.log(mod.marker);
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

  it('app-node with bundled builtin-name dependency', async () => {
    await buildAndRunApp('app-node', 'app', '--inline', 'A', '--bundle-builtins', 'punycode');
    const indexJs = await readGeneratedCode('test/fixtures/app-node/dist/index.js');
    expect(indexJs).to.not.includes('require("punycode")');
    expect(indexJs).to.not.includes('require("node:punycode")');
  });

  it('app-node with bundled builtin-name dependency using package exports', async () => {
    const fixtureDirPath = '.tmp/test-fixtures/app-node-builtin-exports';
    await fs.promises.rm(fixtureDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(`${fixtureDirPath}/buffer-package`, { recursive: true });
    await fs.promises.mkdir(`${fixtureDirPath}/src`, { recursive: true });
    await fs.promises.writeFile(
      `${fixtureDirPath}/package.json`,
      JSON.stringify({
        dependencies: { buffer: 'file:./buffer-package' },
        packageManager: 'yarn@4.17.0',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/yarn.lock`, '');
    await fs.promises.writeFile(
      `${fixtureDirPath}/buffer-package/package.json`,
      JSON.stringify({
        exports: './index.js',
        name: 'buffer',
        type: 'module',
        version: '1.0.0',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/buffer-package/index.js`, `export const marker = 'local-buffer';\n`);
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/index.ts`,
      `import { marker } from 'node:buffer';
console.log(marker);
`
    );

    await buildWithPackagePath(fixtureDirPath, 'app', '--bundle-builtins', 'buffer');
    const execRet = await spawnAsync('node', ['dist/index.js'], { cwd: fixtureDirPath });
    expect(execRet.status).toBe(0);
    expect(execRet.stdout.trim()).toBe('local-buffer');
  });

  it('app-node with bundled builtin-name dependency using conditional package exports', async () => {
    const fixtureDirPath = '.tmp/test-fixtures/app-node-builtin-conditional-exports';
    await fs.promises.rm(fixtureDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(`${fixtureDirPath}/buffer-package`, { recursive: true });
    await fs.promises.mkdir(`${fixtureDirPath}/src`, { recursive: true });
    await fs.promises.writeFile(
      `${fixtureDirPath}/package.json`,
      JSON.stringify({
        dependencies: { buffer: 'file:./buffer-package' },
        packageManager: 'yarn@4.17.0',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/yarn.lock`, '');
    await fs.promises.writeFile(
      `${fixtureDirPath}/buffer-package/package.json`,
      JSON.stringify({
        exports: {
          '.': {
            node: './node.js',
            default: './default.js',
          },
        },
        name: 'buffer',
        type: 'module',
        version: '1.0.0',
      })
    );
    await fs.promises.writeFile(
      `${fixtureDirPath}/buffer-package/default.js`,
      `export const marker = 'default-branch';\n`
    );
    await fs.promises.writeFile(`${fixtureDirPath}/buffer-package/node.js`, `export const marker = 'node-branch';\n`);
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/index.ts`,
      `import { marker } from 'node:buffer';
console.log(marker);
`
    );

    await buildWithPackagePath(fixtureDirPath, 'app', '--bundle-builtins', 'buffer');
    const execRet = await spawnAsync('node', ['dist/index.js'], { cwd: fixtureDirPath });
    expect(execRet.status).toBe(0);
    expect(execRet.stdout.trim()).toBe('node-branch');
  });

  it('app-node with bundled builtin-name dependency using import package exports', async () => {
    const fixtureDirPath = '.tmp/test-fixtures/app-node-builtin-import-exports';
    await fs.promises.rm(fixtureDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(`${fixtureDirPath}/buffer-package`, { recursive: true });
    await fs.promises.mkdir(`${fixtureDirPath}/src`, { recursive: true });
    await fs.promises.writeFile(
      `${fixtureDirPath}/package.json`,
      JSON.stringify({
        dependencies: { buffer: 'file:./buffer-package' },
        packageManager: 'yarn@4.17.0',
        type: 'module',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/yarn.lock`, '');
    await fs.promises.writeFile(
      `${fixtureDirPath}/buffer-package/package.json`,
      JSON.stringify({
        exports: {
          '.': {
            require: './require.cjs',
            import: './import.js',
            default: './default.js',
          },
        },
        name: 'buffer',
        type: 'module',
        version: '1.0.0',
      })
    );
    await fs.promises.writeFile(
      `${fixtureDirPath}/buffer-package/default.js`,
      `export const marker = 'default-branch';\n`
    );
    await fs.promises.writeFile(
      `${fixtureDirPath}/buffer-package/import.js`,
      `export const marker = 'import-branch';\n`
    );
    await fs.promises.writeFile(`${fixtureDirPath}/buffer-package/require.cjs`, `exports.marker = 'require-branch';\n`);
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/index.ts`,
      `import { marker } from 'node:buffer';
console.log(marker);
`
    );

    await buildWithPackagePath(fixtureDirPath, 'app', '--bundle-builtins', 'buffer', '--module-type', 'esm');
    const execRet = await spawnAsync('node', ['dist/index.js'], { cwd: fixtureDirPath });
    expect(execRet.status).toBe(0);
    expect(execRet.stdout.trim()).toBe('import-branch');
  });

  it('app-node with bundled dependency using root import package exports', async () => {
    const fixtureDirPath = '.tmp/test-fixtures/app-node-builtin-non-builtin-import-exports';
    await fs.promises.rm(fixtureDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(`${fixtureDirPath}/undici-package`, { recursive: true });
    await fs.promises.mkdir(`${fixtureDirPath}/src`, { recursive: true });
    await fs.promises.writeFile(
      `${fixtureDirPath}/package.json`,
      JSON.stringify({
        dependencies: { undici: 'file:./undici-package' },
        packageManager: 'yarn@4.17.0',
        type: 'module',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/yarn.lock`, '');
    await fs.promises.writeFile(
      `${fixtureDirPath}/undici-package/package.json`,
      JSON.stringify({
        exports: {
          '.': {
            require: './require.cjs',
            import: './import.js',
          },
        },
        name: 'undici',
        type: 'module',
        version: '1.0.0',
      })
    );
    await fs.promises.writeFile(
      `${fixtureDirPath}/undici-package/import.js`,
      `export const marker = 'import-branch';\n`
    );
    await fs.promises.writeFile(`${fixtureDirPath}/undici-package/require.cjs`, `exports.marker = 'require-branch';\n`);
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/index.ts`,
      `import { marker } from 'undici';
console.log(marker);
`
    );

    await buildWithPackagePath(fixtureDirPath, 'app', '--bundle-builtins', 'undici', '--module-type', 'esm');
    const execRet = await spawnAsync('node', ['dist/index.js'], { cwd: fixtureDirPath });
    expect(execRet.status).toBe(0);
    expect(execRet.stdout.trim()).toBe('import-branch');
  });

  it('app-node with bundled builtin-name dependency using require package exports', async () => {
    const fixtureDirPath = '.tmp/test-fixtures/app-node-builtin-require-exports';
    await fs.promises.rm(fixtureDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(`${fixtureDirPath}/buffer-package`, { recursive: true });
    await fs.promises.mkdir(`${fixtureDirPath}/src`, { recursive: true });
    await fs.promises.writeFile(
      `${fixtureDirPath}/package.json`,
      JSON.stringify({
        dependencies: { buffer: 'file:./buffer-package' },
        packageManager: 'yarn@4.17.0',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/yarn.lock`, '');
    await fs.promises.writeFile(
      `${fixtureDirPath}/buffer-package/package.json`,
      JSON.stringify({
        exports: {
          '.': {
            import: './import.js',
            require: './require.cjs',
            default: './default.js',
          },
        },
        name: 'buffer',
        type: 'module',
        version: '1.0.0',
      })
    );
    await fs.promises.writeFile(
      `${fixtureDirPath}/buffer-package/default.js`,
      `export const marker = 'default-branch';\n`
    );
    await fs.promises.writeFile(
      `${fixtureDirPath}/buffer-package/import.js`,
      `export const marker = 'import-branch';\n`
    );
    await fs.promises.writeFile(`${fixtureDirPath}/buffer-package/require.cjs`, `exports.marker = 'require-branch';\n`);
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/index.cts`,
      `const { marker } = require('node:buffer');
console.log(marker);
`
    );

    await buildWithPackagePath(fixtureDirPath, 'app', '--bundle-builtins', 'buffer');
    const execRet = await spawnAsync('node', ['dist/index.js'], { cwd: fixtureDirPath });
    expect(execRet.status).toBe(0);
    expect(execRet.stdout.trim()).toBe('require-branch');
  });

  it('app-node with bundled builtin-name dependency using package export arrays', async () => {
    const fixtureDirPath = '.tmp/test-fixtures/app-node-builtin-export-arrays';
    await fs.promises.rm(fixtureDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(`${fixtureDirPath}/buffer-package`, { recursive: true });
    await fs.promises.mkdir(`${fixtureDirPath}/src`, { recursive: true });
    await fs.promises.writeFile(
      `${fixtureDirPath}/package.json`,
      JSON.stringify({
        dependencies: { buffer: 'file:./buffer-package' },
        packageManager: 'yarn@4.17.0',
        type: 'module',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/yarn.lock`, '');
    await fs.promises.writeFile(
      `${fixtureDirPath}/buffer-package/package.json`,
      JSON.stringify({
        exports: [
          // oxlint-disable-next-line no-null -- Node package export arrays skip null fallback entries.
          null,
          '../bad.js',
          './array.js',
        ],
        name: 'buffer',
        type: 'module',
        version: '1.0.0',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/buffer-package/array.js`, `export const marker = 'array-branch';\n`);
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/index.ts`,
      `import { marker } from 'node:buffer';
console.log(marker);
`
    );

    await buildWithPackagePath(fixtureDirPath, 'app', '--bundle-builtins', 'buffer', '--module-type', 'esm');
    const execRet = await spawnAsync('node', ['dist/index.js'], { cwd: fixtureDirPath });
    expect(execRet.status).toBe(0);
    expect(execRet.stdout.trim()).toBe('array-branch');
  });

  it('app-node with bundled builtin-name dependency using package export subpaths', async () => {
    const fixtureDirPath = '.tmp/test-fixtures/app-node-builtin-export-subpaths';
    await fs.promises.rm(fixtureDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(`${fixtureDirPath}/fs-package`, { recursive: true });
    await fs.promises.mkdir(`${fixtureDirPath}/src`, { recursive: true });
    await fs.promises.writeFile(
      `${fixtureDirPath}/package.json`,
      JSON.stringify({
        dependencies: { fs: 'file:./fs-package' },
        packageManager: 'yarn@4.17.0',
        type: 'module',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/yarn.lock`, '');
    await fs.promises.writeFile(
      `${fixtureDirPath}/fs-package/package.json`,
      JSON.stringify({
        exports: {
          './promises': './promises.js',
        },
        name: 'fs',
        type: 'module',
        version: '1.0.0',
      })
    );
    await fs.promises.writeFile(
      `${fixtureDirPath}/fs-package/promises.js`,
      `export const marker = 'local-fs-promises';\n`
    );
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/index.ts`,
      `import { marker } from 'node:fs/promises';
console.log(marker);
`
    );

    await buildWithPackagePath(fixtureDirPath, 'app', '--bundle-builtins', 'fs', '--module-type', 'esm');
    const execRet = await spawnAsync('node', ['dist/index.js'], { cwd: fixtureDirPath });
    expect(execRet.status).toBe(0);
    expect(execRet.stdout.trim()).toBe('local-fs-promises');
  });

  it('app-node with bundled builtin-name dependency using package export subpath patterns', async () => {
    const fixtureDirPath = '.tmp/test-fixtures/app-node-builtin-export-subpath-patterns';
    await fs.promises.rm(fixtureDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(`${fixtureDirPath}/fs-package/dist`, { recursive: true });
    await fs.promises.mkdir(`${fixtureDirPath}/src`, { recursive: true });
    await fs.promises.writeFile(
      `${fixtureDirPath}/package.json`,
      JSON.stringify({
        dependencies: { fs: 'file:./fs-package' },
        packageManager: 'yarn@4.17.0',
        type: 'module',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/yarn.lock`, '');
    await fs.promises.writeFile(
      `${fixtureDirPath}/fs-package/package.json`,
      JSON.stringify({
        exports: {
          './*': './dist/*.js',
        },
        name: 'fs',
        type: 'module',
        version: '1.0.0',
      })
    );
    await fs.promises.writeFile(
      `${fixtureDirPath}/fs-package/dist/promises.js`,
      `export const marker = 'pattern-fs-promises';\n`
    );
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/index.ts`,
      `import { marker } from 'node:fs/promises';
console.log(marker);
`
    );

    await buildWithPackagePath(fixtureDirPath, 'app', '--bundle-builtins', 'fs', '--module-type', 'esm');
    const execRet = await spawnAsync('node', ['dist/index.js'], { cwd: fixtureDirPath });
    expect(execRet.status).toBe(0);
    expect(execRet.stdout.trim()).toBe('pattern-fs-promises');
  });

  it('app-node with bundled dependency using node-addons package export condition', async () => {
    const fixtureDirPath = '.tmp/test-fixtures/app-node-builtin-node-addons-exports';
    await fs.promises.rm(fixtureDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(`${fixtureDirPath}/undici-package`, { recursive: true });
    await fs.promises.mkdir(`${fixtureDirPath}/src`, { recursive: true });
    await fs.promises.writeFile(
      `${fixtureDirPath}/package.json`,
      JSON.stringify({
        dependencies: { undici: 'file:./undici-package' },
        packageManager: 'yarn@4.17.0',
        type: 'module',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/yarn.lock`, '');
    await fs.promises.writeFile(
      `${fixtureDirPath}/undici-package/package.json`,
      JSON.stringify({
        exports: {
          '.': {
            'node-addons': './addons.js',
            node: './node.js',
          },
        },
        name: 'undici',
        type: 'module',
        version: '1.0.0',
      })
    );
    await fs.promises.writeFile(
      `${fixtureDirPath}/undici-package/addons.js`,
      `export const marker = 'addons-branch';\n`
    );
    await fs.promises.writeFile(`${fixtureDirPath}/undici-package/node.js`, `export const marker = 'node-branch';\n`);
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/index.ts`,
      `import { marker } from 'undici';
console.log(marker);
`
    );

    await buildWithPackagePath(fixtureDirPath, 'app', '--bundle-builtins', 'undici', '--module-type', 'esm');
    const execRet = await spawnAsync('node', ['dist/index.js'], { cwd: fixtureDirPath });
    expect(execRet.status).toBe(0);
    expect(execRet.stdout.trim()).toBe('addons-branch');
  });

  it('app-node with bundled dependency using module-sync package export condition', async () => {
    const fixtureDirPath = '.tmp/test-fixtures/app-node-builtin-module-sync-exports';
    await fs.promises.rm(fixtureDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(`${fixtureDirPath}/undici-package`, { recursive: true });
    await fs.promises.mkdir(`${fixtureDirPath}/src`, { recursive: true });
    await fs.promises.writeFile(
      `${fixtureDirPath}/package.json`,
      JSON.stringify({
        dependencies: { undici: 'file:./undici-package' },
        packageManager: 'yarn@4.17.0',
        type: 'module',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/yarn.lock`, '');
    await fs.promises.writeFile(
      `${fixtureDirPath}/undici-package/package.json`,
      JSON.stringify({
        exports: {
          '.': {
            'module-sync': './sync.js',
            import: './import.js',
            default: './default.js',
          },
        },
        name: 'undici',
        type: 'module',
        version: '1.0.0',
      })
    );
    await fs.promises.writeFile(
      `${fixtureDirPath}/undici-package/default.js`,
      `export const marker = 'default-branch';\n`
    );
    await fs.promises.writeFile(
      `${fixtureDirPath}/undici-package/import.js`,
      `export const marker = 'import-branch';\n`
    );
    await fs.promises.writeFile(`${fixtureDirPath}/undici-package/sync.js`, `export const marker = 'sync-branch';\n`);
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/index.ts`,
      `import { marker } from 'undici';
console.log(marker);
`
    );

    await buildWithPackagePath(fixtureDirPath, 'app', '--bundle-builtins', 'undici', '--module-type', 'esm');
    const execRet = await spawnAsync('node', ['dist/index.js'], { cwd: fixtureDirPath });
    expect(execRet.status).toBe(0);
    expect(execRet.stdout.trim()).toBe('sync-branch');
  });

  it('app-node with bundled dependency using extension-resolved subpath without package exports', async () => {
    const fixtureDirPath = '.tmp/test-fixtures/app-node-builtin-no-exports-subpath';
    await fs.promises.rm(fixtureDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(`${fixtureDirPath}/undici-package`, { recursive: true });
    await fs.promises.mkdir(`${fixtureDirPath}/src`, { recursive: true });
    await fs.promises.writeFile(
      `${fixtureDirPath}/package.json`,
      JSON.stringify({
        dependencies: { undici: 'file:./undici-package' },
        packageManager: 'yarn@4.17.0',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/yarn.lock`, '');
    await fs.promises.writeFile(
      `${fixtureDirPath}/undici-package/package.json`,
      JSON.stringify({
        name: 'undici',
        version: '1.0.0',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/undici-package/promises.js`, `exports.marker = 'promises-file';\n`);
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/index.cts`,
      `const { marker } = require('undici/promises');
console.log(marker);
`
    );

    await buildWithPackagePath(fixtureDirPath, 'app', '--bundle-builtins', 'undici');
    const execRet = await spawnAsync('node', ['dist/index.js'], { cwd: fixtureDirPath });
    expect(execRet.status).toBe(0);
    expect(execRet.stdout.trim()).toBe('promises-file');
  });

  it('app-node with bundled ESM dependency using extension-resolved subpath without package exports', async () => {
    const fixtureDirPath = '.tmp/test-fixtures/app-node-builtin-no-exports-esm-subpath';
    await fs.promises.rm(fixtureDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(`${fixtureDirPath}/undici-package`, { recursive: true });
    await fs.promises.mkdir(`${fixtureDirPath}/src`, { recursive: true });
    await fs.promises.writeFile(
      `${fixtureDirPath}/package.json`,
      JSON.stringify({
        dependencies: { undici: 'file:./undici-package' },
        packageManager: 'yarn@4.17.0',
        type: 'module',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/yarn.lock`, '');
    await fs.promises.writeFile(
      `${fixtureDirPath}/undici-package/package.json`,
      JSON.stringify({
        name: 'undici',
        type: 'module',
        version: '1.0.0',
      })
    );
    await fs.promises.writeFile(
      `${fixtureDirPath}/undici-package/promises.js`,
      `export const marker = 'promises-file';\n`
    );
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/index.ts`,
      `import { marker } from 'undici/promises.js';
console.log(marker);
`
    );

    await buildWithPackagePath(fixtureDirPath, 'app', '--bundle-builtins', 'undici', '--module-type', 'esm');
    const execRet = await spawnAsync('node', ['dist/index.js'], { cwd: fixtureDirPath });
    expect(execRet.status).toBe(0);
    expect(execRet.stdout.trim()).toBe('promises-file');
  });

  it('app-node with bundled builtin-name dependency uses most specific package export subpath pattern', async () => {
    const fixtureDirPath = '.tmp/test-fixtures/app-node-builtin-export-subpath-specificity';
    await fs.promises.rm(fixtureDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(`${fixtureDirPath}/fs-package/generic/features`, { recursive: true });
    await fs.promises.mkdir(`${fixtureDirPath}/fs-package/specific`, { recursive: true });
    await fs.promises.mkdir(`${fixtureDirPath}/src`, { recursive: true });
    await fs.promises.writeFile(
      `${fixtureDirPath}/package.json`,
      JSON.stringify({
        dependencies: { fs: 'file:./fs-package' },
        packageManager: 'yarn@4.17.0',
        type: 'module',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/yarn.lock`, '');
    await fs.promises.writeFile(
      `${fixtureDirPath}/fs-package/package.json`,
      JSON.stringify({
        exports: {
          './*': './generic/*.js',
          './features/*': './specific/*.js',
        },
        name: 'fs',
        type: 'module',
        version: '1.0.0',
      })
    );
    await fs.promises.writeFile(
      `${fixtureDirPath}/fs-package/generic/features/thing.js`,
      `export const marker = 'generic-branch';\n`
    );
    await fs.promises.writeFile(
      `${fixtureDirPath}/fs-package/specific/thing.js`,
      `export const marker = 'specific-branch';\n`
    );
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/index.ts`,
      `import { marker } from 'node:fs/features/thing';
console.log(marker);
`
    );

    await buildWithPackagePath(fixtureDirPath, 'app', '--bundle-builtins', 'fs', '--module-type', 'esm');
    const execRet = await spawnAsync('node', ['dist/index.js'], { cwd: fixtureDirPath });
    expect(execRet.status).toBe(0);
    expect(execRet.stdout.trim()).toBe('specific-branch');
  });

  it('app-node with bundled builtin-name dependency rejects private package export subpath pattern', async () => {
    const fixtureDirPath = '.tmp/test-fixtures/app-node-builtin-export-subpath-private-pattern';
    await fs.promises.rm(fixtureDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(`${fixtureDirPath}/fs-package/features/private-internal`, { recursive: true });
    await fs.promises.mkdir(`${fixtureDirPath}/src`, { recursive: true });
    await fs.promises.writeFile(
      `${fixtureDirPath}/package.json`,
      JSON.stringify({
        dependencies: { fs: 'file:./fs-package' },
        packageManager: 'yarn@4.17.0',
        type: 'module',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/yarn.lock`, '');
    await fs.promises.writeFile(
      `${fixtureDirPath}/fs-package/package.json`,
      JSON.stringify({
        exports: {
          './features/*.js': './features/*.js',
          // oxlint-disable-next-line no-null -- Node package exports use null to deny private subpaths.
          './features/private-internal/*': null,
        },
        name: 'fs',
        type: 'module',
        version: '1.0.0',
      })
    );
    await fs.promises.writeFile(
      `${fixtureDirPath}/fs-package/features/private-internal/secret.js`,
      `export const marker = 'private';\n`
    );
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/index.ts`,
      `import { marker } from 'node:fs/features/private-internal/secret.js';
console.log(marker);
`
    );

    await expectBuildWithPackagePathToFail(fixtureDirPath, 'app', '--bundle-builtins', 'fs', '--module-type', 'esm');
  });

  it('app-node with bundled builtin-name dependency rejects exact private package export subpath', async () => {
    const fixtureDirPath = '.tmp/test-fixtures/app-node-builtin-export-exact-private-subpath';
    await fs.promises.rm(fixtureDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(`${fixtureDirPath}/fs-package`, { recursive: true });
    await fs.promises.mkdir(`${fixtureDirPath}/src`, { recursive: true });
    await fs.promises.writeFile(
      `${fixtureDirPath}/package.json`,
      JSON.stringify({
        dependencies: { fs: 'file:./fs-package' },
        packageManager: 'yarn@4.17.0',
        type: 'module',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/yarn.lock`, '');
    await fs.promises.writeFile(
      `${fixtureDirPath}/fs-package/package.json`,
      JSON.stringify({
        exports: {
          './*.js': './*.js',
          // oxlint-disable-next-line no-null -- Node package exports use null to deny private subpaths.
          './private.js': null,
        },
        name: 'fs',
        type: 'module',
        version: '1.0.0',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/fs-package/private.js`, `export const marker = 'private';\n`);
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/index.ts`,
      `import { marker } from 'node:fs/private.js';
console.log(marker);
`
    );

    await expectBuildWithPackagePathToFail(fixtureDirPath, 'app', '--bundle-builtins', 'fs', '--module-type', 'esm');
  });

  it('app-node with bundled builtin-name dependency rejects null package export condition', async () => {
    const fixtureDirPath = '.tmp/test-fixtures/app-node-builtin-export-null-condition';
    await fs.promises.rm(fixtureDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(`${fixtureDirPath}/fs-package`, { recursive: true });
    await fs.promises.mkdir(`${fixtureDirPath}/src`, { recursive: true });
    await fs.promises.writeFile(
      `${fixtureDirPath}/package.json`,
      JSON.stringify({
        dependencies: { fs: 'file:./fs-package' },
        packageManager: 'yarn@4.17.0',
        type: 'module',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/yarn.lock`, '');
    await fs.promises.writeFile(
      `${fixtureDirPath}/fs-package/package.json`,
      JSON.stringify({
        exports: {
          '.': {
            // oxlint-disable-next-line no-null -- Node package exports use null to deny a matched condition.
            node: null,
            default: './default.js',
          },
        },
        name: 'fs',
        type: 'module',
        version: '1.0.0',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/fs-package/default.js`, `export const marker = 'default-branch';\n`);
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/index.ts`,
      `import { marker } from 'node:fs';
console.log(marker);
`
    );

    await expectBuildWithPackagePathToFail(fixtureDirPath, 'app', '--bundle-builtins', 'fs', '--module-type', 'esm');
  });

  it('app-node with bundled builtin-name dependency rejects invalid package export target', async () => {
    const fixtureDirPath = '.tmp/test-fixtures/app-node-builtin-export-invalid-target';
    await fs.promises.rm(fixtureDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(`${fixtureDirPath}/fs-package`, { recursive: true });
    await fs.promises.mkdir(`${fixtureDirPath}/outside`, { recursive: true });
    await fs.promises.mkdir(`${fixtureDirPath}/src`, { recursive: true });
    await fs.promises.writeFile(
      `${fixtureDirPath}/package.json`,
      JSON.stringify({
        dependencies: { fs: 'file:./fs-package' },
        packageManager: 'yarn@4.17.0',
        type: 'module',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/yarn.lock`, '');
    await fs.promises.writeFile(
      `${fixtureDirPath}/fs-package/package.json`,
      JSON.stringify({
        exports: {
          './*': '../outside/*.js',
        },
        name: 'fs',
        type: 'module',
        version: '1.0.0',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/outside/promises.js`, `export const marker = 'outside';\n`);
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/index.ts`,
      `import { marker } from 'node:fs/promises';
console.log(marker);
`
    );

    await expectBuildWithPackagePathToFail(fixtureDirPath, 'app', '--bundle-builtins', 'fs', '--module-type', 'esm');
  });

  it('app-node with bundled builtin-name dependency rejects package exports without root', async () => {
    const fixtureDirPath = '.tmp/test-fixtures/app-node-builtin-exports-without-root';
    await fs.promises.rm(fixtureDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(`${fixtureDirPath}/buffer-package`, { recursive: true });
    await fs.promises.mkdir(`${fixtureDirPath}/src`, { recursive: true });
    await fs.promises.writeFile(
      `${fixtureDirPath}/package.json`,
      JSON.stringify({
        dependencies: { buffer: 'file:./buffer-package' },
        packageManager: 'yarn@4.17.0',
        type: 'module',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/yarn.lock`, '');
    await fs.promises.writeFile(
      `${fixtureDirPath}/buffer-package/package.json`,
      JSON.stringify({
        exports: { './sub': './sub.js' },
        main: './main.js',
        name: 'buffer',
        type: 'module',
        version: '1.0.0',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/buffer-package/main.js`, `export const marker = 'main-fallback';\n`);
    await fs.promises.writeFile(`${fixtureDirPath}/buffer-package/sub.js`, `export const marker = 'sub-export';\n`);
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/index.ts`,
      `import { marker } from 'node:buffer';
console.log(marker);
`
    );

    await expectBuildWithPackagePathToFail(
      fixtureDirPath,
      'app',
      '--bundle-builtins',
      'buffer',
      '--module-type',
      'esm'
    );
  });

  it('app-node with bundled builtin-name dependency rejects package exports without matching condition', async () => {
    const fixtureDirPath = '.tmp/test-fixtures/app-node-builtin-exports-without-condition';
    await fs.promises.rm(fixtureDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(`${fixtureDirPath}/buffer-package`, { recursive: true });
    await fs.promises.mkdir(`${fixtureDirPath}/src`, { recursive: true });
    await fs.promises.writeFile(
      `${fixtureDirPath}/package.json`,
      JSON.stringify({
        dependencies: { buffer: 'file:./buffer-package' },
        packageManager: 'yarn@4.17.0',
        type: 'module',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/yarn.lock`, '');
    await fs.promises.writeFile(
      `${fixtureDirPath}/buffer-package/package.json`,
      JSON.stringify({
        exports: {
          '.': { browser: './browser.js' },
        },
        main: './main.js',
        name: 'buffer',
        type: 'module',
        version: '1.0.0',
      })
    );
    await fs.promises.writeFile(
      `${fixtureDirPath}/buffer-package/browser.js`,
      `export const marker = 'browser-branch';\n`
    );
    await fs.promises.writeFile(`${fixtureDirPath}/buffer-package/main.js`, `export const marker = 'main-fallback';\n`);
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/index.ts`,
      `import { marker } from 'node:buffer';
console.log(marker);
`
    );

    await expectBuildWithPackagePathToFail(
      fixtureDirPath,
      'app',
      '--bundle-builtins',
      'buffer',
      '--module-type',
      'esm'
    );
  });

  it('app-node with bundled hoisted builtin-name dependency', async () => {
    const workspaceDirPath = '.tmp/test-fixtures/app-node-builtin-hoisted';
    const fixtureDirPath = `${workspaceDirPath}/packages/app`;
    const bufferPackageDirPath = `${workspaceDirPath}/node_modules/buffer`;
    await fs.promises.rm(workspaceDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(bufferPackageDirPath, { recursive: true });
    await fs.promises.mkdir(`${fixtureDirPath}/src`, { recursive: true });
    await fs.promises.writeFile(`${fixtureDirPath}/package.json`, JSON.stringify({ packageManager: 'yarn@4.17.0' }));
    await fs.promises.writeFile(`${fixtureDirPath}/yarn.lock`, '');
    await fs.promises.writeFile(
      `${bufferPackageDirPath}/package.json`,
      JSON.stringify({
        exports: './index.js',
        name: 'buffer',
        type: 'module',
        version: '1.0.0',
      })
    );
    await fs.promises.writeFile(`${bufferPackageDirPath}/index.js`, `export const marker = 'hoisted-buffer';\n`);
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/index.ts`,
      `import { marker } from 'node:buffer';
console.log(marker);
`
    );

    await buildWithPackagePath(fixtureDirPath, 'app', '--bundle-builtins', 'buffer');
    const execRet = await spawnAsync('node', ['dist/index.js'], { cwd: fixtureDirPath });
    expect(execRet.status).toBe(0);
    expect(execRet.stdout.trim()).toBe('hoisted-buffer');
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

  it('lib with core-js', async () => {
    const fixtureDirPath = '.tmp/test-fixtures/lib-core-js';
    await fs.promises.rm(fixtureDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(`${fixtureDirPath}/src`, { recursive: true });
    await fs.promises.writeFile(
      `${fixtureDirPath}/package.json`,
      JSON.stringify({
        browserslist: ['ie 11'],
        packageManager: 'yarn@4.17.0',
      })
    );
    await fs.promises.writeFile(`${fixtureDirPath}/yarn.lock`, '');
    await fs.promises.writeFile(
      `${fixtureDirPath}/src/index.ts`,
      `export function run() {
  return [1, 2, 3].includes(2) && [1].flatMap((value) => [value]).at(-1) === 1;
}
`
    );

    await buildWithPackagePath(fixtureDirPath, 'lib', '--core-js', '--module-type', 'both');
    const cjsRet = await spawnAsync('node', ['-e', "process.exit(require('./dist/index.js').run() ? 0 : 1)"], {
      cwd: fixtureDirPath,
    });
    const esmRet = await spawnAsync(
      'node',
      ['-e', "import('./dist/index.mjs').then((mod) => process.exit(mod.run() ? 0 : 1))"],
      {
        cwd: fixtureDirPath,
      }
    );
    expect(cjsRet.status).toBe(0);
    expect(esmRet.status).toBe(0);
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

async function expectBuildWithPackagePathToFail(
  packagePath: string,
  subCommand: string,
  ...options: string[]
): Promise<void> {
  const buildRet = await buildWithPackagePathAndGetStatus(packagePath, subCommand, ...options);
  expect(buildRet.status).not.toBe(0);
}

async function buildWithPackagePathAndGetStatus(
  packagePath: string,
  subCommand: string,
  ...options: string[]
): Promise<Awaited<ReturnType<typeof spawnAsync>>> {
  removeNpmAndYarnEnvironmentVariables(process.env);
  await fs.promises.rm(`${packagePath}/node_modules`, { recursive: true, force: true });
  const installRet = await spawnAsync('yarn', [], { cwd: packagePath, stdio: 'inherit' });
  expect(installRet.status).toBe(0);
  return spawnAsync('yarn', ['start', subCommand, packagePath, ...options], {
    stdio: 'inherit',
  });
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
