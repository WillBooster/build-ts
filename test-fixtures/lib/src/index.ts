import assert from 'node:assert';

import chunk from 'lodash/chunk';

assert(JSON.stringify(chunk(['a', 'b', 'c', 'd'], 2)) === '[["a","b"],["c","d"]]');

export { add } from './module';
