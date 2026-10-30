import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const compiledEntry = path.join(root, 'dist', 'cli', 'main.js');

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(command: string, args: string[], cwd: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: process.platform === 'win32' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

function npm(args: string[], cwd: string): Promise<RunResult> {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return run(command, args, cwd);
}

// The published tarball has to run the compiled output, because Node refuses
// to strip types for files under node_modules. That needs a build, which in
// turn needs the TypeScript compiler.
function compilerAvailable(): boolean {
  try {
    fs.statSync(path.join(root, 'node_modules', 'typescript'));
    return true;
  } catch {
    return false;
  }
}

async function ensureBuild(): Promise<boolean> {
  if (fs.existsSync(compiledEntry)) return true;
  if (!compilerAvailable()) return false;
  const built = await npm(['run', 'build'], root);
  return built.code === 0 && fs.existsSync(compiledEntry);
}

async function packInto(target: string): Promise<string> {
  const packed = await npm(['pack', '--pack-destination', target, '--ignore-scripts'], root);
  assert.equal(packed.code, 0, `npm pack failed: ${packed.stderr}`);
  const name = packed.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.tgz'))
    .pop();
  assert.ok(name, 'npm pack did not report a tarball name');
  return path.join(target, name);
}

async function install(tarball: string, workspace: string): Promise<string> {
  const project = path.join(workspace, 'project');
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(
    path.join(project, 'package.json'),
    JSON.stringify({ name: 'consumer', version: '1.0.0', private: true, type: 'module' }, null, 2),
  );
  const installed = await npm(
    ['install', '--no-audit', '--no-fund', '--ignore-scripts', tarball],
    project,
  );
  assert.equal(installed.code, 0, `npm install failed: ${installed.stderr}`);
  return project;
}

test('the published tarball installs and the CLI runs from it', async (t) => {
  if (!(await ensureBuild())) {
    t.skip('the packaging test needs the TypeScript compiler: run "npm install" first');
    return;
  }

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'apicovenant-pack-'));
  t.after(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  const tarball = await packInto(workspace);
  const project = await install(tarball, workspace);

  const packageRoot = path.join(project, 'node_modules', 'apicovenant');
  assert.ok(
    fs.existsSync(path.join(packageRoot, 'dist', 'cli', 'main.js')),
    'the tarball does not ship the compiled entry point',
  );

  const cli = path.join(packageRoot, 'bin', 'apicovenant.mjs');
  assert.ok(fs.existsSync(cli), 'the tarball does not ship the CLI entry point');

  // The installed CLI must not load a TypeScript source: Node refuses to
  // strip types for files under node_modules.
  const version = await run(process.execPath, [cli, '--version'], project);
  assert.equal(version.code, 0, `the installed CLI failed: ${version.stderr}`);
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);

  const lint = await run(
    process.execPath,
    [cli, 'lint', path.join(root, 'examples', 'shop.openapi.yaml')],
    project,
  );
  assert.equal(lint.code, 0, `the installed CLI could not lint: ${lint.stderr}`);
  assert.match(lint.stdout, /no findings/);
});

test('the published tarball exposes the library entry point', async (t) => {
  if (!(await ensureBuild())) {
    t.skip('the packaging test needs the TypeScript compiler: run "npm install" first');
    return;
  }

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'apicovenant-pack-api-'));
  t.after(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  const tarball = await packInto(workspace);
  const project = await install(tarball, workspace);

  fs.writeFileSync(
    path.join(project, 'use.mjs'),
    "import { lint, VERSION } from 'apicovenant';\nprocess.stdout.write(`${VERSION} ${typeof lint}\\n`);\n",
  );

  const used = await run(process.execPath, ['use.mjs'], project);
  assert.equal(used.code, 0, `the installed library could not be imported: ${used.stderr}`);
  assert.match(used.stdout.trim(), /^\d+\.\d+\.\d+ function$/);
});
