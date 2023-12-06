'use client';
import chunk from 'lodash.chunk';

export function ClientComponent() {
  return <div>{JSON.stringify(chunk(['a', 'b', 'c', 'd'], 2))}</div>;
}
