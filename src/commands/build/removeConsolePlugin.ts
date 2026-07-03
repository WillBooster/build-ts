import MagicString from 'magic-string';
import type { Plugin, SourceMapInput } from 'rolldown';

import type { AstNode } from './transformUtils.js';
import {
  getAstArrayProperty,
  getAstNodeChildren,
  getAstNodeProperty,
  isAstNode,
  isTransformTargetFile,
  parseSourceFile,
} from './transformUtils.js';

export function getConsoleRemovalExcludedMethods(): Set<string> | undefined {
  const { env } = process;
  if (env.NODE_ENV === 'production') return new Set(['error', 'info', 'warn']);
  if (env.NODE_ENV === 'test') return new Set(['debug', 'error', 'info', 'warn']);
  return undefined;
}

export function removeConsolePlugin(excludedMethods: Set<string>): Plugin {
  return {
    name: 'remove-console',
    transform(code, id) {
      if (!isTransformTargetFile(id)) return undefined;
      // Escaped identifiers such as `\u0063onsole` must still be handled, so also match `\u` escapes.
      if (!/console|\\u/.test(code)) return undefined;

      return removeConsole(code, id, excludedMethods);
    },
  };
}

function removeConsole(code: string, id: string, excludedMethods: Set<string>): { code: string; map: SourceMapInput } | undefined {
  const ast = parseSourceFile(id, code);
  if (!ast || !isAstNode(ast.program)) return undefined;

  const magicString = new MagicString(code);
  const replacements: ConsoleReplacement[] = [];
  const scopes: ConsoleScope[] = [];
  collectConsoleReplacements(ast.program, [], scopes, replacements, excludedMethods);
  for (const replacement of selectConsoleReplacements(replacements)) {
    magicString.overwrite(replacement.start, replacement.end, replacement.value);
  }

  if (!magicString.hasChanged()) return undefined;
  return {
    code: magicString.toString(),
    map: magicString.generateMap({ hires: true }) as SourceMapInput,
  };
}

type ConsoleReplacement = {
  kind: 'replace';
  start: number;
  end: number;
  value: string;
};

type ConsoleScope = {
  end: number;
  shadowsConsole: boolean;
  start: number;
};

const noopFunctionExpression = '(function () {})';
const undefinedExpression = '(void 0)';

function collectConsoleReplacements(
  node: AstNode,
  ancestors: AstNode[],
  scopes: ConsoleScope[],
  replacements: ConsoleReplacement[],
  excludedMethods: Set<string>
): void {
  const parent = ancestors.at(-1);
  const scope = getConsoleScope(node, parent);
  if (scope) scopes.push(scope);

  if (!isConsoleShadowed(scopes, node) && node.type === 'CallExpression') {
    collectConsoleCallReplacement(node, ancestors, replacements, excludedMethods);
  }
  if (!isConsoleShadowed(scopes, node) && node.type === 'MemberExpression') {
    collectConsoleMemberReplacement(node, ancestors, replacements, excludedMethods);
  }

  const childAncestors = [...ancestors, node];
  for (const child of getAstNodeChildren(node)) {
    collectConsoleReplacements(child, childAncestors, scopes, replacements, excludedMethods);
  }

  if (scope) scopes.pop();
}

function getConsoleScope(node: AstNode, parent: AstNode | undefined): ConsoleScope | undefined {
  if (node.type === 'Program') {
    return { end: node.end, shadowsConsole: hasProgramConsoleBinding(node), start: node.start };
  }
  if (isConsoleFunctionScopeNode(node)) {
    return { end: node.end, shadowsConsole: hasFunctionConsoleBinding(node), start: node.start };
  }
  if (node.type === 'BlockStatement') {
    const isFunctionBody = parent ? isConsoleFunctionScopeNode(parent) : false;
    return { end: node.end, shadowsConsole: hasBlockConsoleBinding(node, false) || (isFunctionBody && hasHoistedVarConsoleBinding(node)), start: node.start };
  }
  if (node.type === 'CatchClause') {
    return { end: node.end, shadowsConsole: hasConsoleBindingPattern(node.param), start: node.start };
  }
  if (node.type === 'ClassExpression') {
    return { end: node.end, shadowsConsole: hasConsoleBindingPattern(node.id), start: node.start };
  }
  if (node.type === 'StaticBlock' || node.type === 'TSModuleBlock') {
    return {
      end: node.end,
      shadowsConsole:
        hasBlockConsoleBinding(node, false) ||
        hasHoistedVarConsoleBinding(node) ||
        (node.type === 'TSModuleBlock' && hasNamespaceConsoleBinding(parent)),
      start: node.start,
    };
  }
  if (node.type === 'SwitchStatement') {
    return { end: node.end, shadowsConsole: hasSwitchConsoleBinding(node), start: getSwitchScopeStart(node) };
  }
  if (node.type === 'SwitchCase') {
    const switchShadowsConsole = parent?.type === 'SwitchStatement' && hasSwitchConsoleBinding(parent);
    return {
      end: node.end,
      shadowsConsole: switchShadowsConsole || hasSwitchCaseConsoleBinding(node),
      start: getSwitchCaseScopeStart(node),
    };
  }
  if (node.type === 'ForStatement' || node.type === 'ForInStatement' || node.type === 'ForOfStatement') {
    return { end: node.end, shadowsConsole: hasLoopConsoleBinding(node), start: node.start };
  }
  return undefined;
}

