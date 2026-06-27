import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';

import { transformAsync } from '@babel/core';
import type { OutputOptions, Plugin, RolldownPluginOption, SourceMapInput } from 'rolldown';
import { replacePlugin } from 'rolldown/plugins';
import { minify } from 'terser';
import type { MinifyOptions, SourceMapOptions } from 'terser';
import type { PackageJson } from 'type-fest';

import { createEnvironmentVariablesDefinition } from '../../env.js';
import type { ArgumentsType, TargetDetail } from '../../types.js';
import { getBuildTsRootPath } from '../../utils.js';

import type { builder } from './builder.js';

export function createExternalMatcher(
  argv: ArgumentsType<typeof builder>,
  targetDetail: TargetDetail,
  packageJson: PackageJson,
  namespace: string | undefined
): (id: string) => boolean {
  const externalDeps = collectExternalDependencies(argv, targetDetail, packageJson, namespace);
  return (id) =>
    isNodeBuiltin(id) || externalDeps.some((dependencyName) => id === dependencyName || id.startsWith(`${dependencyName}/`));
}

export function setupPlugins(
  argv: ArgumentsType<typeof builder>,
  targetDetail: TargetDetail,
  packageJson: PackageJson,
  namespace: string | undefined,
  packageDirPath: string,
  outputOptionsList: OutputOptions[]
): RolldownPluginOption[] {
  const plugins: RolldownPluginOption[] = [
    replacePlugin(createEnvironmentVariablesDefinition(argv, packageDirPath), {
      preventAssignment: true,
    }),
    keepImportPlugin(argv.keepImport?.map((item) => item.toString()) ?? []),
  ];
  const isBabelHelpersBundled =
    targetDetail === 'app-node' ||
    targetDetail === 'functions' ||
    !collectExternalDependencies(argv, targetDetail, packageJson, namespace).includes('@babel/runtime');
  process.env.BUILDTS_USE_BABLE_RUNTIME = isBabelHelpersBundled ? '' : '1';
  plugins.push(
    babelPlugin(),
    ...(outputOptionsList.some((opts) => opts.preserveModules) ? [preserveDirectivesPlugin()] : []),
    textPlugin()
  );
  if (argv.minify && !outputOptionsList.some((opts) => opts.preserveModules)) {
    plugins.push(terserPlugin());
  }
  return plugins;
}

function collectExternalDependencies(
  argv: ArgumentsType<typeof builder>,
  targetDetail: TargetDetail,
  packageJson: PackageJson,
  namespace: string | undefined
): string[] {
  const externalDeps = [...(argv.external ?? [])].map((item) => item.toString());
  if (packageJson.dependencies?.['@prisma/client']) {
    externalDeps.push('prisma-client');
  }
  // `deps: true` did not handle imports such as `lodash.chunk/index.js`.
  externalDeps.push(
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {})
  );
  // Add external dependencies from sibling packages
  if (fs.existsSync(path.join('..', '..', 'package.json'))) {
    const packageDirs = fs.readdirSync(path.join('..'), { withFileTypes: true });
    for (const packageDir of packageDirs) {
      if (!packageDir.isDirectory()) continue;

      const packageJsonPath = path.join('..', packageDir.name, 'package.json');
      if (!fs.existsSync(packageJsonPath)) continue;

      const otherPackageJson: PackageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      if (packageJson.dependencies?.[otherPackageJson.name ?? '']) {
        externalDeps.push(
          ...Object.keys(otherPackageJson.dependencies ?? {}),
          ...Object.keys(otherPackageJson.peerDependencies ?? {}),
          ...Object.keys(otherPackageJson.optionalDependencies ?? {})
        );
      }
    }
  }

  if (shouldBundleSameNamespaceDependencies(targetDetail) && namespace) {
    return externalDeps.filter((dependencyName) => !dependencyName.match(new RegExp(`^@?${namespace}(?:/.+)?`)));
  }
  return externalDeps;
}

function shouldBundleSameNamespaceDependencies(targetDetail: TargetDetail): boolean {
  return targetDetail === 'app-node' || targetDetail === 'functions';
}

function isNodeBuiltin(id: string): boolean {
  return id.startsWith('node:') || builtinModules.includes(id);
}

function keepImportPlugin(moduleNames: string[]): Plugin {
  return {
    name: 'keep-import',
    resolveDynamicImport(source) {
      return moduleNames.includes(source) ? false : undefined;
    },
  };
}

function babelPlugin(): Plugin {
  const extensions = ['.cjs', '.mjs', '.js', '.jsx', '.json', '.cts', '.mts', '.ts', '.tsx'];
  const babelConfigPath = path.join(getBuildTsRootPath(), 'babel.config.mjs');
  return {
    name: 'babel',
    async transform(code, id) {
      if (!extensions.some((extension) => id.endsWith(extension)) || id.includes('/node_modules/')) return undefined;

      const result = await transformAsync(code, {
        caller: {
          name: 'build-ts',
          supportsDynamicImport: true,
          supportsExportNamespaceFrom: true,
          supportsStaticESM: true,
        },
        configFile: babelConfigPath,
        filename: id,
        sourceMaps: true,
      });
      if (!result?.code) return undefined;

      return {
        code: result.code,
        map: result.map as SourceMapInput,
      };
    },
  };
}

function preserveDirectivesPlugin(): Plugin {
  const directiveByModuleId = new Map<string, string[]>();
  return {
    name: 'preserve-directives',
    transform(code, id) {
      const directives = getDirectives(code);
      if (directives.length === 0) return undefined;

      directiveByModuleId.set(id, directives);
      return undefined;
    },
    renderChunk(code, chunk, options) {
      if (!options.preserveModules) return undefined;

      const directives = Object.keys(chunk.modules).flatMap((moduleId) => directiveByModuleId.get(moduleId) ?? []);
      if (directives.length === 0) return undefined;

      const directiveText = directives.map((directive) => JSON.stringify(directive)).join(';\n');
      return {
        code: `${directiveText};\n${code}`,
        map: { mappings: '' },
      };
    },
  };
}

function getDirectives(code: string): string[] {
  const directives: string[] = [];
  const directivePattern = /^\s*(['"])([^'"]+)\1\s*;?/y;
  let offset = 0;
  while (true) {
    directivePattern.lastIndex = offset;
    const match = directivePattern.exec(code);
    if (!match) return directives;

    directives.push(match[2] ?? '');
    offset = directivePattern.lastIndex;
  }
}

function textPlugin(): Plugin {
  return {
    name: 'text',
    async load(id) {
      if (!id.endsWith('.csv') && !id.endsWith('.txt')) return undefined;

      const content = await fs.promises.readFile(id, 'utf8');
      return {
        code: `export default ${JSON.stringify(content)};`,
        moduleType: 'js',
      };
    },
  };
}

function terserPlugin(): Plugin {
  return {
    name: 'terser',
    async renderChunk(code, _chunk, options) {
      const sourceMapOptions: SourceMapOptions | undefined = options.sourcemap
        ? { asObject: true }
        : undefined;
      const result = await minify(code, {
        compress: { directives: false },
        ecma: 2022,
        format: { comments: false },
        module: options.format === 'es',
        sourceMap: sourceMapOptions,
      } satisfies MinifyOptions);
      if (!result.code) return undefined;

      return {
        code: result.code,
        map: result.map as SourceMapInput,
      };
    },
  };
}
