import type {
  NormalizedOutputOptions,
  PluginContext,
  RenderedChunk,
  RenderedModule,
  RollupLog,
  TransformPluginContext,
  TransformResult,
} from 'rollup';
import { describe, expect, it } from 'vitest';

import { preserveDirectivesPlugin } from '../src/commands/build/preserveDirectivesPlugin.js';

describe('preserveDirectivesPlugin', () => {
  describe('transform', () => {
    it('extracts single directive', () => {
      const plugin = preserveDirectivesPlugin();
      const code = '"use client";\n\nconst foo = 1;';
      const result = callTransform(plugin, code, 'test.ts');
      expect(result).toBeNull();
    });

    it('extracts multiple directives', () => {
      const plugin = preserveDirectivesPlugin();
      const code = '"use client";\n"use strict";\n\nconst foo = 1;';
      const result = callTransform(plugin, code, 'test.ts');
      expect(result).toBeNull();
    });

    it('extracts directives with single quotes', () => {
      const plugin = preserveDirectivesPlugin();
      const code = "'use client';\n\nconst foo = 1;";
      const result = callTransform(plugin, code, 'test.ts');
      expect(result).toBeNull();
    });

    it('returns null for files without directives', () => {
      const plugin = preserveDirectivesPlugin();
      const code = 'const foo = 1;';
      const result = callTransform(plugin, code, 'test.ts');
      expect(result).toBeNull();
    });

    it('skips CSS files by default', () => {
      const plugin = preserveDirectivesPlugin();
      const code = '"use client";\n\nconst foo = 1;';
      const result = callTransform(plugin, code, 'test.css');
      expect(result).toBeNull();
    });

    it('handles BOM at the start of file', () => {
      const plugin = preserveDirectivesPlugin();
      const code = '\uFEFF"use client";\n\nconst foo = 1;';
      const result = callTransform(plugin, code, 'test.ts');
      expect(result).toBeNull();
    });

    it('handles directives with semicolons', () => {
      const plugin = preserveDirectivesPlugin();
      const code = '"use client";\n"use strict";\n\nconst foo = 1;';
      const result = callTransform(plugin, code, 'test.ts');
      expect(result).toBeNull();
    });

    it('handles directives without semicolons', () => {
      const plugin = preserveDirectivesPlugin();
      const code = '"use client"\n"use strict"\n\nconst foo = 1;';
      const result = callTransform(plugin, code, 'test.ts');
      expect(result).toBeNull();
    });

    it('stops at first non-directive', () => {
      const plugin = preserveDirectivesPlugin();
      const code = '"use client";\nconst foo = 1;\n"not a directive";';
      const result = callTransform(plugin, code, 'test.ts');
      expect(result).toBeNull();
    });

    it('handles escaped quotes in directives', () => {
      const plugin = preserveDirectivesPlugin();
      const code = '"use \\"client\\"";\n\nconst foo = 1;';
      const result = callTransform(plugin, code, 'test.ts');
      expect(result).toBeNull();
    });

    it('skips single-line comments before directives', () => {
      const plugin = preserveDirectivesPlugin();
      const code = '// comment\n"use client";\n\nconst foo = 1;';
      const result = callTransform(plugin, code, 'test.ts');
      expect(result).toBeNull();
    });

    it('skips multi-line comments before directives', () => {
      const plugin = preserveDirectivesPlugin();
      const code = '/* comment */\n"use client";\n\nconst foo = 1;';
      const result = callTransform(plugin, code, 'test.ts');
      expect(result).toBeNull();
    });

    it('handles whitespace before directives', () => {
      const plugin = preserveDirectivesPlugin();
      const code = '  \n  "use client";\n\nconst foo = 1;';
      const result = callTransform(plugin, code, 'test.ts');
      expect(result).toBeNull();
    });
  });

  describe('renderChunk', () => {
    it('prepends directives even when preserveModules is false', () => {
      const plugin = preserveDirectivesPlugin();
      const { context, warnings } = createWarningCollector();

      callTransform(plugin, '"use client";\nconst foo = 1;', 'test.ts');

      const result = callRenderChunk(
        plugin,
        context,
        'const foo = 1;',
        { modules: createModulesObject(['test.ts']) },
        { preserveModules: false }
      );

      expect(result).toBeDefined();
      if (!result) throw new Error('Result should be defined');
      expect(result.code).toMatch(/^"use client";\nconst foo = 1;/);
      expect(warnings).toHaveLength(0);
    });

    it('prepends directives to chunk when preserveModules is true', () => {
      const plugin = preserveDirectivesPlugin();
      callTransform(plugin, '"use client";\nconst foo = 1;', 'test.ts');

      const result = callRenderChunk(
        plugin,
        {},
        'const foo = 1;',
        { modules: createModulesObject(['test.ts']) },
        { preserveModules: true }
      );

      expect(result).toBeDefined();
      if (!result) throw new Error('Result should be defined');
      expect(result.code).toContain('"use client";');
      expect(result.code).toMatch(/^"use client";\nconst foo = 1;/);
      expect(result.map).toBeDefined();
    });

    it('deduplicates directives from multiple modules', () => {
      const plugin = preserveDirectivesPlugin();
      callTransform(plugin, '"use client";\nconst foo = 1;', 'test1.ts');
      callTransform(plugin, '"use client";\nconst bar = 2;', 'test2.ts');

      const result = callRenderChunk(
        plugin,
        {},
        'const foo = 1;\nconst bar = 2;',
        { modules: createModulesObject(['test1.ts', 'test2.ts']) },
        { preserveModules: true }
      );

      expect(result).toBeDefined();
      if (!result) throw new Error('Result should be defined');
      const lines = result.code.split('\n');
      const directiveLines = lines.filter((line: string) => line === '"use client";');
      expect(directiveLines).toHaveLength(1);
    });

    it('combines different directives from multiple modules', () => {
      const plugin = preserveDirectivesPlugin();
      callTransform(plugin, '"use client";\nconst foo = 1;', 'test1.ts');
      callTransform(plugin, '"use server";\nconst bar = 2;', 'test2.ts');

      const result = callRenderChunk(
        plugin,
        {},
        'const foo = 1;\nconst bar = 2;',
        { modules: createModulesObject(['test1.ts', 'test2.ts']) },
        { preserveModules: true }
      );

      expect(result).toBeDefined();
      if (!result) throw new Error('Result should be defined');
      expect(result.code).toContain('"use client";');
      expect(result.code).toContain('"use server";');
    });

    it('returns null when no modules have directives', () => {
      const plugin = preserveDirectivesPlugin();
      const result = callRenderChunk(
        plugin,
        {},
        'const foo = 1;',
        { modules: createModulesObject(['test.ts']) },
        { preserveModules: true }
      );

      expect(result).toBeNull();
    });

    it('handles empty modules object', () => {
      const plugin = preserveDirectivesPlugin();
      const result = callRenderChunk(plugin, {}, 'const foo = 1;', { modules: {} }, { preserveModules: true });

      expect(result).toBeNull();
    });

    it('handles undefined modules', () => {
      const plugin = preserveDirectivesPlugin();
      const result = callRenderChunk(plugin, {}, 'const foo = 1;', {}, { preserveModules: true });

      expect(result).toBeNull();
    });
  });

  describe('options', () => {
    it('respects include option', () => {
      const plugin = preserveDirectivesPlugin({ include: '**/*.tsx' });
      const code = '"use client";\nconst foo = 1;';

      const tsResult = callTransform(plugin, code, 'test.ts');
      expect(tsResult).toBeNull();

      const tsxResult = callTransform(plugin, code, 'test.tsx');
      expect(tsxResult).toBeNull();
    });

    it('respects exclude option with string', () => {
      const plugin = preserveDirectivesPlugin({ exclude: '**/*.spec.ts' });
      const code = '"use client";\nconst foo = 1;';

      const specResult = callTransform(plugin, code, 'test.spec.ts');
      expect(specResult).toBeNull();

      const tsResult = callTransform(plugin, code, 'test.ts');
      expect(tsResult).toBeNull();
    });

    it('respects exclude option with array', () => {
      const plugin = preserveDirectivesPlugin({ exclude: ['**/*.spec.ts', '**/*.test.ts'] });
      const code = '"use client";\nconst foo = 1;';

      const specResult = callTransform(plugin, code, 'test.spec.ts');
      expect(specResult).toBeNull();

      const testResult = callTransform(plugin, code, 'test.test.ts');
      expect(testResult).toBeNull();
    });

    it('respects exclude option with regex', () => {
      const plugin = preserveDirectivesPlugin({ exclude: /\.spec\.ts$/ });
      const code = '"use client";\nconst foo = 1;';

      const specResult = callTransform(plugin, code, 'test.spec.ts');
      expect(specResult).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('handles empty file', () => {
      const plugin = preserveDirectivesPlugin();
      const result = callTransform(plugin, '', 'test.ts');
      expect(result).toBeNull();
    });

    it('handles file with only whitespace', () => {
      const plugin = preserveDirectivesPlugin();
      const result = callTransform(plugin, '   \n\n\t  ', 'test.ts');
      expect(result).toBeNull();
    });

    it('handles file with only comments', () => {
      const plugin = preserveDirectivesPlugin();
      const result = callTransform(plugin, '// comment\n/* another comment */', 'test.ts');
      expect(result).toBeNull();
    });

    it('handles unterminated string', () => {
      const plugin = preserveDirectivesPlugin();
      const result = callTransform(plugin, '"use client', 'test.ts');
      expect(result).toBeNull();
    });

    it('handles unterminated multi-line comment', () => {
      const plugin = preserveDirectivesPlugin();
      const result = callTransform(plugin, '/* comment\n"use client";', 'test.ts');
      expect(result).toBeNull();
    });
  });
});

function callTransform(
  plugin: ReturnType<typeof preserveDirectivesPlugin>,
  code: string,
  id: string
): TransformResult | null | undefined {
  const transformFn = typeof plugin.transform === 'function' ? plugin.transform : plugin.transform?.handler;
  return transformFn?.call({} as TransformPluginContext, code, id) as TransformResult | null | undefined;
}

function callRenderChunk(
  plugin: ReturnType<typeof preserveDirectivesPlugin>,
  context: Partial<PluginContext>,
  code: string,
  chunk: Partial<RenderedChunk>,
  options: Partial<NormalizedOutputOptions>
): { code: string; map: unknown } | null | undefined {
  const renderChunkFn = typeof plugin.renderChunk === 'function' ? plugin.renderChunk : plugin.renderChunk?.handler;
  return renderChunkFn?.call(
    context as PluginContext,
    code,
    chunk as RenderedChunk,
    options as NormalizedOutputOptions,
    {
      chunks: {},
    }
  ) as { code: string; map: unknown } | null | undefined;
}

function createModulesObject(modules: string[]): Record<string, RenderedModule> {
  const obj: Record<string, RenderedModule> = {};
  for (const module of modules) {
    obj[module] = {} as RenderedModule;
  }
  return obj;
}

function createWarningCollector(): { context: Pick<PluginContext, 'warn'>; warnings: string[] } {
  const warnings: string[] = [];
  return {
    context: {
      warn: (msg: string | RollupLog | (() => string | RollupLog)) => {
        const message = typeof msg === 'function' ? msg() : msg;
        if (typeof message === 'string') {
          warnings.push(message);
        } else if (message.message) {
          warnings.push(message.message);
        } else {
          warnings.push(JSON.stringify(message));
        }
      },
    },
    warnings,
  };
}
