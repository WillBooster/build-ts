'use client';
import chunk from 'lodash.chunk';

export function Component() {
  return <div>{JSON.stringify(chunk(['a', 'b', 'c', 'd'], 2))}</div>;
}
