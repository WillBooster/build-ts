import fs from 'node:fs';
import path from 'node:path';

import type { InputOptions } from '@babel/core';
import MagicString from 'magic-string';
import type { OutputOptions, Plugin, RolldownPluginOption, SourceMapInput } from 'rolldown';

import type { ArgumentsType } from '../../types.js';
import { getBuildTsRootPath } from '../../utils.js';

import type { builder } from './builder.js';
import { bundleBuiltinsPlugin } from './bundleBuiltinsPlugin.js';
import { containsDecorator } from './decoratorDetection.js';
import { getConsoleRemovalExcludedMethods, removeConsolePlugin } from './removeConsolePlugin.js';
import { isTransformTargetFile } from './transformUtils.js';

export function setupPlugins(
  argv: ArgumentsType<typeof builder>,
  outputOptionsList: OutputOptions[],
  packageDirPath: string
): RolldownPluginOption[] {
  const plugins: RolldownPluginOption[] = [
    bundleBuiltinsPlugin(argv, packageDirPath),
    keepImportPlugin(argv.keepImport?.map((item) => item.toString()) ?? []),
  ];
  const excludedConsoleMethods = getConsoleRemovalExcludedMethods();
  if (excludedConsoleMethods) {
    plugins.push(removeConsolePlugin(excludedConsoleMethods));
  }
  if (argv['core-js'] || argv['core-js-proposals']) {
    plugins.push(babelCoreJsPlugin());
    if (!outputOptionsList.some((opts) => opts.preserveModules)) {
      plugins.push(commonJsRuntimePreludePlugin());
    }
  } else {
    plugins.push(babelDecoratorsPlugin());
  }
  plugins.push(textPlugin());
  return plugins;
}

function keepImportPlugin(moduleNames: string[]): Plugin {
  return {
    name: 'keep-import',
    resolveDynamicImport(source) {
      return moduleNames.includes(source) ? false : undefined;
    },
  };
}

function babelCoreJsPlugin(): Plugin {
  return babelPlugin('babel-core-js', () => true);
}

function babelDecoratorsPlugin(): Plugin {
  return babelPlugin('babel-decorators', containsDecorator);
}

function babelPlugin(name: string, shouldTransform: (code: string, id: string) => boolean): Plugin {
  const babelConfigPath = path.join(getBuildTsRootPath(), 'babel.config.mjs');
  return {
    name,
    async transform(code, id) {
      if (!isTransformTargetFile(id) || !shouldTransform(code, id)) {
        return undefined;
      }

      const { transformAsync } = await import('@babel/core');
      const options: InputOptions = {
        caller: {
          name: 'build-ts',
          supportsDynamicImport: true,
          supportsExportNamespaceFrom: true,
          supportsStaticESM: true,
        },
        configFile: babelConfigPath,
        filename: id,
        sourceMaps: true,
      };
      const result = await transformAsync(code, options);
      if (!result?.code) return undefined;

      return {
        code: result.code,
        map: result.map as SourceMapInput,
      };
    },
  };
}

function commonJsRuntimePreludePlugin(): Plugin {
  return {
    name: 'commonjs-runtime-prelude',
    renderChunk(code, _chunk, options) {
      const prelude = getCommonJsRuntimePrelude(code, options.format);
      if (!prelude) return undefined;

      const magicString = new MagicString(code);
      magicString.appendLeft(getPreludeInsertionIndex(code), `${prelude}\n`);
      return {
        code: magicString.toString(),
        map: magicString.generateMap({ hires: true }) as SourceMapInput,
      };
    },
  };
}

const commonJsRuntimePrelude = `var __create=Object.create,__defProp=Object.defineProperty,__getOwnPropDesc=Object.getOwnPropertyDescriptor,__getOwnPropNames=Object.getOwnPropertyNames,__getProtoOf=Object.getPrototypeOf,__hasOwnProp=Object.prototype.hasOwnProperty,__commonJSMin=(moduleFactory,module)=>()=>(module||(module={exports:{}},moduleFactory(module.exports,module)),module.exports),__copyProps=(to,from,except,descriptor)=>{if(from&&"object"==typeof from||"function"==typeof from)for(var key,names=__getOwnPropNames(from),index=0,length=names.length;index<length;index++)key=names[index],__hasOwnProp.call(to,key)||key===except||__defProp(to,key,{get:(key=>from[key]).bind(null,key),enumerable:!(descriptor=__getOwnPropDesc(from,key))||descriptor.enumerable});return to},__toESM=(mod,isNodeMode,target)=>(target=null!=mod?__create(__getProtoOf(mod)):{},__copyProps(!isNodeMode&&mod&&mod.__esModule?target:__defProp(target,"default",{value:mod,enumerable:!0}),mod));`;

function getCommonJsRuntimePrelude(code: string, format: string): string | undefined {
  if (!code.includes('__commonJSMin')) return undefined;

  // Rolldown 1.1.2 can emit helpers after core-js wrappers that already call them.
  // Seeding the helpers first prevents minified output from calling uninitialized aliases.
  if (isCommonJsFormat(format)) return code.includes('__toESM') ? commonJsRuntimePrelude : undefined;
  return `var __commonJSMin=(moduleFactory,module)=>()=>(module||(module={exports:{}},moduleFactory(module.exports,module)),module.exports);`;
}

function isCommonJsFormat(format: string): boolean {
  return format === 'cjs' || format === 'commonjs';
}

function getPreludeInsertionIndex(code: string): number {
  let index = 0;
  if (code.startsWith('#!')) {
    const firstLineEnd = code.indexOf('\n');
    if (firstLineEnd === -1) return code.length;
    index = firstLineEnd + 1;
  }

  const directivePattern = /(?:(?:"[^"\n]*"|'[^'\n]*');?\s*)/y;
  while (true) {
    directivePattern.lastIndex = index;
    const match = directivePattern.exec(code);
    if (!match?.[0]) return index;
    index = directivePattern.lastIndex;
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
