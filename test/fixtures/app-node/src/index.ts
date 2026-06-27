import assert from 'node:assert';

import data from './data.json';
import chunk from 'lodash.chunk';
import compact from 'lodash.compact';
import concat from 'lodash.concat';
import { toASCII } from 'node:punycode';

assert(JSON.stringify(chunk(['a', 'b', 'c', 'd'], 2)) === '[["a","b"],["c","d"]]');
assert(JSON.stringify(compact([0, 1, false, 2, '', 3])) === '[1,2,3]');
assert(JSON.stringify(concat([1], 2, [3], [4])) === '[1,2,3,4]');
assert(toASCII('mañana.com') === 'xn--maana-pta.com');
assert(data.ok);
assert(process.env.A);
assert(Math.random() ? process.env.A : '0');

// cf. https://babeljs.io/blog/2023/05/26/7.22.0#decorators-updates-15570
function logged(value: unknown, context: ClassDecoratorContext) {
  console.log(value);
  assert(context.kind === 'class');
}

@logged class A {}