function hasProgramConsoleBinding(node: AstNode): boolean {
  for (const statement of getAstArrayProperty(node, 'body')) {
    if (hasDeclarationConsoleBinding(statement, true)) return true;
  }
  return hasHoistedVarConsoleBinding(node);
}

function hasFunctionConsoleBinding(node: AstNode): boolean {
  if (hasConsoleBindingPattern(node.id)) return true;
  for (const param of getAstArrayProperty(node, 'params')) {
    if (hasConsoleBindingPattern(param)) return true;
  }
  return false;
}

function hasBlockConsoleBinding(node: AstNode, includeVar: boolean): boolean {
  for (const statement of getAstArrayProperty(node, 'body')) {
    if (hasDeclarationConsoleBinding(statement, includeVar)) return true;
  }
  return false;
}

function hasSwitchConsoleBinding(node: AstNode): boolean {
  for (const switchCase of getAstArrayProperty(node, 'cases')) {
    for (const statement of getAstArrayProperty(switchCase, 'consequent')) {
      if (hasDeclarationConsoleBinding(statement, false)) return true;
    }
  }
  return false;
}

function getSwitchScopeStart(node: AstNode): number {
  for (const switchCase of getAstArrayProperty(node, 'cases')) {
    const start = getSwitchCaseScopeStart(switchCase);
    if (start < switchCase.end) return start;
  }
  return node.end;
}

function hasSwitchCaseConsoleBinding(node: AstNode): boolean {
  for (const statement of getAstArrayProperty(node, 'consequent')) {
    if (hasDeclarationConsoleBinding(statement, false)) return true;
  }
  return false;
}

function getSwitchCaseScopeStart(node: AstNode): number {
  const test = getAstNodeProperty(node, 'test');
  if (test) return test.start;
  return getAstArrayProperty(node, 'consequent')[0]?.start ?? node.end;
}

function hasLoopConsoleBinding(node: AstNode): boolean {
  const declaration = getAstNodeProperty(node, node.type === 'ForStatement' ? 'init' : 'left');
  return !!declaration && declaration.type === 'VariableDeclaration' && declaration.kind !== 'var' && hasVariableDeclarationConsoleBinding(declaration);
}

function hasHoistedVarConsoleBinding(root: AstNode | undefined): boolean {
  if (!root) return false;

  for (const child of getAstNodeChildren(root)) {
    if (child !== root && (isConsoleFunctionScopeNode(child) || child.type === 'StaticBlock' || child.type === 'TSModuleBlock')) {
      continue;
    }
    if (
      child.type === 'VariableDeclaration' &&
      child.kind === 'var' &&
      hasVariableDeclarationConsoleBinding(child)
    ) {
      return true;
    }
    if (hasHoistedVarConsoleBinding(child)) return true;
  }
  return false;
}

function hasImportConsoleBinding(node: AstNode): boolean {
  if (node.importKind === 'type') return false;
  return getAstArrayProperty(node, 'specifiers').some(
    (specifier) => specifier.importKind !== 'type' && hasConsoleBindingPattern(specifier.local)
  );
}

function hasDeclarationConsoleBinding(node: AstNode, includeVar: boolean): boolean {
  const declaration = getExportDeclaration(node) ?? node;
  if (declaration.declare === true) return false;
  if (declaration.type === 'ImportDeclaration') return hasImportConsoleBinding(declaration);
  if (declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration') {
    return hasConsoleBindingPattern(declaration.id);
  }
  if (declaration.type === 'TSImportEqualsDeclaration') {
    return declaration.importKind !== 'type' && hasConsoleBindingPattern(declaration.id);
  }
  if (declaration.type === 'TSEnumDeclaration' || declaration.type === 'TSModuleDeclaration') {
    return hasLeftmostModuleIdConsoleBinding(getAstNodeProperty(declaration, 'id'));
  }
  return (
    declaration.type === 'VariableDeclaration' &&
    (includeVar || declaration.kind !== 'var') &&
    hasVariableDeclarationConsoleBinding(declaration)
  );
}

