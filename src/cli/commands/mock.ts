import { startMockServer } from '../../mock/server.ts';
import { bold, cyan, dim, green } from '../../util/ansi.ts';
import { loadSpec } from '../common.ts';

export interface MockCommandOptions {
  document: string;
  host: string;
  port: number;
  latency: number;
}

export async function runMock(options: MockCommandOptions): Promise<number> {
  const spec = await loadSpec(options.document);
  const handle = await startMockServer(spec, {
    host: options.host,
    port: options.port,
    latency: options.latency,
  });

  const lines: string[] = [];
  lines.push(`${green('▶')} ${bold(`${spec.info.title} v${spec.info.version}`)} ${dim(`mocking ${spec.document}`)}`);
  lines.push('');
  lines.push(`  ${bold('listening on')}  ${cyan(handle.url)}`);
  lines.push(`  ${bold('routes')}        ${dim(`${spec.operations.length} operations`)}`);
  lines.push(`  ${bold('route table')}   ${cyan(`${handle.url}/_apicovenant/routes`)}`);
  lines.push('');
  lines.push(dim('  press Ctrl+C to stop'));

  const routes = spec.operations
    .slice(0, 12)
    .map((operation) => `    ${operation.method.toUpperCase().padEnd(6)} ${operation.path}`);
  if (routes.length > 0) {
    lines.push('');
    lines.push(...routes);
    if (spec.operations.length > routes.length) {
      lines.push(dim(`    … ${spec.operations.length - routes.length} more`));
    }
  }

  process.stdout.write(`${lines.join('\n')}\n`);

  await new Promise<void>((resolve) => {
    process.once('SIGINT', () => resolve());
    process.once('SIGTERM', () => resolve());
  });

  await handle.close();
  process.stdout.write(`\n${dim('mock server stopped')}\n`);
  return 0;
}
