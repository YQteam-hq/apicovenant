import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseYaml, resolveScalar, findKeySeparator, YamlError } from '../src/yaml/parser.ts';

test('parses a flat mapping', () => {
  const doc = parseYaml('name: apicovenant\nversion: 0.1.0\nenabled: true\n');
  assert.deepEqual(doc, { name: 'apicovenant', version: '0.1.0', enabled: true });
});

test('parses nested mappings and sequences', () => {
  const doc = parseYaml(
    ['servers:', '  - url: https://api.example.com', '    description: prod', '  - url: https://staging.example.com', 'paths:', '  /users:', '    get:', '      summary: list users', ''].join('\n'),
  );
  assert.deepEqual(doc, {
    servers: [
      { url: 'https://api.example.com', description: 'prod' },
      { url: 'https://staging.example.com' },
    ],
    paths: { '/users': { get: { summary: 'list users' } } },
  });
});

test('supports sequences at the same indentation as their key', () => {
  const doc = parseYaml('tags:\n- one\n- two\nname: x\n');
  assert.deepEqual(doc, { tags: ['one', 'two'], name: 'x' });
});

test('resolves scalar types', () => {
  assert.equal(resolveScalar('42'), 42);
  assert.equal(resolveScalar('-1.5'), -1.5);
  assert.equal(resolveScalar('true'), true);
  assert.equal(resolveScalar('null'), null);
  assert.equal(resolveScalar('~'), null);
  assert.equal(resolveScalar(''), null);
  assert.equal(resolveScalar('plain text'), 'plain text');
  assert.equal(resolveScalar('2024-01-01'), '2024-01-01');
});

test('ignores comments but keeps # inside urls and quotes', () => {
  const doc = parseYaml(
    ['# leading comment', 'url: https://example.com/#anchor  # trailing comment', "quoted: 'a # b'", ''].join('\n'),
  );
  assert.deepEqual(doc, { url: 'https://example.com/#anchor', quoted: 'a # b' });
});

test('parses flow collections', () => {
  const doc = parseYaml('list: [a, b, 3]\nmap: {x: 1, y: "two", nested: [true]}\n');
  assert.deepEqual(doc, { list: ['a', 'b', 3], map: { x: 1, y: 'two', nested: [true] } });
});

test('parses literal block scalars', () => {
  const doc = parseYaml(['description: |', '  line one', '  line two', 'other: x', ''].join('\n'));
  assert.deepEqual(doc, { description: 'line one\nline two\n', other: 'x' });
});

test('parses literal block scalars with strip chomping', () => {
  const doc = parseYaml(['description: |-', '  line one', '  line two', ''].join('\n'));
  assert.deepEqual(doc, { description: 'line one\nline two' });
});

test('parses folded block scalars', () => {
  const doc = parseYaml(['description: >', '  one', '  two', '  three', ''].join('\n'));
  assert.deepEqual(doc, { description: 'one two three\n' });
});

test('handles quoted scalars with escapes', () => {
  const doc = parseYaml('a: "line\\nbreak"\nb: \'it\'\'s\'\n');
  assert.deepEqual(doc, { a: 'line\nbreak', b: "it's" });
});

test('supports anchors and aliases', () => {
  const doc = parseYaml(['base: &base', '  a: 1', 'copy: *base', ''].join('\n'));
  assert.deepEqual(doc, { base: { a: 1 }, copy: { a: 1 } });
});

test('supports multi-line plain scalars', () => {
  const doc = parseYaml('description: a long\n  description that continues\nother: 1\n');
  assert.deepEqual(doc, { description: 'a long description that continues', other: 1 });
});

test('parses sequences of mappings', () => {
  const doc = parseYaml(
    ['parameters:', '  - name: id', '    in: path', '    required: true', '  - name: q', '    in: query', ''].join('\n'),
  );
  assert.deepEqual(doc, {
    parameters: [
      { name: 'id', in: 'path', required: true },
      { name: 'q', in: 'query' },
    ],
  });
});

