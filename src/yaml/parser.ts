import { isPlainObject } from '../util/text.ts';

export class YamlError extends Error {
  readonly line: number;
  readonly column: number;

  constructor(message: string, line: number, column = 0) {
    super(`${message} (line ${line}${column ? `, column ${column}` : ''})`);
    this.name = 'YamlError';
    this.line = line;
    this.column = column;
  }
}

interface SourceLine {

  indent: number;

  text: string;

  raw: string;

  num: number;

  blank: boolean;
}

const TRUE_VALUES = new Set(['true', 'True', 'TRUE']);
const FALSE_VALUES = new Set(['false', 'False', 'FALSE']);
const NULL_VALUES = new Set(['null', 'Null', 'NULL', '~', '']);

export function parseYaml(text: string): unknown {
  return new YamlParser(text).parseDocument();
}

class YamlParser {
  private readonly lines: SourceLine[];
  private index = 0;
  private readonly anchors = new Map<string, unknown>();

  constructor(source: string) {
    const rawLines = source.replace(/\r\n?/g, '\n').split('\n');
    // A trailing newline leaves a final empty element behind that is an
    // artifact of split(), not a real line. Drop it so block scalars can
    // count their genuine trailing empty lines (keep chomping, "|+" / ">+").
    if (rawLines.length > 1 && rawLines[rawLines.length - 1] === '') rawLines.pop();
    this.lines = rawLines.map((raw, i) => {
      const indent = raw.length - raw.trimStart().length;
      const stripped = stripComment(raw);

      const text = stripped.slice(indent).replace(/\s+$/, '');
      const blank = text.trim() === '';
      return { indent, text: blank ? '' : text, raw, num: i + 1, blank };
    });
  }

  parseDocument(): unknown {
    this.skipIgnorable();
    const first = this.lines[this.index];
    if (first && first.text === '---') {
      this.index += 1;
      this.skipIgnorable();
    }
    if (!this.lines[this.index]) return null;

    const value = this.parseNode();

    // Only one document is supported: after the first document ends we allow a
    // trailing document-end marker ("..." / "---"), but any further content is
    // a second document and is rejected rather than silently merged.
    this.skipIgnorable();
    let rest = this.lines[this.index];
    if (rest && (rest.text === '---' || rest.text === '...')) {
      this.index += 1;
      this.skipIgnorable();
      rest = this.lines[this.index];
    }
    if (rest) {
      throw new YamlError('multiple YAML documents are not supported', rest.num);
    }

    return value === undefined ? null : value;
  }

  private skipIgnorable(): void {
    while (this.index < this.lines.length) {
      const line = this.lines[this.index];
      if (!line) break;
      if (line.blank) {
        this.index += 1;
        continue;
      }
      break;
    }
  }

  private peek(): SourceLine | undefined {
    this.skipIgnorable();
    return this.lines[this.index];
  }

  private parseNode(): unknown {
    const line = this.peek();
    if (!line) return null;
    if (line.text === '---' || line.text === '...') return null;
    if (isSequenceEntry(line.text)) return this.parseSequence(line.indent);
    if (findKeySeparator(line.text) === -1) {

      this.index += 1;
      return this.parseInlineValue(line.text, line.indent, line);
    }
    return this.parseMapping(line.indent);
  }

  private parseMapping(indent: number): Record<string, unknown> {
    const map: Record<string, unknown> = {};

    for (;;) {
      const line = this.peek();
      if (!line) break;
      if (line.text === '---' || line.text === '...') break;
      if (line.indent < indent) break;
      if (line.indent > indent) {
        throw new YamlError('Unexpected indentation', line.num, line.indent + 1);
      }
      if (isSequenceEntry(line.text)) break;

      const sep = findKeySeparator(line.text);
      if (sep === -1) {
        throw new YamlError(`Expected "key: value" but found "${line.text}"`, line.num, 1);
      }

      const key = parseKey(line.text.slice(0, sep), line.num);
      const rest = line.text.slice(sep + 1).trim();
      this.index += 1;
      map[key] = this.parseValueAfterKey(rest, indent, line);
    }

    applyMergeKeys(map);
    return map;
  }