function hasNamespaceConsoleBinding(node: AstNode | undefined): boolean {
  return node?.type === 'TSModuleDeclaration' && node.declare !== true && hasModuleIdConsoleBinding(getAstNodeProperty(node, 'id'));
}

function hasLeftmostModuleIdConsoleBinding(id: AstNode | undefined): boolean {
  if (!id) return false;
  if (id.type === 'Identifier') return id.name === 'console';
  return id.type === 'TSQualifiedName' && hasLeftmostModuleIdConsoleBinding(getAstNodeProperty(id, 'left'));
}

function hasModuleIdConsoleBinding(id: AstNode | undefined): boolean {
  if (!id) return false;
  if (id.type === 'Identifier') return id.name === 'console';
  return (
    id.type === 'TSQualifiedName' &&
    (hasModuleIdConsoleBinding(getAstNodeProperty(id, 'left')) || hasModuleIdConsoleBinding(getAstNodeProperty(id, 'right')))
  );
}

function hasVariableDeclarationConsoleBinding(node: AstNode): boolean {
  return getAstArrayProperty(node, 'declarations').some((declaration) =>
    hasConsoleBindingPattern(getAstNodeProperty(declaration, 'id'))
  );
}

function hasConsoleBindingPattern(value: unknown): boolean {
  if (!isAstNode(value)) return false;

  if (value.type === 'Identifier' && value.name === 'console') return true;
  if (value.type === 'AssignmentPattern' || value.type === 'RestElement') {
    return hasConsoleBindingPattern(value.left ?? value.argument);
  }
  if (value.type === 'TSParameterProperty') {
    return hasConsoleBindingPattern(value.parameter);
  }
  if (value.type === 'TSQualifiedName') {
    return hasConsoleBindingPattern(value.left);
  }
  if (value.type === 'ArrayPattern') {
    return getAstArrayProperty(value, 'elements').some((element) => hasConsoleBindingPattern(element));
  }
  if (value.type === 'ObjectPattern') {
    return getAstArrayProperty(value, 'properties').some((property) =>
      hasConsoleBindingPattern(property.value ?? property.argument)
    );
  }
  return false;
}

function isConsoleFunctionScopeNode(node: AstNode): boolean {
  return node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression';
}

function isConsoleShadowed(scopes: ConsoleScope[], node: AstNode): boolean {
  return scopes.some((scope) => scope.shadowsConsole && scope.start <= node.start && node.end <= scope.end);
}

function collectConsoleCallReplacement(
  node: AstNode,
  ancestors: AstNode[],
  replacements: ConsoleReplacement[],
  excludedMethods: Set<string>
): void {
  const parent = ancestors.at(-1);
  const callee = getAstNodeProperty(node, 'callee');
  if (node.optional === true) return;
  if (!callee || !isIncludedConsoleMember(callee, excludedMethods)) {
    if (callee && isIncludedConsoleBindMember(callee, excludedMethods)) {
      replacements.push({ kind: 'replace', start: node.start, end: node.end, value: getNoopFunctionReplacement(node, ancestors) });
    }
    return;
  }

  if (parent?.type === 'ExpressionStatement') {
    replacements.push({ kind: 'replace', start: parent.start, end: parent.end, value: ';' });
  } else {
    replacements.push({ kind: 'replace', start: node.start, end: node.end, value: getUndefinedExpressionReplacement(node, ancestors) });
  }
}

function collectConsoleMemberReplacement(
  node: AstNode,
  ancestors: AstNode[],
  replacements: ConsoleReplacement[],
  excludedMethods: Set<string>
): void {
  const parent = ancestors.at(-1);
  const grandparent = ancestors.at(-2);
  if (!isIncludedConsoleMember(node, excludedMethods) || parent?.type === 'MemberExpression') return;
  if (parent?.type === 'CallExpression' && parent.callee === node && parent.optional !== true) return;
  if (isConsoleAssignmentTarget(node, parent, grandparent)) return;

  if (parent?.type === 'AssignmentExpression' && parent.left === node) {
    const right = getAstNodeProperty(parent, 'right');
    if (right) {
      replacements.push({ kind: 'replace', start: right.start, end: right.end, value: getNoopFunctionReplacement(right, ancestors) });
    }
    return;
  }

  replacements.push({ kind: 'replace', start: node.start, end: node.end, value: getNoopFunctionReplacement(node, ancestors) });
}

