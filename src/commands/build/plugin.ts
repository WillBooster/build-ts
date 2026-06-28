import fs from 'node:fs';
import { builtinModules } from 'node:module';
import { createRequire } from 'node:module';
import path from 'node:path';

import type { TransformOptions } from '@babel/core';
import MagicString from 'magic-string';
import { parseSync, visitorKeys } from 'oxc-parser';
import type { ImportKind, OutputOptions, Plugin, RolldownPluginOption, SourceMapInput } from 'rolldown';
import { minify } from 'terser';
import type { MinifyOptions, SourceMapOptions } from 'terser';
import type { PackageJson } from 'type-fest';

import type { ArgumentsType, TargetDetail } from '../../types.js';
import { getBuildTsRootPath } from '../../utils.js';

import type { builder } from './builder.js';

export function createExternalMatcher(
  argv: ArgumentsType<typeof builder>,
  targetDetail: TargetDetail,
  packageJson: PackageJson,
  namespace: string | undefined
): (id: string) => boolean {
  const externalDeps = collectExternalDependencies(argv, targetDetail, packageJson, namespace);
  const bundledBuiltinNames = getBundledBuiltinNames(argv);
  return (id) => {
    if (getBundledBuiltinPackageName(id, bundledBuiltinNames)) return false;
    return (
      isNodeBuiltin(id) || externalDeps.some((dependencyName) => id === dependencyName || id.startsWith(`${dependencyName}/`))
    );
  };
}

export function setupPlugins(
  argv: ArgumentsType<typeof builder>,
  outputOptionsList: OutputOptions[],
  packageDirPath: string
): RolldownPluginOption[] {
  const plugins: RolldownPluginOption[] = [
    bundleBuiltinsPlugin(argv, packageDirPath),
    keepImportPlugin(argv.keepImport?.map((item) => item.toString()) ?? []),
    removeConsolePlugin(),
  ];
  if (argv['core-js'] || argv['core-js-proposals']) {
    plugins.push(babelCoreJsPlugin());
    if (!outputOptionsList.some((opts) => opts.preserveModules)) {
      plugins.push(commonJsRuntimePreludePlugin());
    }
  } else {
    plugins.push(babelDecoratorsPlugin());
  }
  plugins.push(textPlugin());
  if (argv.minify && !outputOptionsList.some((opts) => opts.preserveModules)) {
    plugins.push(terserPlugin());
  }
  return plugins;
}

function collectExternalDependencies(
  argv: ArgumentsType<typeof builder>,
  targetDetail: TargetDetail,
  packageJson: PackageJson,
  namespace: string | undefined
): string[] {
  const externalDeps = [...(argv.external ?? [])].map((item) => item.toString());
  if (packageJson.dependencies?.['@prisma/client']) {
    externalDeps.push('prisma-client');
  }
  // `deps: true` did not handle imports such as `lodash.chunk/index.js`.
  externalDeps.push(
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {})
  );
  // Add external dependencies from sibling packages
  if (fs.existsSync(path.join('..', '..', 'package.json'))) {
    const packageDirs = fs.readdirSync(path.join('..'), { withFileTypes: true });
    for (const packageDir of packageDirs) {
      if (!packageDir.isDirectory()) continue;

      const packageJsonPath = path.join('..', packageDir.name, 'package.json');
      if (!fs.existsSync(packageJsonPath)) continue;

      const otherPackageJson: PackageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      if (packageJson.dependencies?.[otherPackageJson.name ?? '']) {
        externalDeps.push(
          ...Object.keys(otherPackageJson.dependencies ?? {}),
          ...Object.keys(otherPackageJson.peerDependencies ?? {}),
          ...Object.keys(otherPackageJson.optionalDependencies ?? {})
        );
      }
    }
  }

  const bundledBuiltinNames = getBundledBuiltinNames(argv);
  const bundledNamespacePattern =
    shouldBundleSameNamespaceDependencies(targetDetail) && namespace ? new RegExp(`^@?${namespace}(?:/.+)?`) : undefined;
  return externalDeps.filter((dependencyName) => {
    if (bundledBuiltinNames.has(normalizeNodeBuiltinName(dependencyName))) return false;
    return !bundledNamespacePattern?.test(dependencyName);
  });
}