  private parseSequence(indent: number): unknown[] {
    const items: unknown[] = [];

    for (;;) {
      const line = this.peek();
      if (!line) break;
      if (line.text === '---' || line.text === '...') break;
      if (line.indent !== indent) break;
      if (!isSequenceEntry(line.text)) break;

      const dashIndex = line.raw.indexOf('-', line.indent);
      const afterDash = line.raw.slice(dashIndex + 1);
      const leading = afterDash.length - afterDash.trimStart().length;
      const contentIndent = indent + 1 + leading;
      const content = line.text.slice(1).trim();

      if (content === '') {
        this.index += 1;
        items.push(this.parseChildBlock(indent));
        continue;
      }

      if (isSequenceEntry(content)) {
        // Compact nested sequence: "- - 1"
        this.lines[this.index] = { ...line, indent: contentIndent, text: content };
        items.push(this.parseSequence(contentIndent));
        continue;
      }

      if (content.startsWith('|') || content.startsWith('>')) {
        // Block scalar as a sequence item: "- |"
        this.index += 1;
        items.push(this.parseBlockScalar(content, indent));
        continue;
      }

      if (findKeySeparator(content) !== -1) {

        this.lines[this.index] = { ...line, indent: contentIndent, text: content };
        items.push(this.parseMapping(contentIndent));
        continue;
      }

      this.index += 1;
      items.push(this.parseInlineValue(content, contentIndent, line));
    }

    return items;
  }

  private parseChildBlock(parentIndent: number): unknown {
    const next = this.peek();
    if (!next) return null;
    if (next.indent > parentIndent) return this.parseNode();

    if (next.indent === parentIndent && isSequenceEntry(next.text)) {
      return this.parseSequence(next.indent);
    }
    return null;
  }

  private parseValueAfterKey(rest: string, parentIndent: number, line: SourceLine): unknown {
    let value = rest;
    let anchorName: string | undefined;

    if (value.startsWith('&')) {
      const match = /^&([^\s]+)\s*/.exec(value);
      if (!match) throw new YamlError('Invalid anchor', line.num, line.indent + 1);
      anchorName = match[1];
      value = value.slice(match[0].length).trim();
    }

    let parsed: unknown;
    if (value === '') {
      parsed = this.parseChildBlock(parentIndent);
    } else if (value.startsWith('|') || value.startsWith('>')) {
      parsed = this.parseBlockScalar(value, parentIndent);
    } else {
      parsed = this.parseInlineValue(value, parentIndent, line);
    }

    if (anchorName) this.anchors.set(anchorName, parsed);
    return parsed;
  }

  private parseInlineValue(text: string, indent: number, line: SourceLine): unknown {
    const value = text.trim();

    if (value.startsWith('*')) {
      const name = value.slice(1).trim();
      if (!this.anchors.has(name)) {
        throw new YamlError(`Unknown alias "*${name}"`, line.num, line.indent + 1);
      }
      return this.anchors.get(name);
    }

    if (value.startsWith('&')) {
      const match = /^&([^\s]+)\s*/.exec(value);
      if (!match) throw new YamlError('Invalid anchor', line.num, line.indent + 1);
      const name = match[1];
      if (!name) throw new YamlError('Invalid anchor', line.num, line.indent + 1);
      const inner = value.slice(match[0].length).trim();
      const parsed = this.parseInlineValue(inner, indent, line);
      this.anchors.set(name, parsed);
      return parsed;
    }

    if (value.startsWith('[') || value.startsWith('{')) {
      return this.parseFlowMultiLine(value, indent, line);
    }

    if (value.startsWith('"') || value.startsWith("'")) {
      const quoted = parseQuoted(value, line.num);
      return quoted.value;
    }

    const parts = [value];
    for (;;) {
      const next = this.lines[this.index];
      if (!next || next.blank) break;
      if (next.indent <= indent) break;
      if (next.text === '---' || next.text === '...') break;
      if (isSequenceEntry(next.text)) break;
      if (findKeySeparator(next.text) !== -1) break;
      parts.push(next.text.trim());
      this.index += 1;
    }

    return resolveScalar(parts.join(' '));
  }

