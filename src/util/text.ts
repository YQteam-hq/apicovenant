export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)) + '\u2026';
}

export function isCamelCase(text: string): boolean {
  return /^[a-z][a-zA-Z0-9]*$/.test(text);
}

export function isSnakeCase(text: string): boolean {
  return /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(text);
}

export function isKebabCase(text: string): boolean {
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(text);
}

export function dominantStyle(values: string[]): 'camelCase' | 'snake_case' | 'kebab-case' | 'other' {
  const camel = values.filter(isCamelCase).length;
  const snake = values.filter(isSnakeCase).length;
  const kebab = values.filter(isKebabCase).length;
  const max = Math.max(camel, snake, kebab);
  if (max === 0) return 'other';
  if (max === camel) return 'camelCase';
  if (max === snake) return 'snake_case';
  return 'kebab-case';
}
