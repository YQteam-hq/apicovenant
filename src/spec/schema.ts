import { isPlainObject } from '../util/text.ts';

export interface JsonSchema {
  type?: string | string[];
  format?: string;
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  prefixItems?: JsonSchema[];
  enum?: unknown[];
  const?: unknown;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  not?: JsonSchema;
  nullable?: boolean;
  default?: unknown;
  example?: unknown;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minProperties?: number;
  maxProperties?: number;
  readOnly?: boolean;
  writeOnly?: boolean;
  deprecated?: boolean;
  [key: string]: unknown;
}

export interface SchemaViolation {

  path: string;

  schemaPath: string;
  message: string;
}

export interface ValidateOptions {

  maxErrors?: number;
}

const TYPE_CHECKS: Record<string, (value: unknown) => boolean> = {
  string: (value) => typeof value === 'string',
  number: (value) => typeof value === 'number' && Number.isFinite(value),
  integer: (value) => typeof value === 'number' && Number.isInteger(value),
  boolean: (value) => typeof value === 'boolean',
  object: (value) => isPlainObject(value),
  array: (value) => Array.isArray(value),
  null: (value) => value === null,
};

function typeNames(schema: JsonSchema): string[] {
  const names: string[] = [];
  if (typeof schema.type === 'string') names.push(schema.type);
  else if (Array.isArray(schema.type)) names.push(...schema.type.filter((t): t is string => typeof t === 'string'));


  if (schema.nullable === true && names.length > 0 && !names.includes('null')) names.push('null');
  return names;
}

function matchesType(value: unknown, names: string[]): boolean {
  if (names.length === 0) return true;
  return names.some((name) => TYPE_CHECKS[name]?.(value) ?? true);
}

export function validateSchema(value: unknown, schema: unknown, options: ValidateOptions = {}): SchemaViolation[] {
  const violations: SchemaViolation[] = [];
  const maxErrors = options.maxErrors ?? 100;

  const visit = (val: unknown, sch: unknown, path: string, schemaPath: string): void => {
    if (violations.length >= maxErrors) return;
    if (!isPlainObject(sch)) return;
    const s = sch as JsonSchema;

    const names = typeNames(s);
    if (names.length > 0 && !matchesType(val, names)) {
      violations.push({
        path,
        schemaPath,
        message: `expected ${names.join(' | ')} but received ${describeType(val)}`,
      });
      return;
    }

    if (s.const !== undefined && !deepEqual(val, s.const)) {
      violations.push({ path, schemaPath, message: `expected the constant ${JSON.stringify(s.const)}` });
    }

    if (Array.isArray(s.enum) && !s.enum.some((candidate) => deepEqual(val, candidate))) {
      violations.push({
        path,
        schemaPath,
        message: `value is not one of the allowed values [${s.enum.map((v) => JSON.stringify(v)).join(', ')}]`,
      });
    }

    if (typeof val === 'string') validateString(val, s, path, schemaPath, violations);
    if (typeof val === 'number') validateNumber(val, s, path, schemaPath, violations);

    if (Array.isArray(val)) {
      if (typeof s.minItems === 'number' && val.length < s.minItems) {
        violations.push({ path, schemaPath, message: `expected at least ${s.minItems} items but received ${val.length}` });
      }
      if (typeof s.maxItems === 'number' && val.length > s.maxItems) {
        violations.push({ path, schemaPath, message: `expected at most ${s.maxItems} items but received ${val.length}` });
      }
      if (s.uniqueItems === true) {
        const seen = new Set<string>();
        for (const item of val) {
          const key = JSON.stringify(item);
          if (seen.has(key)) {
            violations.push({ path, schemaPath, message: 'items must be unique' });
            break;
          }
          seen.add(key);
        }
      }
      const prefix = s.prefixItems ?? [];
      val.forEach((item, index) => {
        const itemSchema = index < prefix.length ? prefix[index] : s.items;
        if (itemSchema) visit(item, itemSchema, `${path}/${index}`, `${schemaPath}/items`);
      });
    }

    if (isPlainObject(val)) {
      const properties = isPlainObject(s.properties) ? s.properties : {};
      const required = Array.isArray(s.required) ? s.required : [];

      for (const key of required) {
        if (!(key in val)) {
          violations.push({
            path: `${path}/${key}`,
            schemaPath: `${schemaPath}/required`,
            message: `missing required property "${key}"`,
          });
        }
      }

      for (const [key, child] of Object.entries(val)) {
        const childSchema = properties[key];
        if (childSchema) {
          visit(child, childSchema, `${path}/${key}`, `${schemaPath}/properties/${key}`);
          continue;
        }
        if (s.additionalProperties === false) {
          violations.push({
            path: `${path}/${key}`,
            schemaPath: `${schemaPath}/additionalProperties`,
            message: `unexpected property "${key}" is not allowed`,
          });
        } else if (isPlainObject(s.additionalProperties)) {
          visit(child, s.additionalProperties, `${path}/${key}`, `${schemaPath}/additionalProperties`);
        }
      }

      if (typeof s.minProperties === 'number' && Object.keys(val).length < s.minProperties) {
        violations.push({
          path,
          schemaPath,
          message: `expected at least ${s.minProperties} properties`,
        });
      }
      if (typeof s.maxProperties === 'number' && Object.keys(val).length > s.maxProperties) {
        violations.push({
          path,
          schemaPath,
          message: `expected at most ${s.maxProperties} properties`,
        });
      }
    }

    if (Array.isArray(s.allOf)) {
      s.allOf.forEach((sub, index) => visit(val, sub, path, `${schemaPath}/allOf/${index}`));
    }

    if (Array.isArray(s.anyOf) && s.anyOf.length > 0) {
      const ok = s.anyOf.some((sub) => validateSchema(val, sub, { maxErrors: 1 }).length === 0);
      if (!ok) {
        violations.push({
          path,
          schemaPath: `${schemaPath}/anyOf`,
          message: 'value does not match any of the allowed schemas',
        });
      }
    }

    if (Array.isArray(s.oneOf) && s.oneOf.length > 0) {
      const matches = s.oneOf.filter((sub) => validateSchema(val, sub, { maxErrors: 1 }).length === 0);
      if (matches.length === 0) {
        violations.push({
          path,
          schemaPath: `${schemaPath}/oneOf`,
          message: 'value does not match any of the allowed schemas',
        });
      } else if (matches.length > 1) {
        violations.push({
          path,
          schemaPath: `${schemaPath}/oneOf`,
          message: `value matches ${matches.length} schemas but must match exactly one`,
        });
      }
    }

    if (s.not && validateSchema(val, s.not, { maxErrors: 1 }).length === 0) {
      violations.push({ path, schemaPath: `${schemaPath}/not`, message: 'value must not match the forbidden schema' });
    }
  };

  visit(value, schema, '', '');
  return violations;
}

