'use client';
import chunk from 'lodash.chunk';

export function Component() {
  console.info(String.raw`\update`); // cf. https://github.com/rollup/rollup/issues/6175
  return <div>{JSON.stringify(chunk(['a', 'b', 'c', 'd'], 2))}</div>;
}