  private parseBlockScalar(header: string, parentIndent: number): string {
    const style = header[0] as '|' | '>';
    const modifiers = header.slice(1).trim();
    const chomp = /[-+]/.test(modifiers) ? (modifiers.includes('-') ? 'strip' : 'keep') : 'clip';

    const collected: string[] = [];
    let blockIndent = -1;

    while (this.index < this.lines.length) {
      const current = this.lines[this.index];
      if (current === undefined) break;
      const isEmpty = current.raw.trim() === '';
      if (!isEmpty && current.indent <= parentIndent) break;
      if (!isEmpty && blockIndent === -1) blockIndent = current.indent;
      // A non-empty line indented less than the block content (but more than
      // the parent) ends the block scalar. Silently swallowing it would
      // corrupt the value.
      if (!isEmpty && current.indent < blockIndent) break;
      collected.push(isEmpty ? '' : current.raw.slice(Math.min(blockIndent, current.indent)));
      this.index += 1;
    }

    let trailingEmpties = 0;
    while (collected.length > 0 && collected[collected.length - 1] === '') {
      collected.pop();
      trailingEmpties += 1;
    }

    let body: string;
    if (style === '|') {
      body = collected.join('\n');
    } else {

      const parts: string[] = [];
      for (let i = 0; i < collected.length; i += 1) {
        const current = collected[i] as string;
        if (i === 0) {
          parts.push(current);
          continue;
        }
        const previous = collected[i - 1] as string;
        if (current === '') {
          parts.push('\n');
          continue;
        }
        if (previous === '') {
          parts.push(current);
          continue;
        }
        if (/^\s/.test(current) || /^\s/.test(previous)) {
          parts.push('\n', current);
          continue;
        }
        parts.push(' ', current);
      }
      body = parts.join('');
    }

    if (chomp === 'strip') return body;
    if (chomp === 'keep') return `${body}\n${'\n'.repeat(trailingEmpties)}`;
    return body === '' ? '' : `${body}\n`;
  }

  // Flow collections may span several lines (comments are stripped per line
  // beforehand). When the first line is unterminated, keep appending the
  // following lines until the brackets balance again.
  private parseFlowMultiLine(first: string, parentIndent: number, line: SourceLine): unknown {
    let text = first;
    while (!isFlowClosed(text) && this.index < this.lines.length) {
      const next = this.lines[this.index];
      if (!next) break;
      if (next.blank) {
        text += ' ';
        this.index += 1;
        continue;
      }
      if (next.text === '---' || next.text === '...') break;
      if (next.indent < parentIndent) break;
      text += next.text;
      this.index += 1;
    }
    return parseFlow(text, line.num, this.anchors);
  }
}

function isSequenceEntry(text: string): boolean {
  return text === '-' || text.startsWith('- ');
}

// YAML merge key: "<<: *anchor" (or a flow mapping / sequence of anchors)
// inlines the referenced mapping; explicit keys on the mapping win.
function applyMergeKeys(map: Record<string, unknown>): void {
  const merge = map['<<'];
  if (merge === undefined) return;
  delete map['<<'];

  const sources = Array.isArray(merge) ? merge : [merge];
  for (const source of sources) {
    if (!isPlainObject(source)) continue;
    for (const [key, value] of Object.entries(source)) {
      if (!(key in map)) map[key] = value;
    }
  }
}