function validateString(
  value: string,
  schema: JsonSchema,
  path: string,
  schemaPath: string,
  violations: SchemaViolation[],
): void {
  if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
    violations.push({
      path,
      schemaPath,
      message: `expected at least ${schema.minLength} characters but received ${value.length}`,
    });
  }
  if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
    violations.push({
      path,
      schemaPath,
      message: `expected at most ${schema.maxLength} characters but received ${value.length}`,
    });
  }
  if (typeof schema.pattern === 'string') {
    let regex: RegExp | null = null;
    try {
      regex = new RegExp(schema.pattern);
    } catch {
      regex = null;
    }
    if (regex && !regex.test(value)) {
      violations.push({
        path,
        schemaPath,
        message: `value does not match the pattern ${schema.pattern}`,
      });
    }
  }
}

function validateNumber(
  value: number,
  schema: JsonSchema,
  path: string,
  schemaPath: string,
  violations: SchemaViolation[],
): void {
  if (typeof schema.minimum === 'number' && value < schema.minimum) {
    violations.push({
      path,
      schemaPath,
      message: `expected a value >= ${schema.minimum} but received ${value}`,
    });
  }
  if (typeof schema.maximum === 'number' && value > schema.maximum) {
    violations.push({
      path,
      schemaPath,
      message: `expected a value <= ${schema.maximum} but received ${value}`,
    });
  }
  if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) {
    violations.push({
      path,
      schemaPath,
      message: `expected a value > ${schema.exclusiveMinimum} but received ${value}`,
    });
  }
  if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) {
    violations.push({
      path,
      schemaPath,
      message: `expected a value < ${schema.exclusiveMaximum} but received ${value}`,
    });
  }
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    if (aKeys.length !== bKeys.length) return false;
    if (!aKeys.every((key, index) => key === bKeys[index])) return false;
    return aKeys.every((key) => deepEqual(a[key], b[key]));
  }
  return false;
}

