declare module 'rollup-plugin-string' {
  import type { Plugin } from 'rollup';

  export function string(options: { include: string[]; exclude?: string[] }): Plugin;
}
