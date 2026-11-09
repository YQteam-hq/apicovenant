#!/usr/bin/env node
/**
 * Download the public-spec corpus used for local compatibility and performance
 * checks. The files are intentionally ignored by git; CI never downloads them.
 *
 *   node scripts/fetch-corpus.mjs
 *   node scripts/fetch-corpus.mjs --force
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'corpus', 'manifest.json');
const outputDir = path.join(root, 'corpus', 'specs');
const force = process.argv.includes('--force');

const entries = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
fs.mkdirSync(outputDir, { recursive: true });

for (const entry of entries) {
  const target = path.join(outputDir, entry.name);
  if (fs.existsSync(target) && !force) {
    process.stdout.write(`skip ${entry.name} (exists)\n`);
    continue;
  }
  process.stdout.write(`fetch ${entry.name} <- ${entry.url}\n`);
  const response = await fetch(entry.url);
  if (!response.ok) {
    throw new Error(`${entry.url}: HTTP ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  if (text.length < 100) throw new Error(`${entry.url}: response is too small to be a spec`);
  fs.writeFileSync(target, text, 'utf8');
  process.stdout.write(`  saved ${entry.name} (${Buffer.byteLength(text, 'utf8')} bytes)\n`);
}

process.stdout.write('corpus: ready\n');