export function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

export interface GenerateOptions {

  includeOptional?: boolean;

  skipReadOnly?: boolean;

  skipWriteOnly?: boolean;

  maxDepth?: number;

  seed?: string;
}

export function generateExample(schema: unknown, options: GenerateOptions = {}): unknown {
  const maxDepth = options.maxDepth ?? 12;

  const build = (sch: unknown, key: string, depth: number): unknown => {
    if (!isPlainObject(sch)) return null;
    const s = sch as JsonSchema;


    const pickBranch = (branches: unknown[], branchKey: string, branchDepth: number): unknown => {
      let fallback: unknown;
      for (const branch of branches) {
        const built = build(branch, branchKey, branchDepth + 1);
        if (fallback === undefined) fallback = built;
        if (validateSchema(built, branch, { maxErrors: 1 }).length === 0) return built;
      }
      return fallback ?? null;
    };

    if (s.example !== undefined) return s.example;
    if (s.default !== undefined) return s.default;

    if (Array.isArray(s.enum) && s.enum.length > 0) return s.enum[0];
    if (s.const !== undefined) return s.const;


    if (depth > maxDepth) return truncatedValue(s, key, 0, new Set());

    if (Array.isArray(s.oneOf) && s.oneOf.length > 0) return pickBranch(s.oneOf, key, depth);
    if (Array.isArray(s.anyOf) && s.anyOf.length > 0) return pickBranch(s.anyOf, key, depth);
    if (Array.isArray(s.allOf) && s.allOf.length > 0) {
      let merged: Record<string, unknown> = {};
      for (const sub of s.allOf) {
        const built = build(sub, key, depth + 1);
        if (isPlainObject(built)) merged = { ...merged, ...built };
      }
      return merged;
    }

    const names = typeNames(s);
    const type = names.find((name) => name !== 'null') ?? 'string';

    switch (type) {
      case 'object': {
        const out: Record<string, unknown> = {};
        const properties = isPlainObject(s.properties) ? s.properties : {};
        const required = Array.isArray(s.required) ? s.required : [];
        for (const [name, childSchema] of Object.entries(properties)) {
          const child = childSchema as JsonSchema;
          if (child.readOnly && options.skipReadOnly) continue;
          if (child.writeOnly && options.skipWriteOnly) continue;
          if (!options.includeOptional && !required.includes(name)) continue;
          out[name] = build(child, name, depth + 1);
        }
        return out;
      }
      case 'array': {
        const itemSchema = s.items;
        if (!itemSchema) return [];
        const min = typeof s.minItems === 'number' ? Math.max(0, s.minItems) : 1;
        const max = typeof s.maxItems === 'number' ? Math.max(min, s.maxItems) : min;
        const count = Math.min(max, min);
        const items: unknown[] = [];
        const seen = new Set<string>();
        for (let index = 0; index < count; index += 1) {
          let item = build(itemSchema, `${key}[${index}]`, depth + 1);
          if (s.uniqueItems === true) {
            for (let attempt = 0; attempt < 10 && seen.has(JSON.stringify(item)); attempt += 1) {
              item = build(itemSchema, `${key}[${index}]v${attempt}`, depth + 1);
            }
            seen.add(JSON.stringify(item));
          }
          items.push(item);
        }
        return items;
      }
      case 'integer':
        return boundedNumber(key, true, s);
      case 'number':
        return boundedNumber(key, false, s);
      case 'boolean':
        return true;
      case 'null':
        return null;
      default:
        return constrainString(stableString(s, key), s, key);
    }
  };

  return build(schema, '', 0);
}

function stableInt(key: string): number {
  const hash = hashString(key || 'value');
  return (hash % 900) + 100;
}

function stableNumber(key: string): number {
  const hash = hashString(key || 'value');
  return Math.round(((hash % 9000) + 100) / 100) / 10;
}

