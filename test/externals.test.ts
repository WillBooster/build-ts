import path from 'node:path';

import type { PackageJson } from 'type-fest';
import { describe, expect, it } from 'vitest';

import type { builder } from '../src/commands/build/builder.js';
import { createExternalMatcher } from '../src/commands/build/externals.js';
import type { ArgumentsType } from '../src/types.js';

describe('createExternalMatcher', () => {
  const packageJson: PackageJson = {
    dependencies: { '@scope/pkg': '1.0.0', lodash: '^4.0.0' },
    peerDependencies: { react: '^19.0.0' },
  };
  const createMatcher = (argv: Partial<ArgumentsType<typeof builder>>): ((id: string) => boolean) =>
    createExternalMatcher(
      argv as ArgumentsType<typeof builder>,
      'lib',
      packageJson,
      undefined,
      path.resolve('test/fixtures/lib')
    );

  it('externalizes dependencies and their subpaths', () => {
    const matcher = createMatcher({ external: ['extra-pkg'] });
    expect(matcher('lodash')).toBe(true);
    expect(matcher('lodash/chunk')).toBe(true);
    expect(matcher('@scope/pkg')).toBe(true);
    expect(matcher('@scope/pkg/sub/file.js')).toBe(true);
    expect(matcher('react')).toBe(true);
    expect(matcher('extra-pkg')).toBe(true);
  });

  it('does not externalize packages merely sharing a name prefix', () => {
    const matcher = createMatcher({});
    expect(matcher('lodash-es')).toBe(false);
    expect(matcher('@scope/pkg2')).toBe(false);
    expect(matcher('./lodash')).toBe(false);
  });

  it('externalizes Node.js builtins including subpaths', () => {
    const matcher = createMatcher({});
    expect(matcher('node:fs')).toBe(true);
    expect(matcher('fs')).toBe(true);
    expect(matcher('fs/promises')).toBe(true);
  });

  it('bundles same-namespace dependencies only for apps', () => {
    const scopedPackageJson: PackageJson = {
      name: '@scope/app',
      dependencies: { '@scope-private/pkg': '1.0.0', '@scope/pkg': '1.0.0' },
    };
    const createFor = (targetDetail: 'app-node' | 'lib'): ((id: string) => boolean) =>
      createExternalMatcher(
        {} as ArgumentsType<typeof builder>,
        targetDetail,
        scopedPackageJson,
        'scope',
        path.resolve('test/fixtures/lib')
      );
    expect(createFor('app-node')('@scope/pkg')).toBe(false);
    expect(createFor('lib')('@scope/pkg')).toBe(true);
    // A package merely sharing the scope prefix must stay external.
    expect(createFor('app-node')('@scope-private/pkg')).toBe(true);
  });
});
