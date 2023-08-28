import assert from 'node:assert';

import chunk from 'lodash/chunk';
import compact from 'lodash/compact';
import concat from 'lodash/concat';

assert(JSON.stringify(chunk(['a', 'b', 'c', 'd'], 2)) === '[["a","b"],["c","d"]]');
assert(JSON.stringify(compact([0, 1, false, 2, '', 3])) === '[1,2,3]');
assert(JSON.stringify(concat([1], 2, [3], [4])) === '[1,2,3,4]');

// cf. https://babeljs.io/blog/2023/05/26/7.22.0#decorators-updates-15570
let MyDecs = {
  dec() {
    console.log(this);
  }
};

@MyDecs.dec class A {}