// A deterministic number that satisfies the numeric bounds of the schema,
// clamping the stable seed and rounding to integer when the type demands it.
function boundedNumber(key: string, integer: boolean, schema: JsonSchema): number {
  let value = integer ? stableInt(key) : stableNumber(key);

  if (typeof schema.minimum === 'number') value = Math.max(value, schema.minimum);
  if (typeof schema.maximum === 'number') value = Math.min(value, schema.maximum);
  if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) {
    value = schema.exclusiveMinimum + (integer ? 1 : 0.01);
  }
  if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) {
    value = schema.exclusiveMaximum - (integer ? 1 : 0.01);
  }

  if (integer) {
    value = Math.round(value);
    if (typeof schema.maximum === 'number' && value > schema.maximum) value = Math.floor(schema.maximum);
    if (typeof schema.minimum === 'number' && value < schema.minimum) value = Math.ceil(schema.minimum);
    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) {
      value = Math.ceil(schema.exclusiveMaximum) - 1;
    }
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) {
      value = Math.floor(schema.exclusiveMinimum) + 1;
    }
  }

  return value;
}

function stableString(schema: JsonSchema, key: string): string {
  const format = (schema.format ?? '').toLowerCase();
  const name = key.toLowerCase();
  switch (format) {
    case 'email':
      return 'ada@example.com';
    case 'uuid':
      return '8f14e45f-ea8c-4a1c-9b7c-4a2f8a1c9e01';
    case 'date-time':
      return '2024-01-15T09:30:00Z';
    case 'date':
      return '2024-01-15';
    case 'time':
      return '09:30:00';
    case 'uri':
    case 'url':
      return 'https://example.com/resource';
    case 'ipv4':
      return '198.51.100.24';
    case 'ipv6':
      return '2001:db8::1';
    case 'hostname':
      return 'example.com';
    case 'byte':
      return 'YWRtaW4=';
    case 'password':
      return 's3cret';
    default:
      break;
  }

  const words = keywordWords(key);
  const has = (word: string): boolean => words.has(word);

  if (has('id')) return 'id_1001';
  if (has('email')) return 'ada@example.com';
  if (has('phone')) return '+1-555-0100';
  if (has('url') || has('link')) return 'https://example.com/page';
  if (has('slug')) return 'sample-slug';
  if (has('name')) return 'Sample Name';
  if (has('title')) return 'Sample Title';
  if (has('description') || has('summary')) return 'Sample description text.';
  if (has('status') || has('state')) return 'active';
  if (has('code')) return 'SMP-1001';
  if (has('price') || has('amount')) return '19.99';
  if (has('count') || hasTotal(key)) return '3';
  if (has('token')) return 'tok_9f2b7c41';
  if (has('date')) return '2024-01-15';

  return `sample-${name || 'value'}`;
}

const COMPOUND_KEYWORDS: Record<string, string> = {
  barcode: 'code',
  postcode: 'code',
  zipcode: 'code',
  filename: 'name',
  phonenumber: 'phone',
  emailaddress: 'email',
};

function keyTokens(key: string): string[] {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase();
  return spaced.split(/[^a-z0-9]+/).filter((token) => token.length > 0);
}

function keywordWords(key: string): Set<string> {
  const tokens = keyTokens(key);
  const words = new Set(tokens);
  for (const [compound, canonical] of Object.entries(COMPOUND_KEYWORDS)) {
    if (words.has(compound)) words.add(canonical);
  }
  return words;
}

function hasTotal(key: string): boolean {
  return keyTokens(key).some((token) => token.endsWith('total'));
}


const PATTERN_ESCAPES: Record<string, string> = {
  d: '0',
  w: 'a',
  s: ' ',
  n: '\n',
  t: '\t',
  r: '\r',
  D: 'x',
  W: 'x',
  S: 'x',
  // Escaped punctuation maps to itself: "\." is a literal dot, "\(" a literal
  // parenthesis. Without these entries the whole fill is abandoned, so common
  // patterns like "^v\d+\.\d+\.\d+$" silently fall back to a placeholder.
  '.': '.',
  '(': '(',
  ')': ')',
  '[': '[',
  ']': ']',
  '{': '{',
  '}': '}',
  '-': '-',
  '+': '+',
  '*': '*',
  '?': '?',
  '|': '|',
  '^': '^',
  '$': '$',
  '/': '/',
  ':': ':',
  ',': ',',
  '=': '=',
  '!': '!',
  '<': '<',
  '>': '>',
  '"': '"',
  "'": "'",
  '`': '`',
  '~': '~',
  '#': '#',
  '&': '&',
  ';': ';',
  '@': '@',
  '%': '%',
};

