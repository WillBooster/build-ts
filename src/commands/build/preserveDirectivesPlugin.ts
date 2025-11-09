import { createFilter, type FilterPattern } from '@rollup/pluginutils';
import MagicString from 'magic-string';
import type { Plugin } from 'rollup';

type PreserveDirectivesOptions = {
  include?: FilterPattern;
  exclude?: FilterPattern;
};

const DEFAULT_EXCLUDE = ['**/*.css'];

const WHITESPACE_CODES = new Set([
  0x09, // \t
  0x0a, // \n
  0x0b, // \v
  0x0c, // \f
  0x0d, // \r
  0x20, // space
  0xa0, // non-breaking space
  0x1680, // ogham space mark
  0x2000, // en quad
  0x2001, // em quad
  0x2002, // en space
  0x2003, // em space
  0x2004, // three-per-em space
  0x2005, // four-per-em space
  0x2006, // six-per-em space
  0x2007, // figure space
  0x2008, // punctuation space
  0x2009, // thin space
  0x200a, // hair space
  0x2028, // line separator
  0x2029, // paragraph separator
  0x202f, // narrow no-break space
  0x205f, // medium mathematical space
  0x3000, // ideographic space
  0xfeff, // zero width no-break space (BOM)
]);

const LINE_TERMINATORS = new Set([
  0x0a, // \n
  0x0d, // \r
  0x2028, // line separator
  0x2029, // paragraph separator
]);

export function preserveDirectivesPlugin(options: PreserveDirectivesOptions = {}): Plugin {
  const { include, exclude } = options;
  const filter = createFilter(include, exclude ? [DEFAULT_EXCLUDE, exclude].flat() : DEFAULT_EXCLUDE);
  const moduleDirectives = new Map<string, string[]>();

  return {
    name: 'build-ts-preserve-directives',
    transform(code, id) {
      if (!filter(id)) return null;

      const directives = extractDirectives(code);
      if (directives.length === 0) return null;

      moduleDirectives.set(id, directives);
      return null;
    },
    renderChunk: {
      order: 'post',
      handler(code, chunk) {
        const directives = new Set<string>();
        for (const moduleId in chunk.modules ?? {}) {
          const moduleDirective = moduleDirectives.get(moduleId);
          if (moduleDirective) {
            moduleDirective.forEach((directive) => directives.add(directive));
          }
        }

        if (directives.size === 0) return null;

        const directiveBanner = Array.from(directives)
          .map((directive) => `"${directive}";`)
          .join('\n');
        const magicString = new MagicString(code);
        magicString.prepend(directiveBanner + '\n');

        return {
          code: magicString.toString(),
          map: magicString.generateMap({ includeContent: true }),
        };
      },
    },
  };
}

// Rollup's default parser does not understand TypeScript syntax, so we scan the
// directive prolog manually without relying on AST parsing.
function extractDirectives(code: string): string[] {
  const directives: string[] = [];
  let index = 0;
  // Skip BOM if present (handled separately from whitespace scanning)
  if (code.charCodeAt(0) === 0xfeff) {
    index += 1;
  }

  while (index < code.length) {
    index = skipWhitespaceAndComments(code, index);
    if (index >= code.length) break;
    const char = code[index];
    if (char !== '"' && char !== "'") break;

    const literal = readQuotedString(code, index, char);
    if (!literal) break;

    directives.push(literal.value);
    index = skipWhitespaceAndComments(code, literal.nextIndex);
    if (code[index] === ';') {
      index += 1;
    }
  }

  return directives;
}

function skipWhitespaceAndComments(code: string, startIndex: number): number {
  let index = startIndex;
  while (index < code.length) {
    const char = code[index];
    if (char === '/' && index + 1 < code.length) {
      const next = code[index + 1];
      if (next === '/') {
        index += 2;
        while (index < code.length && !LINE_TERMINATORS.has(code.charCodeAt(index))) {
          index += 1;
        }
        continue;
      }
      if (next === '*') {
        index += 2;
        while (index + 1 < code.length && !(code[index] === '*' && code[index + 1] === '/')) {
          index += 1;
        }
        index += 2;
        continue;
      }
    }

    if (WHITESPACE_CODES.has(code.charCodeAt(index))) {
      index += 1;
      continue;
    }
    break;
  }
  return index;
}

function readQuotedString(
  code: string,
  startIndex: number,
  quote: string
): { value: string; nextIndex: number } | null {
  let index = startIndex + 1;
  let value = '';
  while (index < code.length) {
    const char = code[index];
    if (char === '\\') {
      index += 1;
      if (index >= code.length) return null;
      value += code[index];
      index += 1;
      continue;
    }
    if (char === quote) {
      return { value, nextIndex: index + 1 };
    }
    value += char;
    index += 1;
  }
  return null;
}
