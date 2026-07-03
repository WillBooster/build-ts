import { parseSync, visitorKeys } from 'oxc-parser';

const sourceFileExtensions = ['.cjs', '.mjs', '.js', '.jsx', '.cts', '.mts', '.ts', '.tsx'];

export function isTransformTargetFile(id: string): boolean {
  return (
    sourceFileExtensions.some((extension) => id.endsWith(extension)) && !id.startsWith('\0') && !isNodeModulesPath(id)
  );
}

function isNodeModulesPath(id: string): boolean {
  return id.includes('/node_modules/') || id.includes('\\node_modules\\');
}

export function parseSourceFile(id: string, code: string): ReturnType<typeof parseSync> | undefined {
  const lang = getParserLang(id);
  const sourceType = getParserSourceType(id);
  const ast = parseSync(id, code, { lang, sourceType });
  if (!hasParseError(ast)) return ast;
  if (id.endsWith('.js') && sourceType === 'unambiguous') {
    const commonJsAst = parseSync(id, code, { lang, sourceType: 'commonjs' });
    if (!hasParseError(commonJsAst)) return commonJsAst;
  }
  return undefined;
}

function hasParseError(ast: ReturnType<typeof parseSync>): boolean {
  return ast.errors.some((error) => error.severity === 'Error');
}

function getParserLang(id: string): 'js' | 'jsx' | 'ts' | 'tsx' {
  if (id.endsWith('.tsx')) return 'tsx';
  if (id.endsWith('.ts') || id.endsWith('.cts') || id.endsWith('.mts')) return 'ts';
  if (id.endsWith('.jsx')) return 'jsx';
  return 'js';
}

function getParserSourceType(id: string): 'commonjs' | 'unambiguous' {
  return id.endsWith('.cjs') || id.endsWith('.cts') ? 'commonjs' : 'unambiguous';
}

export type AstNode = {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
};

export function getAstNodeChildren(node: AstNode): AstNode[] {
  return (visitorKeys[node.type] ?? [])
    .flatMap((key) => {
      const value = node[key];
      return Array.isArray(value) ? value : [value];
    })
    .filter((value): value is AstNode => isAstNode(value));
}

export function getAstNodeProperty(node: AstNode, key: string): AstNode | undefined {
  const value = node[key];
  return isAstNode(value) ? value : undefined;
}

export function getAstArrayProperty(node: AstNode, key: string): AstNode[] {
  const value = node[key];
  return Array.isArray(value) ? value.filter((item): item is AstNode => isAstNode(item)) : [];
}

export function isAstNode(value: unknown): value is AstNode {
  return !!value && typeof value === 'object' && typeof (value as AstNode).type === 'string';
}