interface PatternFill {
  value: string;
  end: number;
}

// Index of the first "|" that is a real alternation: outside any group and
// outside any character class. "a|b" alternates; "(a|b)" and "[a|b]" do not.
function topLevelAlternation(text: string): number {
  let depth = 0;
  let inClass = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === '|' && depth === 0) return i;
  }
  return -1;
}

// Reverse-fills a common subset of regular expressions (character classes,
// escapes, quantifiers, grouping) so a generated string satisfies the pattern
// instead of silently violating it. Returns undefined for constructs it cannot
// fill, so callers can fall back to their existing candidates.
function fillPattern(pattern: string): string | undefined {
  let body = pattern.replace(/^\^/, '').replace(/\$$/, '');
  const alt = topLevelAlternation(body);
  if (alt !== -1) body = body.slice(0, alt); // fill the first alternative

  const parse = (text: string, start: number): PatternFill | undefined => {
    let out = '';
    let lastToken = '';
    let i = start;

    while (i < text.length) {
      const ch = text[i] as string;
      if (ch === '|' || ch === ')') return { value: out, end: i + 1 };

      if (ch === '(') {
        let j = i + 1;
        if (text[j] === '?') {
          // Skip the whole prefix: "(?:", "(?=", "(?!", "(?<=", "(?<!".
          // Skipping only "?" would leak the marker character into the output.
          const marker = text[j + 1];
          j += marker === '<' ? 3 : marker === ':' || marker === '=' || marker === '!' ? 2 : 1;
        }
        const inner = parse(text, j);
        if (!inner) return undefined;
        out += inner.value;
        lastToken = inner.value;
        i = inner.end;
        // The group contained alternation ("(a|b)"): skip the branches that
        // were not filled, up to the group's closing parenthesis.
        if (text[i - 1] === '|') {
          let depth = 1;
          while (i < text.length && depth > 0) {
            const c = text[i];
            if (c === '\\') {
              i += 1;
            } else if (c === '(') {
              depth += 1;
            } else if (c === ')') {
              depth -= 1;
            }
            i += 1;
          }
        }
        continue;
      }

      if (ch === '\\') {
        const esc = text[i + 1];
        if (esc === undefined) return undefined;
        const mapped = PATTERN_ESCAPES[esc];
        if (mapped === undefined) return undefined; // \b, \B, \1 ... unsupported
        out += mapped;
        lastToken = mapped;
        i += 2;
        continue;
      }

      if (ch === '[') {
        const close = text.indexOf(']', i);
        if (close === -1) return undefined;
        const cls = text.slice(i + 1, close);
        let char: string | undefined;
        if (cls.startsWith('^')) {
          char = 'x';
        } else if (cls.startsWith('\\')) {
          char = PATTERN_ESCAPES[cls[1] ?? ''] ?? undefined;
        } else if (cls.startsWith('-')) {
          char = cls[1];
        } else {
          char = cls[0];
        }
        if (char === undefined) char = 'x';
        out += char;
        lastToken = char;
        i = close + 1;
        continue;
      }

      if (ch === '+') {
        i += 1; // already emitted one occurrence
        continue;
      }
      if (ch === '*') {
        i += 1; // zero or more: keep the single emitted occurrence
        continue;
      }
      if (ch === '?') {
        i += 1; // already emitted the optional occurrence
        continue;
      }
      if (ch === '{') {
        const close = text.indexOf('}', i);
        if (close === -1) return undefined;
        const spec = text.slice(i + 1, close);
        const m = /^(\d+)(?:,(\d*))?$/.exec(spec);
        if (!m) return undefined;
        const times = Number(m[1]);
        if (lastToken === '') return undefined;
        out = out.slice(0, out.length - lastToken.length) + lastToken.repeat(times);
        i = close + 1;
        continue;
      }

      if (ch === '^' || ch === '$') {
        i += 1;
        continue;
      }

      out += ch;
      lastToken = ch;
      i += 1;
    }

    return { value: out, end: i };
  };

  return parse(body, 0)?.value;
}

