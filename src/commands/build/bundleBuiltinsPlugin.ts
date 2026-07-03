import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import type { ImportKind, Plugin } from 'rolldown';
import type { PackageJson } from 'type-fest';

import type { ArgumentsType } from '../../types.js';

import type { builder } from './builder.js';
import { getBundledBuiltinNames, getBundledBuiltinPackageName, getPackageSubpath, isNodeBuiltin } from './externals.js';

export function bundleBuiltinsPlugin(argv: ArgumentsType<typeof builder>, packageDirPath: string): Plugin {
  const bundledBuiltinNames = getBundledBuiltinNames(argv);
  const require = createRequire(path.join(packageDirPath, 'package.json'));
  return {
    name: 'bundle-builtins',
    resolveId(source, _importer, extraOptions) {
      const packageName = getBundledBuiltinPackageName(source, bundledBuiltinNames);
      if (!packageName) return undefined;

      return resolvePackageEntry(
        require,
        packageName,
        packageDirPath,
        getPackageExportConditions(extraOptions.kind),
        getPackageSubpath(source, packageName)
      );
    },
  };
}

function resolvePackageEntry(
  require: NodeJS.Require,
  packageName: string,
  packageDirPath: string,
  conditions: Set<string>,
  subpath: string
): string {
  const packageJsonPath = findPackageJsonPath(require, packageName, packageDirPath);
  const packageJson: PackageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  if (!packageJson.exports) {
    const resolvedPath = resolvePackageWithoutExports(require, packageName, path.dirname(packageJsonPath), subpath);
    if (resolvedPath !== packageName && !resolvedPath.startsWith('node:')) return resolvedPath;
  }

  const entryPath = getPackageEntryPath(packageJson, conditions, subpath);
  if (!entryPath) {
    throw new Error(`Failed to resolve package export for ${packageName}`);
  }
  return path.join(path.dirname(packageJsonPath), entryPath);
}

function getPackageExportConditions(importKind: ImportKind): Set<string> {
  const conditions = new Set(['node-addons', 'node', 'module-sync', 'default']);
  if (importKind === 'require-call') {
    conditions.add('require');
  } else {
    conditions.add('import');
  }
  return conditions;
}

function resolvePackageWithoutExports(
  require: NodeJS.Require,
  packageName: string,
  packageDirPath: string,
  subpath: string
): string {
  if (subpath === '.') return require.resolve(packageName);
  const resolvedPath = require.resolve(`${packageName}/${subpath.slice('./'.length)}`);
  return isNodeBuiltin(resolvedPath) ? resolvePackageSubpathFromDir(packageDirPath, subpath) : resolvedPath;
}

function resolvePackageSubpathFromDir(packageDirPath: string, subpath: string): string {
  const subpathEntryPath = normalizePackageEntryPath(subpath);
  if (!subpathEntryPath) throw new Error(`Failed to resolve package subpath ${subpath}`);

  const entryPath = path.join(packageDirPath, subpathEntryPath);
  const resolvedPath = resolveFilePath(entryPath) ?? resolveDirectoryPath(entryPath);
  if (resolvedPath) return resolvedPath;
  throw new Error(`Failed to resolve package subpath ${subpath}`);
}

function resolveFilePath(filePath: string): string | undefined {
  const filePaths = path.extname(filePath) ? [filePath] : [filePath, `${filePath}.js`, `${filePath}.json`, `${filePath}.node`];
  return filePaths.find((candidatePath) => fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile());
}

function resolveDirectoryPath(dirPath: string): string | undefined {
  const packageJsonPath = path.join(dirPath, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const packageJson: PackageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const mainPath = resolveFilePath(path.join(dirPath, packageJson.main ?? 'index.js'));
    if (mainPath) return mainPath;
  }
  return resolveFilePath(path.join(dirPath, 'index'));
}

function findPackageJsonPath(require: NodeJS.Require, packageName: string, packageDirPath: string): string {
  const modulePaths = require.resolve.paths(packageName) ?? require.resolve.paths('__build_ts_package_lookup__') ?? [];
  for (const modulePath of [path.join(packageDirPath, 'node_modules'), ...modulePaths]) {
    const packageJsonPath = path.join(modulePath, packageName, 'package.json');
    if (fs.existsSync(packageJsonPath)) return fs.realpathSync(packageJsonPath);
  }
  throw new Error(`Failed to resolve package.json for ${packageName}`);
}

function getPackageEntryPath(packageJson: PackageJson, conditions: Set<string>, subpath: string): string | undefined {
  if (packageJson.exports) {
    const entryPath = getExportEntryPath(packageJson.exports, conditions, subpath);
    return entryPath === null ? undefined : normalizePackageEntryPath(entryPath);
  }
  if (subpath === '.') return packageJson.main ?? 'index.js';
  return normalizePackageEntryPath(subpath);
}

