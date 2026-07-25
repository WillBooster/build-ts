import fs from 'node:fs';

import { spawnAsync } from '@willbooster/shared-lib-node';
import { beforeAll, describe, expect, it } from 'vitest';

describe('run env.ts', { timeout: 60_000 }, () => {
  it.each([
    ['bun run start-prod run test/fixtures/env.ts --no-auto-cascade-env', '1'],
    ['bun run start-prod run test/fixtures/env.ts', '1'],
    ['bun run start-prod run test/fixtures/env.ts --env .env', '1'],
    ['bun run start-prod run test/fixtures/env.ts --cascade-env ""', '1'],
    ['bun run start-prod run test/fixtures/env.ts --cascade-node-env', '1'],
    ['bun run start-prod run --cascade-env="" test/fixtures/env.ts', '1'],
    ['bun run start-prod run --cascade-node-env test/fixtures/env.ts', '1'],
    ['bun run start-prod --cascade-env="" run test/fixtures/env.ts', '1'],
    ['bun run start-prod --cascade-node-env run test/fixtures/env.ts', '1'],
    // Options with a non-empty argument must be after positional arguments.
    // ['bun run start-prod run --env .env test/fixtures/env.ts', '1'],
    // ['bun run start-prod run --env=.env test/fixtures/env.ts', '1'],
    // ['bun run start-prod run --cascade-env "" test/fixtures/env.ts', '1'],
    // ['bun run start-prod --env .env run test/fixtures/env.ts', '1'],
    // ['bun run start-prod --env=.env run test/fixtures/env.ts', '1'],
    // ['bun run start-prod --cascade-env "" run test/fixtures/env.ts', '1'],
  ])('%s', async (commandWithArgs, expectedStdout) => {
    const [command, ...args] = commandWithArgs.split(' ') as [string, ...string[]];
    const execRet = await spawnAsync(command, args, { env: getTestEnvironment() });
    expect(execRet.stdout.trim().split('\n').at(-1)?.trim()).toBe(expectedStdout);
    expect(execRet.status).toBe(0);
  });
});

describe('run hello.(c|m)ts', { timeout: 60_000 }, () => {
  it.each([['bun run start-prod run test/fixtures/hello.cts'], ['bun run start-prod run test/fixtures/hello.mts']])(
    '%s',
    async (commandWithArgs) => {
      const [command, ...args] = commandWithArgs.split(' ') as [string, ...string[]];
      const execRet = await spawnAsync(command, args, { env: getTestEnvironment() });
      expect(execRet.stdout.trim().split('\n').at(-1)?.trim()).toBe('hello');
      expect(execRet.status).toBe(0);
    }
  );
});

describe('run with --env', { timeout: 60_000 }, () => {
  // The name must be absent from fnox.toml and the ambient environment, otherwise these tests would
  // still pass if --env stopped reading .env files at all.
  const fixtureDirPath = '.tmp/test-fixtures/run-env-file';

  beforeAll(async () => {
    await fs.promises.rm(fixtureDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(fixtureDirPath, { recursive: true });
    await fs.promises.writeFile(`${fixtureDirPath}/custom.env`, 'BUILD_TS_TEST_RUN_ENV=from-env-file\n');
    await fs.promises.writeFile(
      `${fixtureDirPath}/print.ts`,
      `process.stdout.write(process.env.BUILD_TS_TEST_RUN_ENV ?? 'missing');\n`
    );
  });

  it.each([
    [['--env', `${fixtureDirPath}/custom.env`], 'from-env-file'],
    [[], 'missing'],
  ])('%s', async (options, expectedStdout) => {
    const execRet = await spawnAsync('bun', ['run', 'start-prod', 'run', `${fixtureDirPath}/print.ts`, ...options], {
      env: getTestEnvironment(),
    });
    expect(execRet.stdout.trim().split('\n').at(-1)?.trim()).toBe(expectedStdout);
    expect(execRet.status).toBe(0);
  });
});

function getTestEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.A;
  return env;
}
