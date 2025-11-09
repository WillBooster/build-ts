import fs from 'node:fs';
import path from 'node:path';

import { parse } from '@babel/parser';
import {
  VISITOR_KEYS,
  isIdentifier,
  type MemberExpression,
  type Node,
  type TaggedTemplateExpression,
} from '@babel/types';
import MagicString, { type SourceMap } from 'magic-string';
import type { Plugin } from 'rollup';

const TARGET_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);

export function rawTemplateWorkaroundPlugin(): Plugin {
  return {
    name: 'build-ts-raw-template-workaround',
    load(id) {
      if (id.includes('node_modules')) return null;
      if (!TARGET_EXTENSIONS.has(path.extname(id))) return null;

      let source: string;
      try {
        source = fs.readFileSync(id, 'utf8');
      } catch {
        return null;
      }
      if (!source.includes('String.raw`')) {
        return null;
      }

      const { code, map, changed } = normalizeStringRawTemplates(source);
      return changed ? { code, map } : null;
    },
  };
}

function normalizeStringRawTemplates(code: string): { code: string; map: SourceMap | null; changed: boolean } {
  let ast;
  try {
    ast = parse(code, {
      sourceType: 'module',
      allowReturnOutsideFunction: true,
      allowSuperOutsideMethod: true,
      errorRecovery: true,
      plugins: [
        ['decorators', { decoratorsBeforeExport: false }],
        'typescript',
        'jsx',
        'classProperties',
        'classPrivateProperties',
        'classPrivateMethods',
        'explicitResourceManagement',
        'importAttributes',
      ],
    });
  } catch {
    return { code, map: null, changed: false };
  }

  const magicString = new MagicString(code);
  let changed = false;

  const visit = (node: Node | null | undefined): void => {
    if (!node) return;
    if (node.type === 'TaggedTemplateExpression' && shouldReplace(node)) {
      const templateElement = node.quasi.quasis[0]!;
      const rawText = templateElement.value.raw;
      if (node.start != null && node.end != null) {
        magicString.overwrite(node.start, node.end, `'${encodeRawText(rawText)}'`);
        changed = true;
      }
      return;
    }

    const keys = VISITOR_KEYS[node.type];
    if (!keys) return;
    for (const key of keys) {
      const value = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child === 'object') {
            visit(child as Node);
          }
        }
      } else if (value && typeof value === 'object') {
        visit(value as Node);
      }
    }
  };

  visit(ast.program);
  return {
    code: changed ? magicString.toString() : code,
    map: changed ? magicString.generateMap({ includeContent: true }) : null,
    changed,
  };
}

function shouldReplace(node: TaggedTemplateExpression): boolean {
  if (node.quasi.expressions.length > 0) return false;
  const quasiCount = node.quasi.quasis.length;
  if (quasiCount !== 1) return false;
  const tag = node.tag as MemberExpression | undefined;
  if (!tag || tag.type !== 'MemberExpression' || tag.computed) return false;
  return isIdentifier(tag.object, { name: 'String' }) && isIdentifier(tag.property, { name: 'raw' });
}

function encodeRawText(raw: string): string {
  let result = '';
  for (const ch of raw) {
    switch (ch) {
      case '\\':
        result += '\\u005c';
        break;
      case "'":
        result += "\\'";
        break;
      case '\n':
        result += '\\n';
        break;
      case '\r':
        result += '\\r';
        break;
      case '\u2028':
        result += '\\u2028';
        break;
      case '\u2029':
        result += '\\u2029';
        break;
      default:
        result += ch;
        break;
    }
  }
  return result;
}
