import path from 'node:path';
import { existsSync } from 'node:fs';

import { writeTextFile } from '../../util/fs.ts';
import { bold, cyan, dim, green, yellow } from '../../util/ansi.ts';

export interface InitCommandOptions {
  cwd?: string;

  force?: boolean;

  fileName?: string;

  configVersion?: 1 | 2;
}

export async function runInit(options: InitCommandOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const fileName = options.fileName ?? 'apicovenant.config.json';
  const target = path.resolve(cwd, fileName);

  if (existsSync(target) && !options.force) {
    process.stderr.write(
      `${yellow('!')} ${fileName} already exists. Use --force to overwrite it.\n`,
    );
    return 1;
  }

  const contents = `${JSON.stringify(
    options.configVersion === 1
      ? {
          rules: { ignore: [] },
          severity: 'info',
          failOn: 'error',
          format: 'text',
        }
      : {
          version: 2,
          extends: ['apicovenant:recommended'],
          lint: { severity: 'info', failOn: 'error' },
          diff: { ignoreHeaders: ['etag', 'date'] },
          breaking: { failOn: 'breaking' },
          coverage: { min: 80, failOn: 'never' },
        },
    null,
    2,
  )}\n`;
  await writeTextFile(target, contents);

  process.stdout.write(`${green('✓')} wrote ${bold(fileName)}\n`);
  process.stdout.write(`\n  ${dim('Next:')} review the settings, then run\n`);
  process.stdout.write(`    ${cyan('apicovenant lint openapi.yaml')}\n`);
  process.stdout.write(`\n  ${dim('To adopt on an existing codebase, record the current findings:')}\n`);
  process.stdout.write(`    ${cyan('apicovenant lint openapi.yaml --update-baseline .apicovenant-baseline.json')}\n`);
  return 0;
}
