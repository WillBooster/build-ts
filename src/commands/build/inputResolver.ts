import fs from 'node:fs';
import path from 'node:path';

// The single source of truth for the bundler's `resolve` configuration, so that the entry paths the
// bundler accepts and the ones resolved for declaration generation can never drift apart.
export const bundlerExtensionAlias: Record<string, string[]> = {
  '.cjs': ['.cjs', '.cts'],
  '.js': ['.js', '.ts', '.tsx'],
  '.mjs': ['.mjs', '.mts'],
};
export const bundlerExtensions = ['.cts', '.mts', '.ts', '.tsx', '.cjs', '.mjs', '.js', '.jsx', '.json'];

/**
 * Resolves a bundler-style entry path to the source file the bundler loads for it: a directory
 * resolves through its `index` file, a `.js` specifier falls back to its aliased `.ts` source, and an
 * extension-less path gains one of the configured extensions. Returns undefined when no file exists.
 */
export function resolveSourceFilePath(literalPath: string): string | undefined {
  const stats = fs.statSync(literalPath, { throwIfNoEntry: false });
  if (stats?.isFile()) return literalPath;

  const basePath = stats?.isDirectory() ? path.join(literalPath, 'index') : literalPath;
  const extension = path.extname(basePath);
  const candidates = [
    // An aliased extension takes precedence, since the bundler swaps it instead of appending to it.
    ...(bundlerExtensionAlias[extension] ?? []).map((ext) => basePath.slice(0, -extension.length) + ext),
    ...bundlerExtensions.map((ext) => basePath + ext),
  ];
  return candidates.find((candidate) => fs.statSync(candidate, { throwIfNoEntry: false })?.isFile());
}
