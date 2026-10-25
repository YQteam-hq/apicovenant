import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateSchema, generateExample, deepEqual } from '../src/spec/schema.ts';

test('validates primitive types', () => {
  assert.deepEqual(validateSchema('x', { type: 'string' }), []);
  assert.equal(validateSchema(1, { type: 'string' }).length, 1);
  assert.equal(validateSchema(1.5, { type: 'integer' }).length, 1);
  assert.equal(validateSchema(1, { type: 'number' }).length, 0);
  assert.equal(validateSchema(null, { type: 'null' }).length, 0);
});

test('validates objects and required properties', () => {
  const schema = {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' }, age: { type: 'integer' } },
    additionalProperties: false,
  };
  assert.deepEqual(validateSchema({ id: 'a' }, schema), []);
  assert.equal(validateSchema({}, schema)[0]?.message.includes('missing required property'), true);
  assert.equal(validateSchema({ id: 'a', extra: 1 }, schema)[0]?.message.includes('not allowed'), true);
});

test('validates arrays', () => {
  const schema = { type: 'array', items: { type: 'string' }, minItems: 1 };
  assert.deepEqual(validateSchema(['a'], schema), []);
  assert.equal(validateSchema([], schema).length, 1);
  assert.equal(validateSchema([1], schema).length, 1);
});

test('validates enums and const', () => {
  assert.deepEqual(validateSchema('a', { enum: ['a', 'b'] }), []);
  assert.equal(validateSchema('c', { enum: ['a', 'b'] }).length, 1);
  assert.deepEqual(validateSchema(5, { const: 5 }), []);
  assert.equal(validateSchema(6, { const: 5 }).length, 1);
});

test('validates string constraints', () => {
  assert.equal(validateSchema('ab', { type: 'string', minLength: 3 }).length, 1);
  assert.equal(validateSchema('abcd', { type: 'string', maxLength: 3 }).length, 1);
  assert.equal(validateSchema('abc', { type: 'string', pattern: '^a' }).length, 0);
  assert.equal(validateSchema('bbc', { type: 'string', pattern: '^a' }).length, 1);
});

test('validates numeric constraints', () => {
  assert.equal(validateSchema(1, { type: 'number', minimum: 2 }).length, 1);
  assert.equal(validateSchema(3, { type: 'number', maximum: 2 }).length, 1);
  assert.equal(validateSchema(2, { type: 'number', minimum: 1, maximum: 3 }).length, 0);
});

test('supports OpenAPI 3.0 nullable', () => {
  assert.deepEqual(validateSchema(null, { type: 'string', nullable: true }), []);
  assert.equal(validateSchema(1, { type: 'string', nullable: true }).length, 1);
});

test('supports anyOf, oneOf and not', () => {
  assert.deepEqual(validateSchema('a', { anyOf: [{ type: 'string' }, { type: 'number' }] }), []);
  assert.equal(validateSchema(true, { anyOf: [{ type: 'string' }, { type: 'number' }] }).length, 1);
  assert.equal(validateSchema('a', { oneOf: [{ type: 'string' }, { type: 'string' }] }).length, 1);
  assert.equal(validateSchema('a', { not: { type: 'string' } }).length, 1);
});

test('reports the path of the offending value', () => {
  const schema = {
    type: 'object',
    properties: { items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } } },
  };
  const violations = validateSchema({ items: [{ id: 5 }] }, schema);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.path, '/items/0/id');
});

test('generates deterministic examples', () => {
  const schema = {
    type: 'object',
    properties: { id: { type: 'string' }, email: { type: 'string', format: 'email' }, age: { type: 'integer' } },
  };
  const first = generateExample(schema, { includeOptional: true });
  const second = generateExample(schema, { includeOptional: true });
  assert.deepEqual(first, second);
  assert.equal(typeof first, 'object');
  assert.match(String((first as Record<string, unknown>)['email']), /@/);
});

