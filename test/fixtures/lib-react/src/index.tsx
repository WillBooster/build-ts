'use client';
'use strict';
import chunk from 'lodash.chunk';

function sealed(value: typeof Label, _context: ClassDecoratorContext): void {
  Object.seal(value);
}

@sealed
class Label {
  render() {
    return <span>{JSON.stringify(chunk(['a', 'b', 'c', 'd'], 2))}</span>;
  }
}

export function Component() {
  console.info(String.raw`\update`);
  return <div>{new Label().render()}</div>;
}
