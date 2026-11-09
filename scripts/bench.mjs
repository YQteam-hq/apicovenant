#!/usr/bin/env node
/**
 * Non-blocking performance benchmark for the 1.1.0 targets.
 *
 *   node scripts/bench.mjs [--operations 1000] [--check]
 *
 * By default this prints a report and exits 0. --check exits 1 when a target
 * from the release plan is missed, which is intended for the RC gate rather
 * than every pull request.
 */
import { performance } from 'node:perf_hooks';

import { compareSpecs } from '../src/breaking/compare.ts';
import { measureCoverage } from '../src/coverage/coverage.ts';
import { lint } from '../src/lint/engine.ts';
import { startMockServer } from '../src/mock/server.ts';
import { createGoldenFile } from '../src/record/golden.ts';
import { loadSpecFromText } from '../src/spec/loader.ts';

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const operations = argument('--operations', 1000);
const check = process.argv.includes('--check');
const padding = 'Benchmark description. '.repeat(480); // ~10 KB per operation

const paths = {};
for (let index = 0; index < operations; index += 1) {
  paths[`/resource-${index}`] = {
    get: {
      operationId: `getResource${index}`,
      summary: `Get resource ${index}`,
      description: padding,
      tags: ['bench'],
      responses: {
        '200': {
          description: 'ok',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['id', 'name'],
                properties: {
                  id: { type: 'integer' },
                  name: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  };
}

const document = {
  openapi: '3.1.0',
  info: { title: 'Benchmark', version: '1.0.0', description: padding },
  servers: [{ url: 'https://api.example.com' }],
  tags: [{ name: 'bench', description: 'Benchmark operations.' }],
  paths,
};

const text = JSON.stringify(document);
const megabytes = Buffer.byteLength(text, 'utf8') / (1024 * 1024);

const rows = [];
function record(name, milliseconds, target, note = '') {
  rows.push({
    name,
    milliseconds,
    target,
    ok: milliseconds <= target,
    note,
  });
}

let peakRss = process.memoryUsage().rss;
const sampler = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}, 50);
sampler.unref();

let spec;
let started = performance.now();
try {
  spec = loadSpecFromText(text, { document: 'benchmark.openapi.json' });
  record(`parse ${megabytes.toFixed(1)} MB document`, performance.now() - started, 3000);

  started = performance.now();
  lint(spec);
  record(`lint ${megabytes.toFixed(1)} MB document`, performance.now() - started, 3000);

  started = performance.now();
  compareSpecs(spec, spec);
  record('breaking self-compare', performance.now() - started, 5000);

  const golden = createGoldenFile('benchmark');
  for (const [path] of Object.entries(paths)) {
    golden.interactions.push({
      method: 'GET',
      path,
      query: {},
      requestHeaders: {},
      status: 200,
      responseHeaders: { 'content-type': 'application/json' },
      body: '{"id":1,"name":"bench"}',
      bodyType: 'json',
      durationMs: 1,
    });
  }
  started = performance.now();
  measureCoverage(golden, spec, 'benchmark');
  record(`coverage ${operations} interactions`, performance.now() - started, 3000);

  started = performance.now();
  const mock = await startMockServer(spec, { port: 0, host: '127.0.0.1' });
  await mock.close();
  record(`mock cold start ${operations} operations`, performance.now() - started, 1000);
} finally {
  clearInterval(sampler);
}

peakRss = Math.max(peakRss, process.memoryUsage().rss);
const peakMegabytes = peakRss / (1024 * 1024);

process.stdout.write(`apicovenant benchmark — ${operations} operations, ${megabytes.toFixed(1)} MB\n\n`);
process.stdout.write('scenario                                 time      target   result\n');
process.stdout.write('----------------------------------------  --------  -------  ------\n');
for (const row of rows) {
  const time = `${row.milliseconds.toFixed(1)}ms`.padStart(8);
  const target = `<${row.target}ms`.padEnd(7);
  process.stdout.write(`${row.name.padEnd(40)}  ${time}  ${target}  ${row.ok ? 'ok' : 'SLOW'}\n`);
}
process.stdout.write(`\npeak RSS: ${peakMegabytes.toFixed(1)} MB (target <512 MB)\n`);

const slow = rows.filter((row) => !row.ok);
const memoryOk = peakMegabytes < 512;
if (slow.length === 0 && memoryOk) {
  process.stdout.write('\nall targets met\n');
} else {
  process.stdout.write(
    `\n${slow.length} slow scenario${slow.length === 1 ? '' : 's'}${memoryOk ? '' : ' and memory above target'}; ` +
      'record the cause in the release notes\n',
  );
  if (check) process.exitCode = 1;
}