test('generated examples respect the schema', () => {
  const schema = {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string' },
      count: { type: 'integer', minimum: 5 },
      flag: { type: 'boolean' },
      tags: { type: 'array', items: { type: 'string' } },
    },
  };
  const example = generateExample(schema, { includeOptional: true }) as Record<string, unknown>;
  assert.equal(typeof example['id'], 'string');
  assert.equal(typeof example['count'], 'number');
  assert.equal(typeof example['flag'], 'boolean');
  assert.ok(Array.isArray(example['tags']));
  assert.equal(validateSchema(example, schema).length, 0);
});

test('uses explicit examples when present', () => {
  const schema = { type: 'object', properties: { id: { type: 'string', example: 'fixed' } } };
  const example = generateExample(schema, { includeOptional: true }) as Record<string, unknown>;
  assert.equal(example['id'], 'fixed');
});

test('picks the branch of a oneOf that the value satisfies', () => {
  const schema = {
    type: 'object',
    properties: {
      payment: {
        oneOf: [
          { type: 'object', properties: { kind: { type: 'string', enum: ['card'] } }, required: ['kind'] },
          { type: 'object', properties: { kind: { type: 'string', enum: ['bank'] } }, required: ['kind'] },
        ],
      },
    },
  };

  const example = generateExample(schema, { includeOptional: true }) as {
    payment: Record<string, unknown>;
  };
  assert.equal(validateSchema(example.payment, schema.properties.payment).length, 0);
});

test('generated strings satisfy a pattern', () => {
  const schema = {
    type: 'object',
    properties: {
      url: { type: 'string', pattern: '^/v1/charges' },
    },
  };
  const example = generateExample(schema, { includeOptional: true }) as Record<string, unknown>;
  assert.equal(validateSchema(example, schema).length, 0);
  assert.match(String(example['url']), /^\/v1\/charges/);
});

test('deeply nested schemas still produce valid values', () => {
  let schema: Record<string, unknown> = { type: 'string' };
  for (let depth = 0; depth < 20; depth += 1) {
    schema = { type: 'object', properties: { nested: schema } };
  }

  const example = generateExample(schema, { includeOptional: true }) as Record<string, unknown>;
  const violations = validateSchema(example, schema, { maxErrors: 5 });
  assert.deepEqual(violations, [], 'the truncated value must still satisfy the schema');
});

test('only includes required properties when asked', () => {
  const schema = {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' }, extra: { type: 'string' } },
  };
  const example = generateExample(schema, { includeOptional: false }) as Record<string, unknown>;
  assert.deepEqual(Object.keys(example), ['id']);
});

test('keyword matching looks at whole words, not substrings', () => {
  const schema = {
    type: 'object',
    required: ['country', 'discounts', 'account_count', 'postal_code'],
    properties: {
      country: { type: 'string' },
      discounts: { type: 'string' },
      account_count: { type: 'string' },
      postal_code: { type: 'string' },
    },
  };

  const example = generateExample(schema, { includeOptional: true }) as Record<string, unknown>;
  assert.equal(example['country'], 'sample-country');
  assert.equal(example['discounts'], 'sample-discounts');
  assert.equal(example['account_count'], '3');
  assert.equal(example['postal_code'], 'SMP-1001');
});

test('keyword matching understands camel case and separators', () => {
  const schema = {
    type: 'object',
    required: ['postalCode', 'customerId'],
    properties: {
      postalCode: { type: 'string' },
      customerId: { type: 'string' },
    },
  };

  const example = generateExample(schema, { includeOptional: true }) as Record<string, unknown>;
  assert.equal(example['postalCode'], 'SMP-1001');
  assert.equal(example['customerId'], 'id_1001');
});

