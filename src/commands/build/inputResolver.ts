import path from 'node:path';

import { ResolverFactory } from 'rolldown/experimental';

// The single source of truth for the bundler's `resolve` configuration: the same object configures
// both the bundler and the resolver below, so the two cannot drift apart.
export const bundlerResolveOptions = {
  extensionAlias: {
    '.cjs': ['.cjs', '.cts'],
    '.js': ['.js', '.ts', '.tsx'],
    '.jsx': ['.jsx', '.ts', '.tsx'],
    '.mjs': ['.mjs', '.mts'],
  },
  extensions: ['.cts', '.mts', '.ts', '.tsx', '.cjs', '.mjs', '.js', '.jsx', '.json'],
  mainFields: ['module', 'main'],
  mainFiles: ['index'],
};

/**
 * Creates a resolver for one resolution pass. Its cache never observes later file system changes, so
 * a watch rebuild must create a new one rather than reuse an earlier resolver.
 */
export function createBundlerResolver(): ResolverFactory {
  return new ResolverFactory(bundlerResolveOptions);
}

/**
 * Resolves a bundler-style entry path to the source file the bundler loads for it, so that a
 * declaration is always generated for the file that ends up bundled. Returns undefined when the
 * bundler cannot resolve the path either.
 */
export function resolveSourceFilePath(literalPath: string, resolver?: ResolverFactory): string | undefined {
  // The bundler's own resolver is used rather than a reimplementation of it: directory and package
  // entry resolution has many behaviors that are easy to get subtly wrong (entry field precedence,
  // nested packages, duplicate keys, byte order marks, symlink cycles), and any difference silently
  // describes a different source than the one bundled.
  const { path: resolvedPath } = (resolver ?? createBundlerResolver()).sync(
    path.dirname(literalPath),
    `./${path.basename(literalPath)}`
  );
  return resolvedPath;
}
