import * as child_process from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import type { ArgumentsType } from '../../types.js';

import type { AnyBuilderType } from './builder.js';

const require = createRequire(import.meta.url);

export async function generateDeclarationFiles(
  argv: ArgumentsType<AnyBuilderType>,
  coreProjectDirPath: string
): Promise<boolean> {
  const coreConfigFile = findConfigFile(coreProjectDirPath);
  if (!coreConfigFile) throw new Error(`Failed to find tsconfig.json in ${coreProjectDirPath}.`);
  if (argv.verbose) {
    console.info('Found tsconfig.json:', coreConfigFile);
  }

  const projects: [string, string, string][] = [];
  let outDir = path.join('dist', path.basename(coreProjectDirPath), 'src');
  if (fs.existsSync(outDir)) {
    const parentDirPath = path.dirname(coreProjectDirPath);
    const dirents = await fs.promises.readdir(parentDirPath, { withFileTypes: true });
    coreProjectDirPath = path.resolve(coreProjectDirPath);
    for (const dirent of dirents) {
      if (!dirent.isDirectory()) continue;

      const projectDirPath = path.resolve(parentDirPath, dirent.name);
      if (projectDirPath === coreProjectDirPath) continue;

      const configFile = findConfigFile(projectDirPath);
      const outDir = path.join('dist', dirent.name, 'src');
      if (configFile && fs.existsSync(outDir)) {
        projects.push([projectDirPath, configFile, outDir]);
      }
    }
  } else {
    outDir = 'dist';
  }
  projects.push([coreProjectDirPath, coreConfigFile, outDir]);

  let allSucceeded = true;
  for (const [projectDirPath, configFile, outDir] of projects) {
    allSucceeded &&= await runTsgo(argv, projectDirPath, configFile, path.join(coreProjectDirPath, outDir));
  }
  return allSucceeded;
}

async function runTsgo(
  argv: ArgumentsType<AnyBuilderType>,
  projectDirPath: string,
  configFile: string,
  outDir: string
): Promise<boolean> {
  if (argv.verbose) {
    console.info('runTsgo()', projectDirPath, configFile, outDir);
  }

  const configFileDirPath = path.dirname(configFile);
  const tempConfigFile = path.join(configFileDirPath, `.build-ts-tsgo.${process.pid}.${Date.now()}.json`);
  try {
    await fs.promises.writeFile(
      tempConfigFile,
      JSON.stringify(await createTypeScriptNativeConfig(projectDirPath, configFile, outDir), undefined, 2)
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
  outDir: string
): Promise<Record<string, unknown>> {
  const compilerOptions: Record<string, unknown> = {
    declaration: true,
    emitDeclarationOnly: true,
    noEmit: false,
    noEmitOnError: true,
    outDir,
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
    extends: toRelativeConfigPath(path.dirname(configFile), configFile),
    include: ['src/**/*'],
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

function toRelativeConfigPath(fromDirPath: string, toFilePath: string): string {
  const relativePath = path.relative(fromDirPath, toFilePath).replaceAll(path.sep, '/');
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}
