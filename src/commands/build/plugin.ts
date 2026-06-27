import fs from 'node:fs';
import { builtinModules } from 'node:module';
import { createRequire } from 'node:module';
import path from 'node:path';

import type { TransformOptions } from '@babel/core';
import MagicString from 'magic-string';
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
  if (!packageJson.exports && subpath === '.') {
    const resolvedPath = require.resolve(packageName);
    if (resolvedPath !== packageName && !resolvedPath.startsWith('node:')) return resolvedPath;
  }

  const entryPath = getPackageEntryPath(packageJson, conditions, subpath);
  if (!entryPath) {
    throw new Error(`Failed to resolve package export for ${packageName}`);
  }
  return path.join(path.dirname(packageJsonPath), entryPath);
}

function getPackageExportConditions(importKind: ImportKind): Set<string> {
  const conditions = new Set(['node', 'default']);
  if (importKind === 'require-call') {
    conditions.add('require');
  } else {
    conditions.add('import');
  }
  return conditions;
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
  if (packageJson.exports) return normalizePackageEntryPath(getExportEntryPath(packageJson.exports, conditions, subpath));
  if (subpath === '.') return packageJson.main ?? 'index.js';
  return normalizePackageEntryPath(subpath);
}

function getExportEntryPath(
  exportsField: unknown,
  conditions: Set<string>,
  subpath: string,
  patternMatch?: string
): string | undefined {
  if (typeof exportsField === 'string') {
    return subpath === '.' ? applyExportPattern(exportsField, patternMatch) : undefined;
  }
  if (Array.isArray(exportsField)) {
    if (subpath !== '.') return undefined;

    for (const exportEntry of exportsField) {
      const entryPath = getExportEntryPath(exportEntry, conditions, subpath, patternMatch);
      if (entryPath) return entryPath;
    }
    return undefined;
  }
  if (!exportsField || typeof exportsField !== 'object') return undefined;

  const exportRecord = exportsField as Record<string, unknown>;
  if (hasExportSubpaths(exportRecord)) {
    const subpathExport = exportRecord[subpath] ?? findExportSubpathPattern(exportRecord, subpath);
    return subpathExport === undefined ? undefined : getExportEntryPath(subpathExport, conditions, '.');
  }
  if (subpath !== '.') return undefined;

  for (const [condition, value] of Object.entries(exportRecord)) {
    if (!conditions.has(condition)) continue;

    const entryPath = getExportEntryPath(value, conditions, subpath, patternMatch);
    if (entryPath) return entryPath;
  }
  return undefined;
}

function hasExportSubpaths(exportRecord: Record<string, unknown>): boolean {
  return Object.keys(exportRecord).some((key) => key === '.' || key.startsWith('./'));
}

function findExportSubpathPattern(exportRecord: Record<string, unknown>, subpath: string): unknown {
  for (const [key, value] of Object.entries(exportRecord)) {
    const patternMatch = getExportPatternMatch(key, subpath);
    if (patternMatch !== undefined) {
      return replaceExportPattern(value, patternMatch);
    }
  }
  return undefined;
}

function getExportPatternMatch(pattern: string, subpath: string): string | undefined {
  if (!pattern.startsWith('./') || !pattern.includes('*')) return undefined;

  const [prefix, suffix] = pattern.split('*', 2) as [string, string];
  if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) return undefined;
  return subpath.slice(prefix.length, subpath.length - suffix.length);
}

function replaceExportPattern(value: unknown, patternMatch: string): unknown {
  if (typeof value === 'string') return applyExportPattern(value, patternMatch);
  if (Array.isArray(value)) return value.map((item) => replaceExportPattern(item, patternMatch));
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, replaceExportPattern(item, patternMatch)])
  );
}

function applyExportPattern(value: string, patternMatch: string | undefined): string {
  return patternMatch === undefined ? value : value.replaceAll('*', patternMatch);
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
