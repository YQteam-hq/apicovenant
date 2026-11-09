import { existsSync } from 'node:fs';

import { UsageError } from '../common.ts';
import { ConfigError, parseConfigFile, toConfigV2, type ApicovenantConfig } from '../../config.ts';
import { parseGoldenFile, serializeGoldenFile } from '../../record/golden.ts';
import { readTextFile, writeTextFile } from '../../util/fs.ts';
import { bold, dim, green } from '../../util/ansi.ts';
import { unifiedDiff } from '../../util/diff.ts';

export { unifiedDiff } from '../../util/diff.ts';

export interface MigrateCommandOptions {
  config?: string;
  golden?: string;
  output?: string;
  dryRun?: boolean;
  force?: boolean;
}

async function emit(target: string, contents: string, options: MigrateCommandOptions): Promise<void> {
  if (!options.output) {
    process.stdout.write(contents);
    return;
  }
  if (existsSync(target) && !options.force) {
    throw new UsageError(`${target} already exists; pass --force to overwrite it`);
  }
  await writeTextFile(target, contents);
  process.stdout.write(`${green('✓')} wrote ${bold(target)} ${dim(`(${contents.length} bytes)`)}\n`);
}

export async function runMigrate(options: MigrateCommandOptions): Promise<number> {
  const selected = [options.config, options.golden].filter((value): value is string => Boolean(value));
  if (selected.length !== 1) {
    throw new UsageError('pass exactly one of --config <file> or --golden <file>');
  }

  if (options.config) {
    const source = options.config;
    const text = await readTextFile(source);
    let parsed: ApicovenantConfig;
    try {
      parsed = parseConfigFile(text, source);
    } catch (error) {
      throw new ConfigError(`cannot migrate ${source}: ${(error as Error).message}`);
    }
    const migrated = `${JSON.stringify(toConfigV2(parsed), null, 2)}\n`;

    if (options.dryRun) {
      process.stdout.write(unifiedDiff(text, migrated, source, `${source} (v2)`));
      return 0;
    }
    await emit(options.output ?? source, migrated, options);
    return 0;
  }

  const source = options.golden as string;
  const text = await readTextFile(source);
  const migrated = serializeGoldenFile(parseGoldenFile(text));

  if (options.dryRun) {
    process.stdout.write(unifiedDiff(text, migrated, source, `${source} (format 2)`));
    return 0;
  }
  await emit(options.output ?? source, migrated, options);
  return 0;
}