test('parses an empty value as null', () => {
  const doc = parseYaml('a:\nb: 1\n');
  assert.deepEqual(doc, { a: null, b: 1 });
});

test('throws a YamlError with a line number on bad indentation', () => {
  assert.throws(
    () => parseYaml('a: 1\n    b: 2\n'),
    (error: unknown) => error instanceof YamlError && error.line === 2,
  );
});

test('findKeySeparator ignores colons inside quotes and flow collections', () => {
  assert.equal(findKeySeparator('url: https://x'), 3);
  assert.equal(findKeySeparator('"a: b": value'), 6);
  assert.equal(findKeySeparator('a: [1, 2]'), 1);
  assert.equal(findKeySeparator('plain'), -1);
});

test('resolves aliases inside flow collections', () => {
  assert.deepEqual(parseYaml('a: &x 1\nb: [*x, 2]\n'), { a: 1, b: [1, 2] });
  assert.deepEqual(parseYaml('a: &x 1\nb: {k: *x, j: 2}\n'), { a: 1, b: { k: 1, j: 2 } });
  assert.deepEqual(parseYaml('a: &x\n  k: 1\nb: [*x, *x]\n'), { a: { k: 1 }, b: [{ k: 1 }, { k: 1 }] });
});

test('merges a flow sequence of anchors with the merge key', () => {
  const doc = parseYaml('b1: &x\n  k: 1\nb2: &y\n  j: 2\nc:\n  <<: [*x, *y]\n  m: 3\n') as Record<string, unknown>;
  assert.deepEqual(doc['c'], { m: 3, k: 1, j: 2 });
});

test('throws on an unknown alias inside a flow collection', () => {
  assert.throws(() => parseYaml('a: [*nope]\n'), (error: unknown) => error instanceof YamlError);
});

test('parses a compact nested sequence', () => {
  assert.deepEqual(parseYaml('a:\n  - - 1\n    - 2\n'), { a: [[1, 2]] });
  assert.deepEqual(parseYaml('a:\n  - - k: 1\n'), { a: [[{ k: 1 }]] });
});

test('parses block scalars as sequence items', () => {
  assert.deepEqual(parseYaml('a:\n  - |\n    x\n    y\n'), { a: ['x\ny\n'] });
  assert.deepEqual(parseYaml('a:\n  - >\n    x\n    y\n'), { a: ['x y\n'] });
  assert.deepEqual(parseYaml('a:\n  - |\n    x\n  - plain\n'), { a: ['x\n', 'plain'] });
});

test('parses a realistic enum of multi-line block scalars', () => {
  const doc = parseYaml(
    [
      'components:',
      '  schemas:',
      '    Choice:',
      '      type: string',
      '      enum:',
      '        - |',
      '          first choice',
      '        - second',
      '',
    ].join('\n'),
  ) as { components: { schemas: { Choice: { enum: string[] } } } };
  assert.deepEqual(doc.components.schemas.Choice.enum, ['first choice\n', 'second']);
});

test('keep chomping preserves trailing empty lines', () => {
  assert.deepEqual(parseYaml('a: |+\n  l1\n\n'), { a: 'l1\n\n' });
  assert.deepEqual(parseYaml('a: |+\n  l1\n'), { a: 'l1\n' });
  assert.deepEqual(parseYaml('a: >+\n  l1\n\n'), { a: 'l1\n\n' });
  assert.deepEqual(parseYaml('a: |-\n  l1\n\n'), { a: 'l1' });
  assert.deepEqual(parseYaml('a: |\n  l1\n\n'), { a: 'l1\n' });
});

test('a less-indented line ends the block scalar instead of being swallowed', () => {
  assert.throws(
    () => parseYaml('a: |\n    deep\n  shallow\nb: 2\n'),
    (error: unknown) => error instanceof YamlError && error.line === 3,
  );
});
