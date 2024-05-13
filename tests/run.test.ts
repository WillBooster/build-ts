import { spawnAsync } from '@willbooster/shared-lib-node';
import { describe, expect, it } from 'vitest';

describe(
  'run env.ts',
  () => {
    it.concurrent.each([
      ['yarn start-prod run test-fixtures/env.ts --no-auto-cascade-env', '0'],
      ['yarn start-prod run test-fixtures/env.ts', '1'],
      ['yarn start-prod run test-fixtures/env.ts --env .env', '1'],
      ['yarn start-prod run test-fixtures/env.ts --cascade-env ""', '1'],
      ['yarn start-prod run test-fixtures/env.ts --cascade-node-env', '1'],
      ['yarn start-prod run --cascade-env="" test-fixtures/env.ts', '1'],
      ['yarn start-prod run --cascade-node-env test-fixtures/env.ts', '1'],
      ['yarn start-prod --cascade-env="" run test-fixtures/env.ts', '1'],
      ['yarn start-prod --cascade-node-env run test-fixtures/env.ts', '1'],
      // Options with a non-empty argument must be after positional arguments.
      // ['yarn start-prod run --env .env test-fixtures/env.ts', '1'],
      // ['yarn start-prod run --env=.env test-fixtures/env.ts', '1'],
      // ['yarn start-prod run --cascade-env "" test-fixtures/env.ts', '1'],
      // ['yarn start-prod --env .env run test-fixtures/env.ts', '1'],
      // ['yarn start-prod --env=.env run test-fixtures/env.ts', '1'],
      // ['yarn start-prod --cascade-env "" run test-fixtures/env.ts', '1'],
    ])('%s', async (commandWithArgs, expectedStdout) => {
      const [command, ...args] = commandWithArgs.split(' ');
      const execRet = await spawnAsync(command, args);
      expect(execRet.stdout.trim().split('\n').at(-1)?.trim()).toBe(expectedStdout);
      expect(execRet.status).toBe(0);
    });
  },
  { timeout: 60_000 }
);

describe(
  'run hello.(c|m)ts',
  () => {
    it.concurrent.each([
      ['yarn start-prod run test-fixtures/hello.cts'],
      ['yarn start-prod run test-fixtures/hello.mts'],
    ])('%s', async (commandWithArgs) => {
      const [command, ...args] = commandWithArgs.split(' ');
      const execRet = await spawnAsync(command, args);
      expect(execRet.stdout.trim().split('\n').at(-1)?.trim()).toBe('hello');
      expect(execRet.status).toBe(0);
    });
  },
  { timeout: 60_000 }
);
