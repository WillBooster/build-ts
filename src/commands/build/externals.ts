import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';

import type { PackageJson } from 'type-fest';

import type { ArgumentsType, TargetDetail } from '../../types.js';

import type { builder } from './builder.js';

const nodeBuiltinModules = new Set(builtinModules);

export function createExternalMatcher(
  argv: ArgumentsType<typeof builder>,
  targetDetail: TargetDetail,
  packageJson: PackageJson,
  namespace: string | undefined,
  packageDirPath: string
): (id: string) => boolean {
  const bundledBuiltinNames = getBundledBuiltinNames(argv);
  const externalDependencyNames = new Set(
    collectExternalDependencies(argv, targetDetail, packageJson, packageDirPath, namespace, bundledBuiltinNames)
  );
  return (id) => {
    if (getBundledBuiltinPackageName(id, bundledBuiltinNames)) return false;
    return isNodeBuiltin(id) || matchesModuleOrSubpath(id, externalDependencyNames);
  };
}

/** Checks whether `id` equals a name in `names` or is a subpath of it (e.g. `lodash.chunk/index.js`). */
function matchesModuleOrSubpath(id: string, names: Set<string>): boolean {
  if (names.has(id)) return true;
  for (let slashIndex = id.indexOf('/'); slashIndex !== -1; slashIndex = id.indexOf('/', slashIndex + 1)) {
    if (names.has(id.slice(0, slashIndex))) return true;
  }
  return false;
}

function collectExternalDependencies(
  argv: ArgumentsType<typeof builder>,
  targetDetail: TargetDetail,
  packageJson: PackageJson,
  packageDirPath: string,
  namespace: string | undefined,
  bundledBuiltinNames: Set<string>
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
  const parentDirPath = path.dirname(packageDirPath);
  if (fs.existsSync(path.join(path.dirname(parentDirPath), 'package.json'))) {
    const packageDirs = fs.readdirSync(parentDirPath, { withFileTypes: true });
    for (const packageDir of packageDirs) {
      if (!packageDir.isDirectory()) continue;

      const packageJsonPath = path.join(parentDirPath, packageDir.name, 'package.json');
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

  const bundledNamespacePattern =
    shouldBundleSameNamespaceDependencies(targetDetail) && namespace ? new RegExp(`^@?${namespace}(?:/.+)?`) : undefined;
  return externalDeps.filter((dependencyName) => {
    if (bundledBuiltinNames.has(normalizeNodeBuiltinName(dependencyName))) return false;
    return !bundledNamespacePattern?.test(dependencyName);
  });
}

export function getBundledBuiltinNames(argv: ArgumentsType<typeof builder>): Set<string> {
  return new Set(argv.bundleBuiltins?.map((item) => normalizeNodeBuiltinName(item.toString())) ?? []);
}

function shouldBundleSameNamespaceDependencies(targetDetail: TargetDetail): boolean {
  return targetDetail === 'app-node' || targetDetail === 'functions';
}

export function getBundledBuiltinPackageName(id: string, bundledBuiltinNames: Set<string>): string | undefined {
  const normalizedId = normalizeNodeBuiltinName(id);
  for (const packageName of bundledBuiltinNames) {
    if (normalizedId === packageName || normalizedId.startsWith(`${packageName}/`)) return packageName;
  }
  return undefined;
}

export function getPackageSubpath(id: string, packageName: string): string {
  const normalizedId = normalizeNodeBuiltinName(id);
  return normalizedId === packageName ? '.' : `./${normalizedId.slice(packageName.length + 1)}`;
}

export function normalizeNodeBuiltinName(id: string): string {
  return id.startsWith('node:') ? id.slice('node:'.length) : id;
}

export function isNodeBuiltin(id: string): boolean {
  return id.startsWith('node:') || nodeBuiltinModules.has(id);
}
