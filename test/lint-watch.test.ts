import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const bin = join(root, 'bin', 'apicovenant.mjs');

function spec(path: string): string {
  return JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'Watch', version: '1.0.0', description: 'Watch mode fixture.' },
    paths: {
      [path]: {
        get: {
          operationId: 'listItems',
          summary: 'List items',
          description: 'Returns the items.',
          tags: ['items'],
          responses: {
            '200': {
              description: 'ok',
              content: {
                'application/json': { schema: { type: 'object', properties: { id: { type: 'string' } } } },
              },
            },
          },
        },
      },
    },
  });
}

test('lint --watch re-runs after a change and stops on a signal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'apicovenant-watch-lint-'));
  const document = join(directory, 'openapi.json');
  await writeFile(document, spec('/items/'));

  const child = spawn(process.execPath, [bin, 'lint', document, '--watch'], { cwd: root });
  let stdout = '';
  let stderr = '';
  let exitCode: number | null | undefined;
  child.on('exit', (code) => {
    exitCode = code;
  });
  child.stdout.on('data', (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });

  const waitFor = async (predicate: () => boolean, label: string): Promise<void> => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.fail(`timed out waiting for ${label}\nstdout: ${stdout}\nstderr: ${stderr}\nexit: ${exitCode}`);
  };

  try {
    await waitFor(() => stdout.includes('path-no-trailing-slash'), 'the first report');
    await waitFor(() => stdout.includes('watching '), 'the watch hint');
    // Give fs.watch a moment to settle before replacing the document.
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await writeFile(document, spec('/items'));
    await waitFor(
      () => {
        const lastClear = stdout.lastIndexOf('\u001b[2J');
        if (lastClear === -1) return false;
        const latest = stdout.slice(lastClear);
        return latest.includes('rules fired') && !latest.includes('path-no-trailing-slash');
      },
      'a clean second report',
    );
  } finally {
    child.kill();
    await new Promise<void>((resolve) => {
      child.once('close', () => resolve());
      setTimeout(() => resolve(), 3_000);
    });
    await rm(directory, { recursive: true, force: true });
  }

  assert.ok((stdout.match(/rules fired/g) ?? []).length >= 2, stdout);
});
