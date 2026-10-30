import { writeTextFile } from '../../util/fs.ts';
import { serializeGoldenFile } from '../../record/golden.ts';
import { startRecorder } from '../../record/recorder.ts';
import { bold, cyan, dim, green } from '../../util/ansi.ts';
import { UsageError } from '../common.ts';

export interface RecordCommandOptions {
  target: string;
  out: string;
  spec?: string;
  host: string;
  port: number;
  maxRequests?: number;
  durationSeconds?: number;
}

export async function runRecord(options: RecordCommandOptions): Promise<number> {
  if (!options.target) throw new UsageError('--target is required');
  if (!options.out) throw new UsageError('--out is required');

  let finishRecording: (() => void) | undefined;

  const handle = await startRecorder({
    target: options.target,
    spec: options.spec,
    host: options.host,
    port: options.port,
    maxRequests: options.maxRequests,
    durationMs: options.durationSeconds ? options.durationSeconds * 1000 : undefined,
    onComplete: () => finishRecording?.(),
  });

  const lines: string[] = [];
  lines.push(`${green('▶')} ${bold('recording')} ${dim(options.target)}`);
  lines.push('');
  lines.push(`  ${bold('proxy')}   ${cyan(handle.url)}`);
  lines.push(`  ${bold('output')}  ${bold(options.out)}`);
  lines.push('');
  lines.push(dim('  point your client at the proxy, then press Ctrl+C to stop'));
  process.stdout.write(`${lines.join('\n')}\n`);

  await new Promise<void>((resolve) => {
    finishRecording = (): void => {
      process.stdout.write(`\n${dim('captured interactions:')}\n`);
      resolve();
    };
    process.once('SIGINT', finishRecording);
    process.once('SIGTERM', finishRecording);
  });

  const file = handle.stop();
  await writeTextFile(options.out, serializeGoldenFile(file));

  process.stdout.write(
    `${green('✓')} ${file.interactions.length} interaction${file.interactions.length === 1 ? '' : 's'} written to ${bold(options.out)}\n`,
  );
  return 0;
}