function isFlowClosed(text: string): boolean {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (quote) {
      if (ch === '\\' && quote === '"') {
        i += 1;
        continue;
      }
      if (ch === quote) {
        if (quote === "'" && text[i + 1] === "'") {
          i += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '[' || ch === '{') depth += 1;
    if (ch === ']' || ch === '}') depth -= 1;
  }
  return depth <= 0;
}

export function findKeySeparator(text: string): number {
  let quote: '"' | "'" | null = null;
  let depth = 0;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;

    if (quote) {
      if (ch === '\\' && quote === '"') {
        i += 1;
        continue;
      }
      if (ch === quote) {
        if (quote === "'" && text[i + 1] === "'") {
          i += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '[' || ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === ']' || ch === '}') {
      depth -= 1;
      continue;
    }
    if (ch === ':' && depth === 0) {
      const next = text[i + 1];
      if (next === undefined || next === ' ' || next === '\t') return i;
    }
  }

  return -1;
}

function parseKey(raw: string, lineNum: number): string {
  const key = raw.trim();
  if (key.startsWith('"') || key.startsWith("'")) {
    return parseQuoted(key, lineNum).value;
  }
  return key;
}

function parseQuoted(text: string, lineNum: number): { value: string; length: number } {
  const quote = text[0];
  let out = '';
  let i = 1;

  while (i < text.length) {
    const ch = text[i] as string;

    if (quote === "'") {
      if (ch === "'") {
        if (text[i + 1] === "'") {
          out += "'";
          i += 2;
          continue;
        }
        return { value: out, length: i + 1 };
      }
      out += ch;
      i += 1;
      continue;
    }

    if (ch === '\\') {
      const next = text[i + 1];
      switch (next) {
        case 'n':
          out += '\n';
          break;
        case 't':
          out += '\t';
          break;
        case 'r':
          out += '\r';
          break;
        case '0':
          out += '\0';
          break;
        case 'b':
          out += '\b';
          break;
        case 'f':
          out += '\f';
          break;
        case '"':
          out += '"';
          break;
        case '\\':
          out += '\\';
          break;
        case '/':
          out += '/';
          break;
        case 'u': {
          const hex = text.slice(i + 2, i + 6);
          const code = Number.parseInt(hex, 16);
          if (Number.isNaN(code)) throw new YamlError('Invalid unicode escape', lineNum);
          out += String.fromCharCode(code);
          i += 4;
          break;
        }
        default:
          out += next ?? '';
          break;
      }
      i += 2;
      continue;
    }

    if (ch === '"') return { value: out, length: i + 1 };
    out += ch;
    i += 1;
  }

  throw new YamlError('Unterminated quoted string', lineNum);
}

export function resolveScalar(raw: string): unknown {
  const text = raw.trim();
  if (NULL_VALUES.has(text)) return null;
  if (TRUE_VALUES.has(text)) return true;
  if (FALSE_VALUES.has(text)) return false;
  if (/^[-+]?\d+$/.test(text)) {
    const asNumber = Number(text);
    if (Number.isSafeInteger(asNumber)) return asNumber;
  }
  if (/^[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/.test(text)) {
    const asNumber = Number(text);
    if (!Number.isNaN(asNumber)) return asNumber;
  }
  if (/^0x[0-9a-fA-F]+$/.test(text)) return Number.parseInt(text, 16);
  if (/^0o[0-7]+$/.test(text)) return Number.parseInt(text.slice(2), 8);
  return text;
}

function stripComment(raw: string): string {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i] as string;
    if (quote) {
      if (ch === '\\' && quote === '"') {
        i += 1;
        continue;
      }
      if (ch === quote) {
        if (quote === "'" && raw[i + 1] === "'") {
          i += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || raw[i - 1] === ' ' || raw[i - 1] === '\t')) {
      return raw.slice(0, i);
    }
  }
  return raw;
}

function parseFlow(text: string, lineNum: number, anchors: Map<string, unknown>): unknown {
  let pos = 0;

  const skipWs = (): void => {
    while (pos < text.length && /\s/.test(text[pos] as string)) pos += 1;
  };

  const parseValue = (): unknown => {
    skipWs();
    const ch = text[pos];
    if (ch === undefined) throw new YamlError('Unexpected end of flow collection', lineNum);
    if (ch === '*') {
      // Alias inside a flow collection: "[*anchor]" / "{k: *anchor}".
      pos += 1;
      const start = pos;
      while (pos < text.length && !',]}\n'.includes(text[pos] as string)) pos += 1;
      const name = text.slice(start, pos).trim();
      if (!anchors.has(name)) throw new YamlError(`Unknown alias "*${name}"`, lineNum);
      return anchors.get(name);
    }
    if (ch === '&') {
      // Anchor definition inside a flow collection:
      // "{a: &x 1, b: *x}" / "[&x 1, *x]". Without this branch the "&x"
      // is swallowed into a plain scalar and the later "*x" lookup fails.
      pos += 1;
      const start = pos;
      while (pos < text.length && !/[\s,\]}]/.test(text[pos] as string)) pos += 1;
      const name = text.slice(start, pos);
      if (!name) throw new YamlError('Invalid anchor', lineNum);
      const anchored = parseValue();
      anchors.set(name, anchored);
      return anchored;
    }
    if (ch === '[') return parseSeq();
    if (ch === '{') return parseMap();
    if (ch === '"' || ch === "'") {
      const { value, length } = parseQuoted(text.slice(pos), lineNum);
      pos += length;
      return value;
    }

    const start = pos;
    while (pos < text.length && !',]}\n'.includes(text[pos] as string)) pos += 1;
    return resolveScalar(text.slice(start, pos));
  };

  const parseSeq = (): unknown[] => {
    pos += 1;
    const items: unknown[] = [];
    for (;;) {
      skipWs();
      if (text[pos] === ']') {
        pos += 1;
        return items;
      }
      if (pos >= text.length) throw new YamlError('Unterminated flow sequence', lineNum);
      items.push(parseValue());
      skipWs();
      if (text[pos] === ',') {
        pos += 1;
        continue;
      }
      if (text[pos] === ']') {
        pos += 1;
        return items;
      }
      throw new YamlError('Expected "," or "]" in flow sequence', lineNum);
    }
  };

  const parseMap = (): Record<string, unknown> => {
    pos += 1;
    const map: Record<string, unknown> = {};
    for (;;) {
      skipWs();
      if (text[pos] === '}') {
        pos += 1;
        return map;
      }
      if (pos >= text.length) throw new YamlError('Unterminated flow mapping', lineNum);

      let key: string;
      if (text[pos] === '"' || text[pos] === "'") {
        const { value, length } = parseQuoted(text.slice(pos), lineNum);
        pos += length;
        key = value;
      } else {
        const start = pos;
        while (pos < text.length && text[pos] !== ':' && text[pos] !== ',' && text[pos] !== '}') pos += 1;
        key = text.slice(start, pos).trim();
      }

      skipWs();
      if (text[pos] !== ':') throw new YamlError('Expected ":" in flow mapping', lineNum);
      pos += 1;
      map[key] = parseValue();

      skipWs();
      if (text[pos] === ',') {
        pos += 1;
        continue;
      }
      if (text[pos] === '}') {
        pos += 1;
        return map;
      }
      throw new YamlError('Expected "," or "}" in flow mapping', lineNum);
    }
  };

  const result = parseValue();
  skipWs();
  // Anything left over ("[1] extra", "[1]]", "{a: 1} junk") used to be
  // silently dropped, which turns malformed documents into wrong values.
  if (pos < text.length) {
    throw new YamlError(`Unexpected content after flow collection: "${text.slice(pos)}"`, lineNum);
  }
  return result;
}
