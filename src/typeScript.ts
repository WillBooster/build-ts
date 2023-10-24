import type { FormatDiagnosticsHost } from 'typescript';
import {
  createProgram,
  findConfigFile,
  formatDiagnostics,
  getPreEmitDiagnostics,
  parseJsonConfigFileContent,
  readConfigFile,
  sys,
} from 'typescript';

export function generateDeclarationFiles(projectDirPath: string): boolean {
  const configFile = findConfigFile(projectDirPath, sys.fileExists);
  if (!configFile) throw new Error('Failed to find `tsconfig.json`.');

  const { config } = readConfigFile(configFile, sys.readFile);
  config.compilerOptions = {
    ...config.compilerOptions,
    declaration: true,
    emitDeclarationOnly: true,
    noEmit: false,
    noEmitOnError: true,
    outDir: 'dist',
  };
  config.include = ['src/**/*'];
  const { errors, fileNames, options } = parseJsonConfigFileContent(config, sys, projectDirPath);

  const program = createProgram({ options, rootNames: fileNames, configFileParsingDiagnostics: errors });
  const { diagnostics, emitSkipped } = program.emit();

  const allDiagnostics = [...getPreEmitDiagnostics(program), ...diagnostics, ...errors];
  if (allDiagnostics.length > 0) {
    const formatHost: FormatDiagnosticsHost = {
      getCanonicalFileName: (path) => path,
      getCurrentDirectory: sys.getCurrentDirectory,
      getNewLine: () => sys.newLine,
    };
    const message = formatDiagnostics(allDiagnostics, formatHost);
    console.warn(message);
  }

  return !emitSkipped;
}
