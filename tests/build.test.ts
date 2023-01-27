import { spawnSync } from 'node:child_process';

import { describe, it } from 'vitest';

describe('build', () => {
  it('app-node', async () => {
    spawnSync('yarn', ['start', 'app', 'test-fixtures/app-node'], { stdio: 'inherit' });
    spawnSync('node', ['dist/index.cjs'], { cwd: 'test-fixtures/app-node', stdio: 'inherit' });
  });
});