test('truncated values keep required properties, enums and bounds', () => {
  const leaf = {
    type: 'object',
    required: ['kind', 'amount', 'currency'],
    properties: {
      kind: { type: 'string', enum: ['fixed', 'variable'] },
      amount: { type: 'integer', minimum: 5 },
      currency: { type: 'string' },
    },
  };

  let schema: Record<string, unknown> = leaf;
  for (let depth = 0; depth < 15; depth += 1) {
    schema = { type: 'object', required: ['nested'], properties: { nested: schema } };
  }

  const example = generateExample(schema, { includeOptional: true });
  const violations = validateSchema(example, schema, { maxErrors: 5 });
  assert.deepEqual(violations, [], 'the truncated value must still satisfy the schema');
});

test('truncated values satisfy a branch of a oneOf', () => {
  let schema: Record<string, unknown> = {
    type: 'object',
    properties: {
      variant: {
        oneOf: [
          { type: 'object', required: ['kind'], properties: { kind: { type: 'string', enum: ['fixed'] } } },
          { type: 'object', required: ['other'], properties: { other: { type: 'string' } } },
        ],
      },
    },
  };
  for (let depth = 0; depth < 15; depth += 1) {
    schema = { type: 'object', required: ['nested'], properties: { nested: schema } };
  }

  const example = generateExample(schema, { includeOptional: true });
  assert.deepEqual(validateSchema(example, schema, { maxErrors: 5 }), []);
});

test('deepEqual compares structurally', () => {
  assert.equal(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), true);
  assert.equal(deepEqual({ a: 1 }, { a: 2 }), false);
  assert.equal(deepEqual([1, 2], [1, 2, 3]), false);
});

test('generateExample satisfies common string patterns', () => {
  const patterns = [
    '^[a-z]+$',
    '^[A-Z][a-z]+$',
    '^\\d{3}-\\d{4}$',
    '^[0-9a-f]{8}$',
    '^(foo|bar)$',
    '^v\\d+\\.\\d+\\.\\d+$',
    '^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$',
    '^SK-[A-Za-z0-9]{6}$',
    '^(?:abc)+$',
    '^a?b?c$',
    '^x{2,4}$',
    '^\\w+$',
    '^[^0-9]+$',
    '^-?\\d+$',
    '^(cat|dog|bird)s?$',
    '^ID_\\d{4}$',
    '^[A-Z]{2}\\d{6}$',
    '^\\(\\d{3}\\)\\s?\\d{3}-\\d{4}$',
    '^.*$',
    '^a*b*c*$',
    '^[a|b]+$',
  ];
  for (const pattern of patterns) {
    const example = generateExample({ type: 'string', pattern }, { includeOptional: true });
    assert.equal(typeof example, 'string', `${pattern} produced a non-string`);
    assert.ok(new RegExp(pattern).test(example as string), `${pattern} produced ${JSON.stringify(example)}`);
  }
});

test('generateExample repairs a pattern broken by minLength padding', () => {
  const example = generateExample({ type: 'string', pattern: '^\\d+$', minLength: 5 }, { includeOptional: true });
  assert.equal(example, '00000');
});

test('generateExample prefers the pattern over a contradictory maxLength', () => {
  // The schema itself is unsatisfiable (ten digits cannot fit in five chars);
  // the value must at least satisfy one of the two constraints deterministically.
  const example = generateExample({ type: 'string', pattern: '^\\d{10}$', maxLength: 5 }, { includeOptional: true });
  assert.equal(example, '00000');
});

test('generateExample handles grouped alternation and escaped punctuation', () => {
  const grouped = generateExample({ type: 'string', pattern: '^(cat|dog)s?$' }, { includeOptional: true });
  assert.ok(new RegExp('^(cat|dog)s?$').test(grouped as string), JSON.stringify(grouped));
  const phone = generateExample(
    { type: 'string', pattern: '^\\(\\d{3}\\)\\s?\\d{3}-\\d{4}$' },
    { includeOptional: true },
  );
  assert.equal(phone, '(000) 000-0000');
});
