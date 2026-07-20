import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import type { PackageJson } from 'type-fest';

export async function readPackageJson(dirPath: string): Promise<[PackageJson | undefined, string]> {
  const packageJsonPath = path.join(dirPath, 'package.json');
  try {
    const packageJsonText = await fs.promises.readFile(packageJsonPath, 'utf8');
    return [JSON.parse(packageJsonText) as PackageJson, packageJsonPath];
  } catch {
    // do nothing
  }
  return [undefined, packageJsonPath];
}

export function getBuildTsRootPath(): string {
  return path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
}

/** Returns the scope of a package name (e.g. "willbooster" for "@willbooster/shared-lib"). */
export function getNamespace(packageJson: PackageJson): string | undefined {
  return /^@([^/]+)\//.exec(packageJson.name ?? '')?.[1];
}

export function formatDateTime(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}:${pad(date.getSeconds())}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;

  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${Number(seconds.toFixed(1))}s`;

  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Number((seconds - minutes * 60).toFixed(1))}s`;
}
