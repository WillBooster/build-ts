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
  return url.fileURLToPath(path.dirname(path.dirname(import.meta.url)));
}

export function getNamespaceAndName(packageJson: PackageJson): [string | undefined, string | undefined] {
  const packageName = packageJson.name?.toString() || '';
  const match = /@([^/]+)\/(.+)/.exec(packageName);
  const [, namespace, name] = match || [];
  return [namespace, name];
}