function getExportEntryPath(
  exportsField: unknown,
  conditions: Set<string>,
  subpath: string,
  patternMatch?: string
): string | undefined | null {
  if (typeof exportsField === 'string') {
    return subpath === '.' ? resolveExportTarget(exportsField, patternMatch) : undefined;
  }
  if (exportsField === null) return null;
  if (Array.isArray(exportsField)) {
    if (subpath !== '.') return undefined;

    for (const exportEntry of exportsField) {
      let entryPath: string | undefined | null;
      try {
        entryPath = getExportEntryPath(exportEntry, conditions, subpath, patternMatch);
      } catch {
        continue;
      }
      if (entryPath) return entryPath;
    }
    return undefined;
  }
  if (typeof exportsField !== 'object') return undefined;

  const exportRecord = exportsField as Record<string, unknown>;
  if (hasExportSubpaths(exportRecord)) {
    if (Object.hasOwn(exportRecord, subpath)) return getExportEntryPath(exportRecord[subpath], conditions, '.');

    const subpathExport = findExportSubpathPattern(exportRecord, subpath);
    return subpathExport === undefined ? undefined : getExportEntryPath(subpathExport.value, conditions, '.');
  }
  if (subpath !== '.') return undefined;

  for (const [condition, value] of Object.entries(exportRecord)) {
    if (!conditions.has(condition)) continue;

    const entryPath = getExportEntryPath(value, conditions, subpath, patternMatch);
    if (entryPath !== undefined) return entryPath;
  }
  return undefined;
}

function hasExportSubpaths(exportRecord: Record<string, unknown>): boolean {
  return Object.keys(exportRecord).some((key) => key === '.' || key.startsWith('./'));
}

function findExportSubpathPattern(exportRecord: Record<string, unknown>, subpath: string): { value: unknown } | undefined {
  for (const [key, value] of Object.entries(exportRecord).sort(([keyA], [keyB]) => compareExportPatternKeys(keyA, keyB))) {
    const patternMatch = getExportPatternMatch(key, subpath);
    if (patternMatch !== undefined) {
      return { value: replaceExportPattern(value, patternMatch) };
    }
  }
  return undefined;
}

function compareExportPatternKeys(keyA: string, keyB: string): number {
  const baseLengthA = keyA.indexOf('*');
  const baseLengthB = keyB.indexOf('*');
  if (baseLengthA === -1 && baseLengthB === -1) return 0;
  if (baseLengthA === -1) return 1;
  if (baseLengthB === -1) return -1;
  return baseLengthB - baseLengthA || keyB.length - keyA.length;
}

function getExportPatternMatch(pattern: string, subpath: string): string | undefined {
  if (!pattern.startsWith('./') || !pattern.includes('*')) return undefined;

  const [prefix, suffix] = pattern.split('*', 2) as [string, string];
  if (subpath === prefix || !subpath.startsWith(prefix) || !subpath.endsWith(suffix) || subpath.length < pattern.length) {
    return undefined;
  }
  return subpath.slice(prefix.length, subpath.length - suffix.length);
}

function replaceExportPattern(value: unknown, patternMatch: string): unknown {
  if (typeof value === 'string') return resolveExportTarget(value, patternMatch);
  if (Array.isArray(value)) return value.map((item) => replaceExportPattern(item, patternMatch));
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, replaceExportPattern(item, patternMatch)])
  );
}

function resolveExportTarget(target: string, patternMatch: string | undefined): string {
  validateExportTarget(target);
  if (patternMatch === undefined) return target;

  validateExportPatternMatch(patternMatch);
  return target.replaceAll('*', patternMatch);
}

function validateExportTarget(target: string): void {
  if (!target.startsWith('./')) throw new Error(`Invalid package export target: ${target}`);

  validatePathSegments(target.slice('./'.length), target);
}

function validateExportPatternMatch(patternMatch: string): void {
  validatePathSegments(patternMatch, patternMatch);
}

function validatePathSegments(pathValue: string, sourceValue: string): void {
  const decodedPath = decodePathValue(pathValue, sourceValue);
  const invalidSegments = new Set(['', '.', '..', 'node_modules']);
  for (const segment of decodedPath.split(/[\\/]/u)) {
    if (invalidSegments.has(segment)) {
      throw new Error(`Invalid package export path segment in ${sourceValue}`);
    }
  }
}

function decodePathValue(pathValue: string, sourceValue: string): string {
  try {
    return decodeURIComponent(pathValue).toLowerCase();
  } catch {
    throw new Error(`Invalid package export path segment in ${sourceValue}`);
  }
}

function normalizePackageEntryPath(entryPath: string | undefined): string | undefined {
  return entryPath?.replace(/^\.\//, '');
}