function constrainString(value: string, schema: JsonSchema, key: string): string {
  let result = value;

  if (typeof schema.pattern === 'string') {
    try {
      const pattern = new RegExp(schema.pattern);
      const literal = schema.pattern.replace(/^\^/, '').replace(/\$$/, '');
      const candidates: string[] = [];
      const filled = fillPattern(schema.pattern);
      if (filled !== undefined) candidates.push(filled);
      candidates.push(result, literal, `sample-${key}`, key, `${literal}-1`);
      for (const candidate of candidates) {
        if (candidate.length > 0 && pattern.test(candidate)) {
          result = candidate;
          break;
        }
      }
    } catch {
      // An invalid pattern cannot be satisfied; keep the plain value.
    }
  }

  if (typeof schema.minLength === 'number' && result.length < schema.minLength) {
    result = result.padEnd(schema.minLength, 'x');
  }
  if (typeof schema.maxLength === 'number' && result.length > schema.maxLength) {
    result = result.slice(0, schema.maxLength);
  }

  // Padding or truncation can break the pattern the value was chosen for
  // ("^\d+$" + minLength 5 used to produce "0xxxx"). Re-validate and repair.
  if (typeof schema.pattern === 'string') {
    try {
      const pattern = new RegExp(schema.pattern);
      if (pattern.test(result)) return result;
      const filled = fillPattern(schema.pattern);
      if (filled === undefined || filled.length === 0) return result;
      const min = typeof schema.minLength === 'number' ? schema.minLength : 0;
      const max = typeof schema.maxLength === 'number' ? schema.maxLength : Infinity;
      let candidate = filled;
      while (candidate.length < min && candidate.length < 64) candidate += filled;
      if (pattern.test(candidate) && candidate.length >= min && candidate.length <= max) return candidate;
      if (pattern.test(filled) && filled.length <= max) return filled;
    } catch {
      // An invalid pattern cannot be satisfied; keep the current value.
    }
  }

  return result;
}


const TRUNCATION_MAX_DEPTH = 50;

function truncatedValue(schema: JsonSchema, key: string, depth: number, ancestors: Set<JsonSchema>): unknown {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  if (schema.const !== undefined) return schema.const;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;

  for (const combo of ['oneOf', 'anyOf'] as const) {
    const branches = schema[combo];
    if (!Array.isArray(branches) || branches.length === 0) continue;
    let fallback: unknown;
    for (const branch of branches) {
      if (!isPlainObject(branch)) continue;
      const candidate = truncatedValue(branch as JsonSchema, key, depth, ancestors);
      if (fallback === undefined) fallback = candidate;
      if (validateSchema(candidate, branch, { maxErrors: 1 }).length === 0) return candidate;
    }
    if (fallback !== undefined) return fallback;
  }

  const names = typeNames(schema);
  const type = names.find((name) => name !== 'null') ?? 'string';

  switch (type) {
    case 'object': {
      const out: Record<string, unknown> = {};
      if (ancestors.has(schema) || depth > TRUNCATION_MAX_DEPTH) return out;
      const properties = isPlainObject(schema.properties) ? schema.properties : {};
      const required = Array.isArray(schema.required) ? schema.required : [];
      ancestors.add(schema);
      try {
        for (const requiredName of required) {
          const child = properties[requiredName];
          if (!isPlainObject(child)) continue;
          out[requiredName] = truncatedValue(child as JsonSchema, requiredName, depth + 1, ancestors);
        }
      } finally {
        ancestors.delete(schema);
      }
      return out;
    }
    case 'array':
      return [];
    case 'string':
      return constrainString(stableString(schema, key), schema, key);
    case 'number':
      return truncatedNumber(schema, false);
    case 'integer':
      return truncatedNumber(schema, true);
    case 'boolean':
      return false;
    case 'null':
      return null;
    default:
      return null;
  }
}

function truncatedNumber(schema: JsonSchema, integer: boolean): number {
  if (typeof schema.minimum === 'number') {
    return integer ? Math.ceil(schema.minimum) : schema.minimum;
  }
  if (typeof schema.exclusiveMinimum === 'number') {
    return integer ? Math.floor(schema.exclusiveMinimum) + 1 : schema.exclusiveMinimum + 0.01;
  }
  if (typeof schema.maximum === 'number') {
    return integer ? Math.floor(schema.maximum) : schema.maximum;
  }
  if (typeof schema.exclusiveMaximum === 'number') {
    return integer ? Math.ceil(schema.exclusiveMaximum) - 1 : schema.exclusiveMaximum - 0.01;
  }
  return 0;
}

export function hashString(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}
