import fs from 'node:fs';
import path from 'node:path';

// The single source of truth for the bundler's `resolve` configuration, so that the entry paths the
// bundler accepts and the ones resolved for declaration generation can never drift apart.
// `mainFields` and `mainFiles` are pinned to the bundler's own defaults rather than left implicit,
// since directory resolution below has to reproduce their precedence exactly.
export const bundlerExtensionAlias: Record<string, string[]> = {
  '.cjs': ['.cjs', '.cts'],
  '.js': ['.js', '.ts', '.tsx'],
  '.mjs': ['.mjs', '.mts'],
};
export const bundlerExtensions = ['.cts', '.mts', '.ts', '.tsx', '.cjs', '.mjs', '.js', '.jsx', '.json'];
export const bundlerMainFields = ['module', 'main'];
export const bundlerMainFiles = ['index'];

/**
 * Resolves a bundler-style entry path to the source file the bundler loads for it: a directory
 * resolves through its package entry fields or its `index` file, a `.js` specifier falls back to its
 * aliased `.ts` source, and an extension-less path gains one of the configured extensions.
 * Returns undefined when no file exists.
 */
export function resolveSourceFilePath(literalPath: string, visitedDirPaths?: Set<string>): string | undefined {
  const stats = fs.statSync(literalPath, { throwIfNoEntry: false });
  if (stats?.isFile()) return literalPath;
  if (stats?.isDirectory()) return resolveDirectoryPath(literalPath, visitedDirPaths ?? new Set());
  return resolveWithExtensions(literalPath);
}

function resolveDirectoryPath(dirPath: string, visitedDirPaths: Set<string>): string | undefined {
  // A package entry field may point back at an ancestor directory, which would otherwise recurse forever.
  if (visitedDirPaths.has(dirPath)) return undefined;
  visitedDirPaths.add(dirPath);

  const packageJson = readPackageJson(path.join(dirPath, 'package.json'));
  for (const field of bundlerMainFields) {
    const entry = packageJson?.[field];
    // The entry itself may be extension-aliased or another directory, so it is resolved recursively.
    const resolvedPath =
      typeof entry === 'string' ? resolveSourceFilePath(path.resolve(dirPath, entry), visitedDirPaths) : undefined;
    if (resolvedPath) return resolvedPath;
  }
  for (const mainFile of bundlerMainFiles) {
    const resolvedPath = resolveWithExtensions(path.join(dirPath, mainFile));
    if (resolvedPath) return resolvedPath;
  }
  return undefined;
}

function resolveWithExtensions(basePath: string): string | undefined {
  const extension = path.extname(basePath);
  const candidates = [
    // An aliased extension takes precedence, since the bundler swaps it instead of appending to it.
    ...(bundlerExtensionAlias[extension] ?? []).map((ext) => basePath.slice(0, -extension.length) + ext),
    ...bundlerExtensions.map((ext) => basePath + ext),
  ];
  return candidates.find((candidate) => fs.statSync(candidate, { throwIfNoEntry: false })?.isFile());
}

// A malformed or unreadable package.json is ignored so that resolution falls back to the main files,
// matching the bundler, which likewise does not fail the build over it.
function readPackageJson(packageJsonPath: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
