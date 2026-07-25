import fs from 'node:fs';

import { spawnAsync } from '@willbooster/shared-lib-node';
import { beforeAll, describe, expect, it } from 'vitest';

describe('run env.ts', { timeout: 60_000 }, () => {
  it.each([
    ['bun run start-prod run test/fixtures/env.ts --no-auto-cascade-env', '1'],
    ['bun run start-prod run test/fixtures/env.ts', '1'],
    ['bun run start-prod run test/fixtures/env.ts --cascade-env ""', '1'],
    ['bun run start-prod run test/fixtures/env.ts --cascade-node-env', '1'],
    ['bun run start-prod run --cascade-env="" test/fixtures/env.ts', '1'],
    ['bun run start-prod run --cascade-node-env test/fixtures/env.ts', '1'],
    ['bun run start-prod --cascade-env="" run test/fixtures/env.ts', '1'],
    ['bun run start-prod --cascade-node-env run test/fixtures/env.ts', '1'],
    // Options with a non-empty argument must be after positional arguments.
    // ['bun run start-prod run --cascade-env "" test/fixtures/env.ts', '1'],
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

describe('run ignores .env files', { timeout: 60_000 }, () => {
  const fixtureDirPath = '.tmp/test-fixtures/run-dot-env-ignored';

  beforeAll(async () => {
    await fs.promises.rm(fixtureDirPath, { recursive: true, force: true });
    await fs.promises.mkdir(fixtureDirPath, { recursive: true });
    // fnox.toml must not declare this name, so a value can only come from the .env file beside the script.
    await fs.promises.writeFile(`${fixtureDirPath}/.env`, 'BUILD_TS_TEST_DOT_ENV=from-env-file\n');
    await fs.promises.writeFile(
      `${fixtureDirPath}/print.ts`,
      `process.stdout.write(process.env.BUILD_TS_TEST_DOT_ENV ?? 'missing');\n`
    );
  });

  it('does not read a .env file beside the script', async () => {
    const execRet = await spawnAsync('bun', ['run', 'start-prod', 'run', `${fixtureDirPath}/print.ts`], {
      env: getTestEnvironment(),
    });
    expect(execRet.stdout.trim().split('\n').at(-1)?.trim()).toBe('missing');
    expect(execRet.status).toBe(0);
  });

  it('rejects the removed --env option', async () => {
    const execRet = await spawnAsync(
      'bun',
      ['run', 'start-prod', 'run', `${fixtureDirPath}/print.ts`, '--env', `${fixtureDirPath}/.env`],
      { env: getTestEnvironment() }
    );
    expect(`${execRet.stdout}${execRet.stderr}`).to.includes('Unknown argument: env');
    expect(execRet.status).not.toBe(0);
  });
});

function getTestEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.A;
  return env;
}