function getBundledBuiltinNames(argv: ArgumentsType<typeof builder>): Set<string> {
  return new Set(argv.bundleBuiltins?.map((item) => normalizeNodeBuiltinName(item.toString())) ?? []);
}

function shouldBundleSameNamespaceDependencies(targetDetail: TargetDetail): boolean {
  return targetDetail === 'app-node' || targetDetail === 'functions';
}

function bundleBuiltinsPlugin(argv: ArgumentsType<typeof builder>, packageDirPath: string): Plugin {
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

function getBundledBuiltinPackageName(id: string, bundledBuiltinNames: Set<string>): string | undefined {
  const normalizedId = normalizeNodeBuiltinName(id);
  for (const packageName of bundledBuiltinNames) {
    if (normalizedId === packageName || normalizedId.startsWith(`${packageName}/`)) return packageName;
  }
  return undefined;
}

function getPackageSubpath(id: string, packageName: string): string {
  const normalizedId = normalizeNodeBuiltinName(id);
  return normalizedId === packageName ? '.' : `./${normalizedId.slice(packageName.length + 1)}`;
}

function normalizeNodeBuiltinName(id: string): string {
  return id.startsWith('node:') ? id.slice('node:'.length) : id;
}

function isNodeBuiltin(id: string): boolean {
  return id.startsWith('node:') || builtinModules.includes(id);
}

function keepImportPlugin(moduleNames: string[]): Plugin {
  return {
    name: 'keep-import',
    resolveDynamicImport(source) {
      return moduleNames.includes(source) ? false : undefined;
    },
  };
}

function babelCoreJsPlugin(): Plugin {
  return babelPlugin('babel-core-js', () => true);
}

function babelDecoratorsPlugin(): Plugin {
  return babelPlugin('babel-decorators', containsDecorator);
}

function babelPlugin(name: string, shouldTransform: (code: string) => boolean): Plugin {
  const extensions = ['.cjs', '.mjs', '.js', '.jsx', '.cts', '.mts', '.ts', '.tsx'];
  const babelConfigPath = path.join(getBuildTsRootPath(), 'babel.config.mjs');
  return {
    name,
    async transform(code, id) {
      if (!shouldTransform(code) || !extensions.some((extension) => id.endsWith(extension)) || isBabelExcludedPath(id)) {
        return undefined;
      }

      const { transformAsync } = await import('@babel/core');
      const options: TransformOptions = {
        caller: {
          name: 'build-ts',
          supportsDynamicImport: true,
          supportsExportNamespaceFrom: true,
          supportsStaticESM: true,
        },
        configFile: babelConfigPath,
        filename: id,
        sourceMaps: true,
      };
      const result = await transformAsync(code, options);
      if (!result?.code) return undefined;

      return {
        code: result.code,
        map: result.map as SourceMapInput,
      };
    },
  };
}

function isBabelExcludedPath(id: string): boolean {
  return id.startsWith('\0') || isNodeModulesPath(id);
}

function removeConsolePlugin(): Plugin {
  const extensions = ['.cjs', '.mjs', '.js', '.jsx', '.cts', '.mts', '.ts', '.tsx'];
  return {
    name: 'remove-console',
    transform(code, id) {
      if (!extensions.some((extension) => id.endsWith(extension)) || isBabelExcludedPath(id)) {
        return undefined;
      }

      return removeConsole(code, id);
    },
  };
}

function removeConsole(code: string, id: string): { code: string; map: SourceMapInput } | undefined {
  const excludedMethods = getConsoleRemovalExcludedMethods();
  if (!excludedMethods) return undefined;

  const ast = parseSync(id, code, {
    lang: getParserLang(id),
    sourceType: getParserSourceType(id),
  });
  if (ast.errors.some((error) => error.severity === 'Error')) return undefined;

  const magicString = new MagicString(code);
  const replacements: ConsoleReplacement[] = [];
  const scopes: ConsoleScope[] = [];
  collectConsoleReplacements(ast.program as unknown as ConsoleNode, undefined, undefined, scopes, replacements, excludedMethods);
  for (const replacement of selectConsoleReplacements(replacements)) {
    if (replacement.kind === 'remove') {
      magicString.remove(replacement.start, replacement.end);
    } else {
      magicString.overwrite(replacement.start, replacement.end, replacement.value);
    }
  }

  if (!magicString.hasChanged()) return undefined;
  return {
    code: magicString.toString(),
    map: magicString.generateMap({ hires: true }) as SourceMapInput,
  };
}

function getConsoleRemovalExcludedMethods(): Set<string> | undefined {
  const { env } = process;
  if (env.NODE_ENV === 'production') return new Set(['error', 'info', 'warn']);
  if (env.NODE_ENV === 'test') return new Set(['debug', 'error', 'info', 'warn']);
  return undefined;
}

function getParserLang(id: string): 'js' | 'jsx' | 'ts' | 'tsx' {
  if (id.endsWith('.tsx')) return 'tsx';
  if (id.endsWith('.ts') || id.endsWith('.cts') || id.endsWith('.mts')) return 'ts';
  if (id.endsWith('.jsx')) return 'jsx';
  return 'js';
}

function getParserSourceType(id: string): 'commonjs' | 'unambiguous' {
  return id.endsWith('.cjs') || id.endsWith('.cts') ? 'commonjs' : 'unambiguous';
}

type ConsoleNode = {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
};

type ConsoleReplacement =
  | {
      kind: 'remove';
      start: number;
      end: number;
    }
  | {
      kind: 'replace';
      start: number;
      end: number;
      value: string;
    };

type ConsoleScope = {
  end: number;
  shadowsConsole: boolean;
  start: number;
};

const noopFunctionExpression = '(function () {})';

function collectConsoleReplacements(
  node: ConsoleNode,
  parent: ConsoleNode | undefined,
  grandparent: ConsoleNode | undefined,
  scopes: ConsoleScope[],
  replacements: ConsoleReplacement[],
  excludedMethods: Set<string>
): void {
  const scope = getConsoleScope(node, parent);
  if (scope) scopes.push(scope);

  if (!isConsoleShadowed(scopes, node) && node.type === 'CallExpression') {
    collectConsoleCallReplacement(node, parent, grandparent, replacements, excludedMethods);
  }
  if (!isConsoleShadowed(scopes, node) && node.type === 'MemberExpression') {
    collectConsoleMemberReplacement(node, parent, grandparent, replacements, excludedMethods);
  }

  for (const child of getConsoleNodeChildren(node)) {
    collectConsoleReplacements(child, node, parent, scopes, replacements, excludedMethods);
  }

  if (scope) scopes.pop();
}

function getConsoleScope(node: ConsoleNode, parent: ConsoleNode | undefined): ConsoleScope | undefined {
  if (node.type === 'Program') {
    return { end: node.end, shadowsConsole: hasProgramConsoleBinding(node), start: node.start };
  }
  if (isConsoleFunctionScopeNode(node)) {
    return { end: node.end, shadowsConsole: hasFunctionConsoleBinding(node), start: node.start };
  }
  if (node.type === 'BlockStatement') {
    const isFunctionBody = parent ? isConsoleFunctionScopeNode(parent) : false;
    return { end: node.end, shadowsConsole: hasBlockConsoleBinding(node, false) || (isFunctionBody && hasHoistedVarConsoleBinding(node)), start: node.start };
  }
  if (node.type === 'CatchClause') {
    return { end: node.end, shadowsConsole: hasConsoleBindingPattern(node.param), start: node.start };
  }
  if (node.type === 'ClassExpression') {
    return { end: node.end, shadowsConsole: hasConsoleBindingPattern(node.id), start: node.start };
  }
  if (node.type === 'StaticBlock' || node.type === 'TSModuleBlock') {
    return {
      end: node.end,
      shadowsConsole:
        hasBlockConsoleBinding(node, false) ||
        hasHoistedVarConsoleBinding(node) ||
        (node.type === 'TSModuleBlock' && hasNamespaceConsoleBinding(parent)),
      start: node.start,
    };
  }
  if (node.type === 'SwitchStatement') {
    return { end: node.end, shadowsConsole: hasSwitchConsoleBinding(node), start: node.start };
  }
  if (node.type === 'ForStatement' || node.type === 'ForInStatement' || node.type === 'ForOfStatement') {
    return { end: node.end, shadowsConsole: hasLoopConsoleBinding(node), start: node.start };
  }
  return undefined;
}

function hasProgramConsoleBinding(node: ConsoleNode): boolean {
  for (const statement of getConsoleArrayProperty(node, 'body')) {
    if (hasDeclarationConsoleBinding(statement, true)) return true;
  }
  return hasHoistedVarConsoleBinding(node);
}

function hasFunctionConsoleBinding(node: ConsoleNode): boolean {
  if (hasConsoleBindingPattern(node.id)) return true;
  for (const param of getConsoleArrayProperty(node, 'params')) {
    if (hasConsoleBindingPattern(param)) return true;
  }
  return false;
}

function hasBlockConsoleBinding(node: ConsoleNode, includeVar: boolean): boolean {
  for (const statement of getConsoleArrayProperty(node, 'body')) {
    if (hasDeclarationConsoleBinding(statement, includeVar)) return true;
  }
  return false;
}

function hasSwitchConsoleBinding(node: ConsoleNode): boolean {
  for (const switchCase of getConsoleArrayProperty(node, 'cases')) {
    for (const statement of getConsoleArrayProperty(switchCase, 'consequent')) {
      if (hasDeclarationConsoleBinding(statement, false)) return true;
    }
  }
  return false;
}

function hasLoopConsoleBinding(node: ConsoleNode): boolean {
  const declaration = getConsoleNodeProperty(node, node.type === 'ForStatement' ? 'init' : 'left');
  return !!declaration && declaration.type === 'VariableDeclaration' && declaration.kind !== 'var' && hasVariableDeclarationConsoleBinding(declaration);
}

function hasHoistedVarConsoleBinding(root: ConsoleNode | undefined): boolean {
  if (!root) return false;

  for (const child of getConsoleNodeChildren(root)) {
    if (child !== root && (isConsoleFunctionScopeNode(child) || child.type === 'StaticBlock' || child.type === 'TSModuleBlock')) {
      continue;
    }
    if (
      child.type === 'VariableDeclaration' &&
      child.kind === 'var' &&
      hasVariableDeclarationConsoleBinding(child)
    ) {
      return true;
    }
    if (hasHoistedVarConsoleBinding(child)) return true;
  }
  return false;
}

function hasImportConsoleBinding(node: ConsoleNode): boolean {
  if (node.importKind === 'type') return false;
  return getConsoleArrayProperty(node, 'specifiers').some(
    (specifier) => specifier.importKind !== 'type' && hasConsoleBindingPattern(specifier.local)
  );
}

function hasDeclarationConsoleBinding(node: ConsoleNode, includeVar: boolean): boolean {
  const declaration = getExportDeclaration(node) ?? node;
  if (declaration.declare === true) return false;
  if (declaration.type === 'ImportDeclaration') return hasImportConsoleBinding(declaration);
  if (declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration') {
    return hasConsoleBindingPattern(declaration.id);
  }
  if (declaration.type === 'TSImportEqualsDeclaration') {
    return declaration.importKind !== 'type' && hasConsoleBindingPattern(declaration.id);
  }
  if (declaration.type === 'TSEnumDeclaration' || declaration.type === 'TSModuleDeclaration') {
    return hasLeftmostModuleIdConsoleBinding(getConsoleNodeProperty(declaration, 'id'));
  }
  return (
    declaration.type === 'VariableDeclaration' &&
    (includeVar || declaration.kind !== 'var') &&
    hasVariableDeclarationConsoleBinding(declaration)
  );
}

function hasNamespaceConsoleBinding(node: ConsoleNode | undefined): boolean {
  return node?.type === 'TSModuleDeclaration' && node.declare !== true && hasModuleIdConsoleBinding(getConsoleNodeProperty(node, 'id'));
}

function hasLeftmostModuleIdConsoleBinding(id: ConsoleNode | undefined): boolean {
  if (!id) return false;
  if (id.type === 'Identifier') return id.name === 'console';
  return id.type === 'TSQualifiedName' && hasLeftmostModuleIdConsoleBinding(getConsoleNodeProperty(id, 'left'));
}

function hasModuleIdConsoleBinding(id: ConsoleNode | undefined): boolean {
  if (!id) return false;
  if (id.type === 'Identifier') return id.name === 'console';
  return (
    id.type === 'TSQualifiedName' &&
    (hasModuleIdConsoleBinding(getConsoleNodeProperty(id, 'left')) || hasModuleIdConsoleBinding(getConsoleNodeProperty(id, 'right')))
  );
}

function hasVariableDeclarationConsoleBinding(node: ConsoleNode): boolean {
  return getConsoleArrayProperty(node, 'declarations').some((declaration) =>
    hasConsoleBindingPattern(getConsoleNodeProperty(declaration, 'id'))
  );
}

function hasConsoleBindingPattern(value: unknown): boolean {
  if (!isConsoleNode(value)) return false;

  if (value.type === 'Identifier' && value.name === 'console') return true;
  if (value.type === 'AssignmentPattern' || value.type === 'RestElement') {
    return hasConsoleBindingPattern(value.left ?? value.argument);
  }
  if (value.type === 'TSParameterProperty') {
    return hasConsoleBindingPattern(value.parameter);
  }
  if (value.type === 'TSQualifiedName') {
    return hasConsoleBindingPattern(value.left);
  }
  if (value.type === 'ArrayPattern') {
    return getConsoleArrayProperty(value, 'elements').some((element) => hasConsoleBindingPattern(element));
  }
  if (value.type === 'ObjectPattern') {
    return getConsoleArrayProperty(value, 'properties').some((property) =>
      hasConsoleBindingPattern(property.value ?? property.argument)
    );
  }
  return false;
}

function isConsoleFunctionScopeNode(node: ConsoleNode): boolean {
  return node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression';
}

function isConsoleShadowed(scopes: ConsoleScope[], node: ConsoleNode): boolean {
  return scopes.some((scope) => scope.shadowsConsole && scope.start <= node.start && node.end <= scope.end);
}

function collectConsoleCallReplacement(
  node: ConsoleNode,
  parent: ConsoleNode | undefined,
  grandparent: ConsoleNode | undefined,
  replacements: ConsoleReplacement[],
  excludedMethods: Set<string>
): void {
  const callee = getConsoleNodeProperty(node, 'callee');
  if (node.optional === true) return;
  if (!callee || !isIncludedConsoleMember(callee, excludedMethods)) {
    if (callee && isIncludedConsoleBindMember(callee, excludedMethods)) {
      replacements.push({ kind: 'replace', start: node.start, end: node.end, value: noopFunctionExpression });
    }
    return;
  }

  if (parent?.type === 'ExpressionStatement') {
    replacements.push(
      canRemoveConsoleExpressionStatement(grandparent)
        ? { kind: 'remove', start: parent.start, end: parent.end }
        : { kind: 'replace', start: parent.start, end: parent.end, value: ';' }
    );
  } else {
    replacements.push({ kind: 'replace', start: node.start, end: node.end, value: 'void 0' });
  }
}

function canRemoveConsoleExpressionStatement(parent: ConsoleNode | undefined): boolean {
  return !parent || parent.type === 'Program' || parent.type === 'BlockStatement' || parent.type === 'StaticBlock' || parent.type === 'SwitchCase';
}

function collectConsoleMemberReplacement(
  node: ConsoleNode,
  parent: ConsoleNode | undefined,
  grandparent: ConsoleNode | undefined,
  replacements: ConsoleReplacement[],
  excludedMethods: Set<string>
): void {
  if (!isIncludedConsoleMember(node, excludedMethods) || parent?.type === 'MemberExpression') return;
  if (parent?.type === 'CallExpression' && parent.callee === node && parent.optional !== true) return;
  if (isConsoleAssignmentTarget(node, parent, grandparent)) return;

  if (parent?.type === 'AssignmentExpression' && parent.left === node) {
    const right = getConsoleNodeProperty(parent, 'right');
    if (right) {
      replacements.push({ kind: 'replace', start: right.start, end: right.end, value: noopFunctionExpression });
    }
    return;
  }

  replacements.push({ kind: 'replace', start: node.start, end: node.end, value: noopFunctionExpression });
}

function isConsoleAssignmentTarget(
  node: ConsoleNode,
  parent: ConsoleNode | undefined,
  grandparent: ConsoleNode | undefined
): boolean {
  if (parent?.type === 'UpdateExpression' && parent.argument === node) return true;
  if ((parent?.type === 'ForInStatement' || parent?.type === 'ForOfStatement') && parent.left === node) return true;
  if (parent?.type === 'ArrayPattern') return true;
  if (parent?.type === 'AssignmentPattern' && parent.left === node) return true;
  return parent?.type === 'Property' && parent.value === node && grandparent?.type === 'ObjectPattern';
}

function isIncludedConsoleMember(node: ConsoleNode, excludedMethods: Set<string>): boolean {
  if (node.type !== 'MemberExpression') return false;

  const object = getConsoleNodeProperty(node, 'object');
  const property = getConsoleNodeProperty(node, 'property');
  if (node.optional === true) return false;
  if (!object || !property || isExcludedConsoleProperty(node, property, excludedMethods)) return false;
  if (isGlobalConsoleIdentifier(object)) return true;

  return (
    object.type === 'MemberExpression' &&
    isGlobalConsoleIdentifier(getConsoleNodeProperty(object, 'object')) &&
    // Matches babel-plugin-transform-remove-console: call/apply exclusions are checked on the outer property only.
    node.computed !== true &&
    property.type === 'Identifier' &&
    (property.name === 'call' || property.name === 'apply')
  );
}

function isIncludedConsoleBindMember(node: ConsoleNode, excludedMethods: Set<string>): boolean {
  if (node.type !== 'MemberExpression') return false;

  const object = getConsoleNodeProperty(node, 'object');
  const property = getConsoleNodeProperty(node, 'property');
  if (!object || !property || object.type !== 'MemberExpression') return false;
  if (node.computed === true || property.type !== 'Identifier' || property.name !== 'bind') return false;
  if (!isGlobalConsoleIdentifier(getConsoleNodeProperty(object, 'object'))) return false;
  const consoleMethod = getConsoleNodeProperty(object, 'property');
  return !!consoleMethod && !isExcludedConsoleProperty(object, consoleMethod, excludedMethods);
}

function isExcludedConsoleProperty(
  memberExpression: ConsoleNode,
  property: ConsoleNode,
  excludedMethods: Set<string>
): boolean {
  // The restored behavior matches babel-plugin-transform-remove-console, whose exclusions only apply to identifier properties.
  return memberExpression.computed !== true && property.type === 'Identifier' && excludedMethods.has(property.name as string);
}

function isGlobalConsoleIdentifier(node: ConsoleNode | undefined): boolean {
  return node?.type === 'Identifier' && node.name === 'console';
}

function selectConsoleReplacements(replacements: ConsoleReplacement[]): ConsoleReplacement[] {
  const selected: ConsoleReplacement[] = [];
  for (const replacement of replacements.toSorted((a, b) => a.start - b.start || b.end - a.end)) {
    if (selected.some((item) => item.start <= replacement.start && replacement.end <= item.end)) continue;
    selected.push(replacement);
  }
  return selected.toSorted((a, b) => b.start - a.start);
}

function getConsoleNodeChildren(node: ConsoleNode): ConsoleNode[] {
  return (visitorKeys[node.type] ?? [])
    .flatMap((key) => {
      const value = node[key];
      return Array.isArray(value) ? value : [value];
    })
    .filter((value): value is ConsoleNode => isConsoleNode(value));
}

function getConsoleNodeProperty(node: ConsoleNode, key: string): ConsoleNode | undefined {
  const value = node[key];
  return isConsoleNode(value) ? value : undefined;
}

function getExportDeclaration(node: ConsoleNode): ConsoleNode | undefined {
  if (node.type !== 'ExportNamedDeclaration' && node.type !== 'ExportDefaultDeclaration') return undefined;
  return getConsoleNodeProperty(node, 'declaration');
}

function getConsoleArrayProperty(node: ConsoleNode, key: string): ConsoleNode[] {
  const value = node[key];
  return Array.isArray(value) ? value.filter((item): item is ConsoleNode => isConsoleNode(item)) : [];
}

function isConsoleNode(value: unknown): value is ConsoleNode {
  return !!value && typeof value === 'object' && typeof (value as ConsoleNode).type === 'string';
}

function isNodeModulesPath(id: string): boolean {
  return id.includes('/node_modules/') || id.includes('\\node_modules\\');
}

function commonJsRuntimePreludePlugin(): Plugin {
  return {
    name: 'commonjs-runtime-prelude',
    renderChunk(code, _chunk, options) {
      const prelude = getCommonJsRuntimePrelude(code, options.format);
      if (!prelude) return undefined;

      const magicString = new MagicString(code);
      insertPrelude(magicString, code, prelude);
      return {
        code: magicString.toString(),
        map: magicString.generateMap({ hires: true }) as SourceMapInput,
      };
    },
  };
}

const commonJsRuntimePrelude = `var __create=Object.create,__defProp=Object.defineProperty,__getOwnPropDesc=Object.getOwnPropertyDescriptor,__getOwnPropNames=Object.getOwnPropertyNames,__getProtoOf=Object.getPrototypeOf,__hasOwnProp=Object.prototype.hasOwnProperty,__commonJSMin=(moduleFactory,module)=>()=>(module||(module={exports:{}},moduleFactory(module.exports,module)),module.exports),__copyProps=(to,from,except,descriptor)=>{if(from&&"object"==typeof from||"function"==typeof from)for(var key,names=__getOwnPropNames(from),index=0,length=names.length;index<length;index++)key=names[index],__hasOwnProp.call(to,key)||key===except||__defProp(to,key,{get:(key=>from[key]).bind(null,key),enumerable:!(descriptor=__getOwnPropDesc(from,key))||descriptor.enumerable});return to},__toESM=(mod,isNodeMode,target)=>(target=null!=mod?__create(__getProtoOf(mod)):{},__copyProps(!isNodeMode&&mod&&mod.__esModule?target:__defProp(target,"default",{value:mod,enumerable:!0}),mod));`;

function getCommonJsRuntimePrelude(code: string, format: string): string | undefined {
  if (!code.includes('__commonJSMin')) return undefined;

  // Rolldown 1.1.2 can emit helpers after core-js wrappers that already call them.
  // Seeding the helpers before Terser prevents minified output from calling uninitialized aliases.
  if (isCommonJsFormat(format)) return code.includes('__toESM') ? commonJsRuntimePrelude : undefined;
  return `var __commonJSMin=(moduleFactory,module)=>()=>(module||(module={exports:{}},moduleFactory(module.exports,module)),module.exports);`;
}

function isCommonJsFormat(format: string): boolean {
  return format === 'cjs' || format === 'commonjs';
}

function insertPrelude(magicString: MagicString, code: string, prelude: string): void {
  magicString.appendLeft(getPreludeInsertionIndex(code), `${prelude}\n`);
}

function getPreludeInsertionIndex(code: string): number {
  let index = 0;
  if (code.startsWith('#!')) {
    const firstLineEnd = code.indexOf('\n');
    if (firstLineEnd === -1) return code.length;
    index = firstLineEnd + 1;
  }

  const directivePattern = /(?:(?:"[^"\n]*"|'[^'\n]*');?\s*)/y;
  while (true) {
    directivePattern.lastIndex = index;
    const match = directivePattern.exec(code);
    if (!match?.[0]) return index;
    index = directivePattern.lastIndex;
  }
}

export function containsDecorator(code: string): boolean {
  return /(^|[^\p{ID_Continue}*])@\s*[(\p{ID_Start}$_]/u.test(stripComments(code));
}

const regexLiteralPrefixCharacters = new Set([
  '(',
  '[',
  '{',
  ':',
  ',',
  ';',
  '=',
  '!',
  '?',
  '&',
  '|',
  '^',
  '~',
  '+',
  '-',
  '*',
  '%',
  '<',
  '>',
]);
const regexLiteralPrefixKeywords = new Set([
  'await',
  'case',
  'default',
  'delete',
  'do',
  'else',
  'in',
  'instanceof',
  'new',
  'of',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
]);

function stripComments(code: string): string {
  let strippedCode = '';
  let index = 0;
  let quote: '"' | "'" | '`' | undefined;

  while (index < code.length) {
    const current = code[index];
    const next = code[index + 1];

    if (quote) {
      if (current === '\\') {
        strippedCode += ' ';
        if (next) strippedCode += next === '\n' ? '\n' : ' ';
        index += 2;
        continue;
      }
      if (current === quote) quote = undefined;
      strippedCode += current === '\n' ? '\n' : ' ';
      index++;
      continue;
    }

    if (current === '"' || current === "'" || current === '`') {
      quote = current;
      strippedCode += ' ';
      index++;
      continue;
    }

    if (current === '/' && next !== '/' && next !== '*' && isRegexLiteralStart(strippedCode)) {
      const regexEndIndex = getRegexLiteralEndIndex(code, index);
      strippedCode += replaceWithWhitespace(code.slice(index, regexEndIndex));
      index = regexEndIndex;
      continue;
    }

    if (current === '/' && next === '/') {
      index += 2;
      while (index < code.length && code[index] !== '\n') index++;
      strippedCode += '\n';
      continue;
    }

    if (current === '/' && next === '*') {
      index += 2;
      while (index < code.length && !(code[index] === '*' && code[index + 1] === '/')) {
        strippedCode += code[index] === '\n' ? '\n' : ' ';
        index++;
      }
      index += 2;
      continue;
    }

    strippedCode += current;
    index++;
  }
  return strippedCode;
}

function isRegexLiteralStart(strippedCode: string): boolean {
  const previousIndex = findPreviousSignificantIndex(strippedCode);
  if (previousIndex === -1) return true;
  const previous = strippedCode[previousIndex] ?? '';
  if (previous === ')') return isAfterControlStatementCondition(strippedCode, previousIndex);
  if ((previous === '+' || previous === '-') && strippedCode[findPreviousSignificantIndex(strippedCode, previousIndex - 1)] === previous) {
    return false;
  }
  if (regexLiteralPrefixCharacters.has(previous)) return true;

  const previousKeyword = strippedCode.slice(0, previousIndex + 1).match(/[\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*$/u)?.[0];
  return previousKeyword ? regexLiteralPrefixKeywords.has(previousKeyword) : false;
}

function findPreviousSignificantIndex(code: string, startIndex = code.length - 1): number {
  for (let index = startIndex; index >= 0; index--) {
    if (!/\s/u.test(code[index] ?? '')) return index;
  }
  return -1;
}

function isAfterControlStatementCondition(code: string, closeParenIndex: number): boolean {
  const openParenIndex = findMatchingOpenParenIndex(code, closeParenIndex);
  if (openParenIndex === -1) return false;

  const keywordEndIndex = findPreviousSignificantIndex(code, openParenIndex - 1);
  if (keywordEndIndex === -1) return false;

  const keyword = code.slice(0, keywordEndIndex + 1).match(/[\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*$/u)?.[0];
  return keyword ? ['for', 'if', 'while', 'with'].includes(keyword) : false;
}

function findMatchingOpenParenIndex(code: string, closeParenIndex: number): number {
  let depth = 0;
  for (let index = closeParenIndex; index >= 0; index--) {
    const current = code[index];
    if (current === ')') {
      depth++;
    } else if (current === '(') {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function getRegexLiteralEndIndex(code: string, startIndex: number): number {
  let index = startIndex + 1;
  let inCharacterClass = false;

  while (index < code.length) {
    const current = code[index];
    if (current === '\\') {
      index += 2;
      continue;
    }
    if (current === '[') inCharacterClass = true;
    if (current === ']') inCharacterClass = false;
    if (current === '/' && !inCharacterClass) {
      index++;
      while (/[\p{ID_Continue}$\u200c\u200d]/u.test(code[index] ?? '')) index++;
      return index;
    }
    if (current === '\n') return index;
    index++;
  }
  return index;
}

function replaceWithWhitespace(value: string): string {
  return value.replace(/[^\n]/gu, ' ');
}

function textPlugin(): Plugin {
  return {
    name: 'text',
    async load(id) {
      if (!id.endsWith('.csv') && !id.endsWith('.txt')) return undefined;

      const content = await fs.promises.readFile(id, 'utf8');
      return {
        code: `export default ${JSON.stringify(content)};`,
        moduleType: 'js',
      };
    },
  };
}

function terserPlugin(): Plugin {
  return {
    name: 'terser',
    async renderChunk(code, _chunk, options) {
      const sourceMapOptions: SourceMapOptions | undefined = options.sourcemap
        ? { asObject: true }
        : undefined;
      const result = await minify(code, {
        compress: { directives: false },
        ecma: 2022,
        format: { comments: false },
        module: options.format === 'es',
        sourceMap: sourceMapOptions,
      } satisfies MinifyOptions);
      if (!result.code) return undefined;

      return {
        code: result.code,
        map: result.map as SourceMapInput,
      };
    },
  };
}