function getUndefinedExpressionReplacement(node: AstNode, ancestors: AstNode[]): string {
  return needsLeadingStatementSemicolon(node, ancestors) ? `;${undefinedExpression}` : undefinedExpression;
}

function getNoopFunctionReplacement(node: AstNode, ancestors: AstNode[]): string {
  return needsLeadingStatementSemicolon(node, ancestors) ? `;${noopFunctionExpression}` : noopFunctionExpression;
}

function needsLeadingStatementSemicolon(node: AstNode, ancestors: AstNode[]): boolean {
  const statementIndex = ancestors.findLastIndex((ancestor) => ancestor.type === 'ExpressionStatement');
  if (statementIndex < 0) return false;
  const statement = ancestors[statementIndex];
  if (!statement) return false;
  const statementParent = ancestors[statementIndex - 1];
  return statement.start === node.start && isStatementListNode(statementParent);
}

function isStatementListNode(node: AstNode | undefined): boolean {
  return (
    node?.type === 'Program' ||
    node?.type === 'BlockStatement' ||
    node?.type === 'StaticBlock' ||
    node?.type === 'TSModuleBlock' ||
    node?.type === 'SwitchCase'
  );
}

function isConsoleAssignmentTarget(
  node: AstNode,
  parent: AstNode | undefined,
  grandparent: AstNode | undefined
): boolean {
  if (parent?.type === 'UpdateExpression' && parent.argument === node) return true;
  if ((parent?.type === 'ForInStatement' || parent?.type === 'ForOfStatement') && parent.left === node) return true;
  if (parent?.type === 'ArrayPattern') return true;
  if (parent?.type === 'AssignmentPattern' && parent.left === node) return true;
  return parent?.type === 'Property' && parent.value === node && grandparent?.type === 'ObjectPattern';
}

function isIncludedConsoleMember(node: AstNode, excludedMethods: Set<string>): boolean {
  if (node.type !== 'MemberExpression') return false;

  const object = getAstNodeProperty(node, 'object');
  const property = getAstNodeProperty(node, 'property');
  if (node.optional === true) return false;
  if (!object || !property || isExcludedConsoleProperty(node, property, excludedMethods)) return false;
  if (isGlobalConsoleIdentifier(object)) return true;

  return (
    object.type === 'MemberExpression' &&
    isGlobalConsoleIdentifier(getAstNodeProperty(object, 'object')) &&
    // Matches babel-plugin-transform-remove-console: call/apply exclusions are checked on the outer property only.
    node.computed !== true &&
    property.type === 'Identifier' &&
    (property.name === 'call' || property.name === 'apply')
  );
}

function isIncludedConsoleBindMember(node: AstNode, excludedMethods: Set<string>): boolean {
  if (node.type !== 'MemberExpression') return false;

  const object = getAstNodeProperty(node, 'object');
  const property = getAstNodeProperty(node, 'property');
  if (!object || !property || object.type !== 'MemberExpression') return false;
  if (node.computed === true || property.type !== 'Identifier' || property.name !== 'bind') return false;
  if (!isGlobalConsoleIdentifier(getAstNodeProperty(object, 'object'))) return false;
  const consoleMethod = getAstNodeProperty(object, 'property');
  return !!consoleMethod && !isExcludedConsoleProperty(object, consoleMethod, excludedMethods);
}

function isExcludedConsoleProperty(
  memberExpression: AstNode,
  property: AstNode,
  excludedMethods: Set<string>
): boolean {
  // The restored behavior matches babel-plugin-transform-remove-console, whose exclusions only apply to identifier properties.
  return memberExpression.computed !== true && property.type === 'Identifier' && excludedMethods.has(property.name as string);
}

function isGlobalConsoleIdentifier(node: AstNode | undefined): boolean {
  return node?.type === 'Identifier' && node.name === 'console';
}

function selectConsoleReplacements(replacements: ConsoleReplacement[]): ConsoleReplacement[] {
  const selected: ConsoleReplacement[] = [];
  for (const replacement of replacements.toSorted((a, b) => a.start - b.start || b.end - a.end)) {
    if (selected.some((item) => item.start <= replacement.start && replacement.end <= item.end)) continue;
    selected.push(replacement);
  }
  return selected.toSorted((a, b) => b.start - a.start);
}

function getExportDeclaration(node: AstNode): AstNode | undefined {
  if (node.type !== 'ExportNamedDeclaration' && node.type !== 'ExportDefaultDeclaration') return undefined;
  return getAstNodeProperty(node, 'declaration');
}
