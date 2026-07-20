import * as child_process from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import type { ArgumentsType } from '../../types.js';

import type { AnyBuilderType } from './builder.js';

const require = createRequire(import.meta.url);

export async function generateDeclarationFiles(
  argv: ArgumentsType<AnyBuilderType>,
  coreProjectDirPath: string,
  outDirPath: string,
  inputs?: string[]
): Promise<boolean> {
  const coreConfigFile = findConfigFile(coreProjectDirPath);
  if (!coreConfigFile) throw new Error(`Failed to find tsconfig.json in ${coreProjectDirPath}.`);
  if (argv.verbose) {
    console.info('Found tsconfig.json:', coreConfigFile);
  }

  const projects: [string, string, string, string[] | undefined][] = [];
  let coreOutDir = path.join(outDirPath, path.basename(coreProjectDirPath), 'src');
  if (fs.existsSync(coreOutDir)) {
    // The bundler emitted per-project directories (monorepo build), so entry-based restriction is unsafe:
    // entries may import files outside each project's rootDir.
    inputs = undefined;
    const parentDirPath = path.dirname(coreProjectDirPath);
    const dirents = await fs.promises.readdir(parentDirPath, { withFileTypes: true });
    coreProjectDirPath = path.resolve(coreProjectDirPath);
    for (const dirent of dirents) {
      if (!dirent.isDirectory()) continue;

      const projectDirPath = path.resolve(parentDirPath, dirent.name);
      if (projectDirPath === coreProjectDirPath) continue;

      const configFile = findConfigFile(projectDirPath);
      const outDir = path.join(outDirPath, dirent.name, 'src');
      if (configFile && fs.existsSync(outDir)) {
        projects.push([projectDirPath, configFile, outDir, undefined]);
      }
    }
  } else {
    coreOutDir = outDirPath;
  }
  projects.push([coreProjectDirPath, coreConfigFile, coreOutDir, inputs]);

  let allSucceeded = true;
  for (const [projectDirPath, configFile, outDir, projectInputs] of projects) {
    allSucceeded &&= await runTsgo(argv, projectDirPath, configFile, outDir, projectInputs);
  }
  return allSucceeded;
}

async function runTsgo(
  argv: ArgumentsType<AnyBuilderType>,
  projectDirPath: string,
  configFile: string,
  outDir: string,
  inputs?: string[]
): Promise<boolean> {
  if (argv.verbose) {
    console.info('runTsgo()', projectDirPath, configFile, outDir, inputs);
  }

  // The temporary config must live in the project directory so that its relative `rootDir` and
  // `include` resolve against the project even when the extended tsconfig is in an ancestor directory.
  const tempConfigFile = path.join(projectDirPath, `.build-ts-tsgo.${process.pid}.${Date.now()}.json`);
  try {
    await fs.promises.writeFile(
      tempConfigFile,
      JSON.stringify(await createTypeScriptNativeConfig(projectDirPath, configFile, outDir, inputs), undefined, 2)
    );
    const ret = child_process.spawnSync(process.execPath, [getTsgoPath(), '-p', tempConfigFile], {
      cwd: projectDirPath,
      stdio: 'inherit',
    });
    if (ret.error) throw ret.error;
    return ret.status === 0;
  } finally {
    await fs.promises.rm(tempConfigFile, { force: true });
  }
}

async function createTypeScriptNativeConfig(
  projectDirPath: string,
  configFile: string,
  outDir: string,
  inputs?: string[]
): Promise<Record<string, unknown>> {
  const compilerOptions: Record<string, unknown> = {
    declaration: true,
    // An inherited `declarationDir` would silently redirect the output away from `outDir`.
    declarationDir: outDir,
    emitDeclarationOnly: true,
    noEmit: false,
    noEmitOnError: true,
    outDir,
    // TypeScript 7 requires an explicit `rootDir` (TS5011). Entries importing files outside src/
    // (e.g. sibling packages in declaration-only mode) fail with TS6059; see the README limitation.
    rootDir: 'src',
  };
  if (await usesNodeProtocolImport(path.join(projectDirPath, 'src'))) {
    const typesDirPath = findTypesDirPath(projectDirPath);
    const types = typesDirPath ? await collectTypePackages(typesDirPath) : [];
    if (types.includes('node')) {
      compilerOptions.types = types;
    }
  }
  return {
    compilerOptions,
    extends: toRelativeConfigPath(projectDirPath, configFile),
    // With `files`, tsc also emits declarations for files transitively imported from the entries,
    // so the output is restricted to what the bundled JavaScript actually contains. `include` must be
    // overridden since an inherited `include` would add files back to the program; only ambient
    // declaration files are kept because entries may rely on their global types without importing them.
    ...(inputs?.length
      ? {
          files: inputs.map((input) => path.resolve(projectDirPath, input).replaceAll(path.sep, '/')),
          include: ['src/**/*.d.ts', 'src/**/*.d.mts', 'src/**/*.d.cts'],
        }
      : { include: ['src/**/*'] }),
  };
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

function getTsgoPath(): string {
  // TypeScript 7 ships the native compiler (formerly `@typescript/native-preview`) as
  // the `typescript` package, whose `lib/tsc.js` wrapper spawns the platform binary.
  const packageJsonPath = require.resolve('typescript/package.json');
  return path.join(path.dirname(packageJsonPath), 'lib', 'tsc.js');
}

async function usesNodeProtocolImport(dirPath: string): Promise<boolean> {
  try {
    const dirents = await fs.promises.readdir(dirPath, { withFileTypes: true });
    for (const dirent of dirents) {
      const childPath = path.join(dirPath, dirent.name);
      if (dirent.isDirectory()) {
        if (await usesNodeProtocolImport(childPath)) return true;
      } else if (/\.[cm]?tsx?$/.test(dirent.name) && (await fs.promises.readFile(childPath, 'utf8')).includes('node:')) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

function findTypesDirPath(dirPath: string): string | undefined {
  let currentDirPath = path.resolve(dirPath);
  while (true) {
    const typesDirPath = path.join(currentDirPath, 'node_modules', '@types');
    if (fs.existsSync(typesDirPath)) return typesDirPath;

    const parentDirPath = path.dirname(currentDirPath);
    if (parentDirPath === currentDirPath) return undefined;
    currentDirPath = parentDirPath;
  }
}

async function collectTypePackages(typeRootsDirPath: string): Promise<string[]> {
  try {
    const dirents = await fs.promises.readdir(typeRootsDirPath, { withFileTypes: true });
    return dirents.filter((dirent) => dirent.isDirectory()).map((dirent) => dirent.name);
  } catch {
    return [];
  }
}

// `toFilePath` is always a tsconfig in `fromDirPath` or one of its ancestor directories, so the
// result is always relative (`./` or `../` chains); a cross-drive absolute result is impossible.
function toRelativeConfigPath(fromDirPath: string, toFilePath: string): string {
  const relativePath = path.relative(fromDirPath, toFilePath).replaceAll(path.sep, '/');
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}
