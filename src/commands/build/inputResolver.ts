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
const platformResolveOptions: Record<
  BundlerPlatform,
  { aliasFields: string[][]; conditionNames: string[]; mainFields: string[] }
> = {
  browser: {
    aliasFields: [['browser']],
    conditionNames: ['import', 'browser', 'default'],
    mainFields: ['browser', 'module', 'main'],
  },
  node: { aliasFields: [], conditionNames: ['import', 'node', 'default'], mainFields: ['main', 'module'] },
};

const ignoredPathErrorPrefix = 'Path is ignored';

/** Reports whether any platform accepts the path, which is all an input needs to be worth passing on. */
export function isBundlerResolvablePath(literalPath: string): boolean {
  return createBundlerResolvers(['browser', 'node']).some((resolver) => {
    const { error, path: resolvedPath } = resolve(literalPath, resolver);
    return resolvedPath !== undefined || isIgnored(error);
  });
}

/**
 * Resolves an entry path to every source file the bundler loads for it, which is more than one when
 * the outputs resolve differently per platform (e.g. a "browser" entry for ESM and a "main" entry for
 * CommonJS). An empty array means the bundler deliberately ignores the entry on every platform (a
 * `"browser"` mapping to `false`), which is a successful resolution that simply has no source file.
 * Returns undefined when any requested platform fails to resolve, since the bundler fails there too.
 */
export function resolveSourceFilePaths(literalPath: string, resolvers: ResolverFactory[]): string[] | undefined {
  const resolvedPaths: string[] = [];
  for (const resolver of resolvers) {
    const { error, path: resolvedPath } = resolve(literalPath, resolver);
    if (resolvedPath) {
      resolvedPaths.push(resolvedPath);
    } else if (!isIgnored(error)) {
      // Succeeding here would let declaration generation pass for a build the bundler rejects.
      return undefined;
    }
  }
  return [...new Set(resolvedPaths)];
}

function resolve(literalPath: string, resolver: ResolverFactory): { error?: string; path?: string } {
  return resolver.sync(path.dirname(literalPath), `./${path.basename(literalPath)}`);
}

// A deliberately ignored entry is reported as an error rather than as a distinct state, so the two
// have to be told apart by the message itself.
function isIgnored(error: string | undefined): boolean {
  return error?.startsWith(ignoredPathErrorPrefix) ?? false;
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
