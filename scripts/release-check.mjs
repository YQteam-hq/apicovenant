#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const notes = [];

function fail(message) {
  problems.push(message);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir)) {
    if (entry === '.git' || entry === 'node_modules' || entry === 'coverage' || entry === 'dist') continue;
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(root);
const rel = (file) => path.relative(root, file).split(path.sep).join('/');
const read = (file) => fs.readFileSync(path.isAbsolute(file) ? file : path.join(root, file), 'utf8');


const RULE_FILES = [
  'src/lint/rules/document.ts',
  'src/lint/rules/operations.ts',
  'src/lint/rules/paths.ts',
  'src/lint/rules/parameters.ts',
  'src/lint/rules/responses.ts',
  'src/lint/rules/schemas.ts',
  'src/lint/rules/security.ts',
  'src/lint/rules/pagination.ts',
];

const ruleSource = RULE_FILES.map(read).join('\n');
const codeRules = new Map();
for (const match of ruleSource.matchAll(/id:\s*'([a-z0-9-]+)',[\s\S]*?severity:\s*'(error|warn|info)',[\s\S]*?category:\s*'([a-z]+)'/g)) {
  codeRules.set(match[1], { severity: match[2], category: match[3] });
}

const rulesDoc = read('docs/rules.md');
const docRules = new Map();
for (const match of rulesDoc.matchAll(/###\s+`([a-z0-9-]+)`\s+·\s+(error|warn|info)/g)) {
  docRules.set(match[1], match[2]);
}

for (const [id, meta] of codeRules) {
  if (!docRules.has(id)) fail(`docs/rules.md does not document the rule "${id}"`);
  else if (docRules.get(id) !== meta.severity) {
    fail(`severity mismatch for "${id}": code=${meta.severity}, docs=${docRules.get(id)}`);
  }
}
for (const id of docRules.keys()) {
  if (!codeRules.has(id)) fail(`docs/rules.md documents "${id}" but no such rule exists`);
}
notes.push(`rules: ${codeRules.size} in code, ${docRules.size} documented`);


const readme = read('README.md');
const readmeZh = read('README.zh-CN.md');

for (const [name, text] of [['README.md', readme], ['README.zh-CN.md', readmeZh]]) {
  for (const match of text.matchAll(/(\d+)\s*(?:design-convention rules|条\*\*设计约定\*\*规则|条设计约定规则)/g)) {
    if (Number(match[1]) !== codeRules.size) {
      fail(`${name} claims ${match[1]} rules, there are ${codeRules.size}`);
    }
  }
}


for (const [name, text] of [
  ['README.md', readme],
  ['README.zh-CN.md', readmeZh],
  ['docs/rules.md', rulesDoc],
  ['CONTRIBUTING.md', read('CONTRIBUTING.md')],
  ['CHANGELOG.md', read('CHANGELOG.md')],
]) {
  const dir = name.startsWith('docs/') ? path.join(root, 'docs') : root;
  for (const match of text.matchAll(/\]\(([^)#][^)]*)\)/g)) {
    const target = match[1];
    if (/^(https?:|mailto:)/.test(target)) continue;
    const clean = target.split('#')[0];
    if (!clean) continue;
    if (!fs.existsSync(path.resolve(dir, clean))) fail(`${name} links to a missing file: ${target}`);
  }
  for (const match of text.matchAll(/(?:src|assets|examples|scripts|bin)\/[\w.@-]+/g)) {
    if (!fs.existsSync(path.join(root, match[0]))) fail(`${name} references a missing path: ${match[0]}`);
  }
}


const pkg = JSON.parse(read('package.json'));

// dist/ is produced by "npm run build" rather than checked in, so it is
// validated through the sources it is compiled from.
const BUILD_ROOT = 'dist';
const SOURCE_ROOT = 'src';

function sourceOf(published) {
  const relative = published.replace(/^\.\//, '').split(path.sep).join('/');
  if (!relative.startsWith(`${BUILD_ROOT}/`)) return null;
  const stem = relative.slice(BUILD_ROOT.length + 1).replace(/\.d\.ts$|\.js$/, '');
  return `${SOURCE_ROOT}/${stem}.ts`;
}

for (const entry of pkg.files ?? []) {
  if (entry === BUILD_ROOT) {
    if (!fs.existsSync(path.join(root, 'tsconfig.build.json'))) {
      fail(`package.json "files" ships "${entry}" but there is no tsconfig.build.json to build it`);
    }
    continue;
  }
  if (!fs.existsSync(path.join(root, entry))) fail(`package.json "files" lists a missing entry: ${entry}`);
}
for (const [name, target] of Object.entries(pkg.bin ?? {})) {
  if (!fs.existsSync(path.join(root, target))) fail(`package.json bin "${name}" points to a missing file: ${target}`);
}
for (const [key, target] of Object.entries(pkg.exports?.['.'] ?? {})) {
  if (typeof target !== 'string') continue;
  if (fs.existsSync(path.join(root, target))) continue;
  const source = sourceOf(target);
  if (source && fs.existsSync(path.join(root, source))) continue;
  fail(`package.json exports "${key}" points to a missing file: ${target}`);
}
if ((pkg.dependencies && Object.keys(pkg.dependencies).length > 0) || (pkg.peerDependencies && Object.keys(pkg.peerDependencies).length > 0)) {
  fail('the package must have zero runtime dependencies');
}
if (pkg.license !== 'Apache-2.0') fail(`package.json license is "${pkg.license}", expected Apache-2.0`);
if (!read('LICENSE').startsWith('                                 Apache License')) {
  fail('LICENSE is not the Apache License 2.0 text');
}
if (!fs.existsSync(path.join(root, 'NOTICE'))) fail('an Apache-2.0 project should ship a NOTICE file');


const versionSource = read('src/version.ts');
if (!versionSource.includes("'..', 'package.json'")) {
  fail('src/version.ts does not read package.json from the package root');
}
const reportedVersion = execFileSync(process.execPath, [path.join(root, 'bin', 'apicovenant.mjs'), '--version'], {
  encoding: 'utf8',
}).trim();
if (reportedVersion !== pkg.version) {
  fail(`the CLI reports version "${reportedVersion}" but package.json says "${pkg.version}"`);
}
notes.push(`version: ${reportedVersion}`);


const sourceFiles = files.filter((file) => rel(file).startsWith('src/') && file.endsWith('.ts'));
const testFiles = files.filter((file) => rel(file).startsWith('test/') && file.endsWith('.ts'));
const binFiles = files.filter((file) => rel(file).startsWith('bin/'));
const corpus = [...sourceFiles, ...testFiles, ...binFiles].map(read).join('\n');

const exported = new Map();
for (const file of sourceFiles) {
  const text = read(file);
  for (const match of text.matchAll(/export\s+(?:async\s+)?(?:function|const|class|interface|type|let)\s+([A-Za-z_$][\w$]*)/g)) {
    if (!exported.has(match[1])) exported.set(match[1], []);
    exported.get(match[1]).push(rel(file));
  }
}
for (const [name, defs] of exported) {
  const uses = [...corpus.matchAll(new RegExp(`\\b${name.replace(/[$]/g, '\\$')}\\b`, 'g'))].length;
  if (uses <= defs.length) fail(`unused export "${name}" (${defs.join(', ')})`);
}


for (const file of files) {
  const name = rel(file);
  if (!/\.(ts|mjs|js|json|ya?ml)$/.test(name)) continue;
  if (name.startsWith('assets/') || name.startsWith('examples/') || name.startsWith('.github/')) continue;

  if (name === 'scripts/release-check.mjs') continue;
  const text = read(file);
  const isTool = name.startsWith('scripts/');
  const markers = isTool ? /TODO|FIXME|XXX/g : /TODO|FIXME|XXX|console\.(log|debug)\(/g;
  for (const match of text.matchAll(markers)) {
    fail(`${name} contains a leftover marker: ${match[0]}`);
  }
  if (text.includes('\r\n')) fail(`${name} contains CRLF line endings`);
  if (text.length > 0 && !text.endsWith('\n')) fail(`${name} does not end with a newline`);
}


notes.forEach((note) => console.log(note));

if (problems.length === 0) {
  console.log('\nrelease check: OK');
} else {
  console.log(`\nrelease check: ${problems.length} problem(s)`);
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exitCode = 1;
}
