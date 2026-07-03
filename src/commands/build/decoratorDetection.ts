import type { AstNode } from './transformUtils.js';
import { getAstNodeChildren, isAstNode, parseSourceFile } from './transformUtils.js';

/**
 * Checks whether the given code contains a decorator, ignoring `@` in comments, strings, and regexes.
 */
export function containsDecorator(code: string, id = 'file.ts'): boolean {
  // A decorator requires a literal `@` even when its identifier uses escapes such as `\u0063ustom`.
  if (!code.includes('@')) return false;

  const ast = parseSourceFile(id, code);
  // If the code fails to parse, let Babel transform it and report a proper syntax error.
  if (!ast) return true;
  return isAstNode(ast.program) && hasDecoratorNode(ast.program);
}

function hasDecoratorNode(node: AstNode): boolean {
  if (node.type === 'Decorator') return true;
  return getAstNodeChildren(node).some((child) => hasDecoratorNode(child));
}
