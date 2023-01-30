import process from 'node:process';

import chalk from 'chalk';
import { RollupError } from 'rollup';

export function stdout(...parameters: readonly unknown[]): void {
  process.stdout.write(`${parameters.join('')}\n`);
}

export function stderr(...parameters: readonly unknown[]): void {
  process.stderr.write(`${parameters.join('')}\n`);
}

export function handleError(error: RollupError, recover = false): void {
  const name = error.name || (error.cause as Error)?.name;
  const nameSection = name ? `${name}: ` : '';
  const pluginSection = error.plugin ? `(plugin ${error.plugin}) ` : '';
  const message = `${pluginSection}${nameSection}${error.message}`;

  const outputLines = [chalk.bold(chalk.red(`[!] ${chalk.bold(message.toString())}`))];

  if (error.url) {
    outputLines.push(chalk.cyan(error.url));
  }

  if (error.loc) {
    outputLines.push(`${error.loc.file || error.id} (${error.loc.line}:${error.loc.column})`);
  } else if (error.id) {
    outputLines.push(error.id);
  }

  if (error.frame) {
    outputLines.push(chalk.dim(error.frame));
  }

  if (error.stack) {
    outputLines.push(chalk.dim(error.stack?.replace(`${nameSection}${error.message}\n`, '')));
  }

  outputLines.push('', '');
  stderr(outputLines.join('\n'));

  if (!recover) process.exit(1);
}
