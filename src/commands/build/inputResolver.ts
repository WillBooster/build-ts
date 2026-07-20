import path from 'node:path';

import { ResolverFactory } from 'rolldown/experimental';

/** The platform the bundler resolves for, which it derives from each output format. */
export type BundlerPlatform = 'browser' | 'node';

// Only the options the bundler is actually given: its remaining defaults are platform-dependent, so
// pinning them here would change which source gets bundled.
export const bundlerResolveOptions = {
  extensionAlias: {
    '.cjs': ['.cjs', '.cts'],
    '.js': ['.js', '.ts', '.tsx'],
    '.jsx': ['.jsx', '.ts', '.tsx'],
    '.mjs': ['.mjs', '.mts'],
  },
  extensions: ['.cts', '.mts', '.ts', '.tsx', '.cjs', '.mjs', '.js', '.jsx', '.json'],
};

// The bundler's defaults for each platform, which `ResolverFactory` does not apply on its own.
// Verified against the bundler: a directory whose package.json has "browser", "module" and "main"
// resolves to the browser entry for an ESM output and to the main entry for a CommonJS one, and the
// "browser" alias map only takes effect for the former.
const platformResolveOptions: Record<BundlerPlatform, { aliasFields: string[][]; mainFields: string[] }> = {
  browser: { aliasFields: [['browser']], mainFields: ['browser', 'module', 'main'] },
  node: { aliasFields: [], mainFields: ['main', 'module'] },
};

// The resolver reports a deliberately ignored entry as an error rather than as a distinct state, so
// the two have to be told apart by this prefix.
const ignoredPathErrorPrefix = 'Path is ignored';

/** Reports whether the bundler can resolve the path on any platform, for validating an input. */
export function isBundlerResolvablePath(literalPath: string): boolean {
  return resolveSourceFilePaths(literalPath, createBundlerResolvers(['browser', 'node'])) !== undefined;
}

/**
 * Resolves an entry path to every source file the bundler loads for it, which is more than one when
 * the outputs resolve differently per platform (e.g. a "browser" entry for ESM and a "main" entry for
 * CommonJS). An empty array means the bundler deliberately ignores the entry on every platform (a
 * `"browser"` mapping to `false`), which is a successful resolution that simply has no source file.
 * Returns undefined only when the bundler cannot resolve the path either.
 */
export function resolveSourceFilePaths(literalPath: string, resolvers: ResolverFactory[]): string[] | undefined {
  const resolvedPaths: string[] = [];
  let isUnresolved = false;
  for (const resolver of resolvers) {
    const { error, path: resolvedPath } = resolver.sync(path.dirname(literalPath), `./${path.basename(literalPath)}`);
    if (resolvedPath) {
      resolvedPaths.push(resolvedPath);
    } else if (!error?.startsWith(ignoredPathErrorPrefix)) {
      isUnresolved = true;
    }
  }
  // A path resolved for one platform still needs its declarations, even if another platform fails.
  return isUnresolved && resolvedPaths.length === 0 ? undefined : [...new Set(resolvedPaths)];
}

/**
 * Creates the resolvers for one resolution pass. Their caches never observe later file system
 * changes, so a watch rebuild must create new ones rather than reuse earlier resolvers.
 */
export function createBundlerResolvers(platforms: Iterable<BundlerPlatform>): ResolverFactory[] {
  // The bundler's own resolver is used rather than a reimplementation of it: directory and package
  // entry resolution has many behaviors that are easy to get subtly wrong (entry field precedence,
  // nested packages, duplicate keys, byte order marks, symlink cycles), and any difference silently
  // describes a different source than the one bundled.
  return [...new Set(platforms)].map(
    (platform) =>
      new ResolverFactory({ ...bundlerResolveOptions, ...platformResolveOptions[platform], mainFiles: ['index'] })
  );
}
