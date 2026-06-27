import { describe, expect, it } from 'vitest';

import { containsDecorator } from '../src/commands/build/plugin.js';

describe('build plugins', () => {
  it('detects decorator syntax without matching comment tags', () => {
    expect(containsDecorator('@logged class A {}')).toBe(true);
    expect(containsDecorator('@デコレータ class A {}')).toBe(true);
    expect(containsDecorator('@(logged) class A {}')).toBe(true);
    expect(containsDecorator('@(condition ? logged : sealed) class A {}')).toBe(true);
    expect(containsDecorator('class A { @logged method() {} }')).toBe(true);
    expect(containsDecorator('// @ts-expect-error\nconst value = 1;')).toBe(false);
    expect(containsDecorator('/**\n * @param value\n */\nfunction fn(value: string) { return value; }')).toBe(false);
    expect(containsDecorator("import value from '@scope/package';")).toBe(false);
    expect(containsDecorator('const css = `@media (min-width: 1px) {}`;')).toBe(false);
    expect(containsDecorator('const regex = /[\\/*]/;\n@logged class A {}')).toBe(true);
    expect(containsDecorator('const regex = /[//]/; class A { @logged method() {} }')).toBe(true);
    expect(containsDecorator('if (condition) /[\\/*]/.test(value);\n@logged class A {}')).toBe(true);
    expect(containsDecorator('export default /[\\/*]/;\n@logged class A {}')).toBe(true);
    expect(containsDecorator('do /[\\/*]/.test(value); while (false);\n@logged class A {}')).toBe(true);
    expect(containsDecorator('if (condition) value(); else /[\\/*]/.test(value);\n@logged class A {}')).toBe(true);
    expect(containsDecorator('const regex = new /[\\/*]/;\n@logged class A {}')).toBe(true);
    expect(containsDecorator('const x = (1 + 2) / 3; @logged class A {}')).toBe(true);
    expect(containsDecorator('const value = count++ / total; @logged class A {}')).toBe(true);
  });
});
