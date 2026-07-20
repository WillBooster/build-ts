import fs from 'node:fs';
import path from 'node:path';

// The single source of truth for the bundler's `resolve` configuration, so that the entry paths the
// bundler accepts and the ones resolved for declaration generation can never drift apart.
// `mainFields` and `mainFiles` are pinned to the bundler's own defaults rather than left implicit,
// since directory resolution below has to reproduce their precedence exactly.
export const bundlerExtensionAlias: Record<string, string[]> = {
  '.cjs': ['.cjs', '.cts'],
  '.js': ['.js', '.ts', '.tsx'],
  // The bundler substitutes TypeScript sources for a missing `.jsx` file even without this entry;
  // spelling it out keeps declaration resolution from having to rediscover the same precedence.
  '.jsx': ['.jsx', '.ts', '.tsx'],
  '.mjs': ['.mjs', '.mts'],
};
export const bundlerExtensions = ['.cts', '.mts', '.ts', '.tsx', '.cjs', '.mjs', '.js', '.jsx', '.json'];
export const bundlerMainFields = ['module', 'main'];
export const bundlerMainFiles = ['index'];

/**
 * Resolves a bundler-style entry path to the source file the bundler loads for it: a `.js` specifier
 * falls back to its aliased `.ts` source, an extension-less path gains one of the configured
 * extensions, and a directory resolves through its package entry fields or its `index` file.
 * Returns undefined when no file exists.
 */
export function resolveSourceFilePath(literalPath: string, visitedDirPaths?: Set<string>): string | undefined {
  const stats = fs.statSync(literalPath, { throwIfNoEntry: false });
  if (stats?.isFile()) return literalPath;

  // The configured extensions are tried before an existing directory is treated as a package, so that
  // `src/entry.ts` wins over `src/entry/index.ts` exactly as it does in the bundler.
  const resolvedPath = resolveWithExtensions(literalPath);
  if (resolvedPath) return resolvedPath;

  return stats?.isDirectory() ? resolveDirectoryPath(literalPath, visitedDirPaths ?? new Set()) : undefined;
}

function resolveDirectoryPath(dirPath: string, visitedDirPaths: Set<string>): string | undefined {
  // A package entry field may point back at an ancestor directory, which would otherwise recurse
  // forever. Symlinks make that cycle reachable through ever-growing lexical paths (`loop/loop/...`),
  // so directories are identified by their canonical path.
  const visitedKey = toCanonicalDirPath(dirPath);
  if (visitedDirPaths.has(visitedKey)) return undefined;
  visitedDirPaths.add(visitedKey);

  const packageJson = readPackageJson(path.join(dirPath, 'package.json'));
  for (const field of bundlerMainFields) {
    const entry = packageJson?.[field];
    if (typeof entry !== 'string') continue;

    // An entry pointing back at an enclosing directory (directly or through a symlink) makes the
    // bundler fall through to the main files rather than consider the remaining fields, so a later
    // field must not win here.
    const entryPath = path.resolve(dirPath, entry);
    if (visitedDirPaths.has(toCanonicalDirPath(entryPath))) break;

    // The entry itself may be extension-aliased or another directory, so it is resolved recursively.
    const resolvedPath = resolveSourceFilePath(entryPath, visitedDirPaths);
    if (resolvedPath) return resolvedPath;
  }
  for (const mainFile of bundlerMainFiles) {
    const resolvedPath = resolveWithExtensions(path.join(dirPath, mainFile));
    if (resolvedPath) return resolvedPath;
  }
  return undefined;
}

function toCanonicalDirPath(dirPath: string): string {
  try {
    return fs.realpathSync(dirPath);
  } catch {
    // An unresolvable path cannot form a cycle, so its lexical form is a sufficient identity.
    return dirPath;
  }
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

function readPackageJson(packageJsonPath: string): Record<string, unknown> | undefined {
  let content: string;
  try {
    content = fs.readFileSync(packageJsonPath, 'utf8');
  } catch (error) {
    // Most directories simply have no package.json, which is not an error for the bundler either.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') {
      return undefined;
    }
    throw error;
  }

  try {
    // The bundler's parser tolerates a byte order mark, so falling back to `index` over one would
    // silently describe a different source than the bundled JavaScript.
    const parsed: unknown = JSON.parse(content.replace(/^\uFEFF/, ''));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch (error) {
    // Falling back to `index` here would let `--declaration-only` succeed for an entry the bundler
    // cannot resolve at all, so a malformed package.json fails the build instead.
    throw new Error(`Failed to parse ${packageJsonPath}: ${(error as Error).message}`);
  }
}
