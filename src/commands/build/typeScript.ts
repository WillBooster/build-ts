/* eslint-disable import/no-named-as-default-member */

// We cannot use named imports from 'typescript' because of build errors.
import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import type { ArgumentsType } from '../../types.js';

import type { AnyBuilderType } from './builder.js';

export async function generateDeclarationFiles(
  argv: ArgumentsType<AnyBuilderType>,
  coreProjectDirPath: string
): Promise<boolean> {
  const coreConfigFile = ts.findConfigFile(coreProjectDirPath, ts.sys.fileExists);
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

      const configFile = ts.findConfigFile(projectDirPath, ts.sys.fileExists);
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
    allSucceeded &&= runTypeScriptCompiler(argv, projectDirPath, configFile, path.join(coreProjectDirPath, outDir));
  }
  return allSucceeded;
}

function runTypeScriptCompiler(
  argv: ArgumentsType<AnyBuilderType>,
  projectDirPath: string,
  configFile: string,
  outDir: string
): boolean {
  if (argv.verbose) {
    console.info('runTypeScriptCompiler()', projectDirPath, configFile, outDir);
  }

  const { config } = ts.readConfigFile(configFile, ts.sys.readFile);
  config.compilerOptions = {
    ...config.compilerOptions,
    declaration: true,
    emitDeclarationOnly: true,
    noEmit: false,
    noEmitOnError: true,
    outDir,
  };
  config.include = ['src/**/*'];
  const { errors, fileNames, options } = ts.parseJsonConfigFileContent(config, ts.sys, projectDirPath);

  const program = ts.createProgram({ options, rootNames: fileNames, configFileParsingDiagnostics: errors });
  const { diagnostics, emitSkipped } = program.emit();

  const allDiagnostics = [...ts.getPreEmitDiagnostics(program), ...diagnostics, ...errors];
  if (allDiagnostics.length > 0) {
    const formatHost: ts.FormatDiagnosticsHost = {
      getCanonicalFileName: (path) => path,
      getCurrentDirectory: ts.sys.getCurrentDirectory,
      getNewLine: () => ts.sys.newLine,
    };
    const message = ts.formatDiagnostics(allDiagnostics, formatHost);
    console.warn(message);
  }
  return !emitSkipped;
}
