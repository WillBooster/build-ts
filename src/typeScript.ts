/* eslint-disable import/no-named-as-default-member */

// We cannot use named imports from 'typescript' because of build errors.
import ts from 'typescript';

export function generateDeclarationFiles(projectDirPath: string): boolean {
  const configFile = ts.findConfigFile(projectDirPath, ts.sys.fileExists);
  if (!configFile) throw new Error(`Failed to find tsconfig.json in ${projectDirPath}.`);

  const { config } = ts.readConfigFile(configFile, ts.sys.readFile);
  config.compilerOptions = {
    ...config.compilerOptions,
    declaration: true,
    emitDeclarationOnly: true,
    noEmit: false,
    noEmitOnError: true,
    outDir: 'dist',
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
