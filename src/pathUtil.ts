import path from 'node:path';
import url from 'node:url';

export function getBuildTsRootPath(): string {
  return url.fileURLToPath(path.dirname(path.dirname(import.meta.url)));
}
