#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const source = path.join(root, 'src', 'cli', 'main.ts');
const compiled = path.join(root, 'dist', 'cli', 'main.js');

// Node refuses to strip types for files under node_modules, so an installed
// package has to run the compiled output. A checkout runs the sources, which
// keeps the code under test identical to the code in src/.
const installed = /[\\/]node_modules[\\/]/.test(here);

async function load() {
  const candidates = installed ? [compiled, source] : [source, compiled];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      return await import(pathToFileURL(candidate).href);
    } catch (error) {
      if (error?.code !== 'ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING') throw error;
    }
  }
  throw new Error(
    'apicovenant could not find a runnable entry point. Run "npm run build" in the package directory.',
  );
}

const { main } = await load();

await main();
