export type Pointer = string;

export function escapeToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function unescapeToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

export function pointer(...tokens: Array<string | number>): Pointer {
  if (tokens.length === 0) return '';
  return '/' + tokens.map((t) => escapeToken(String(t))).join('/');
}

export function join(base: Pointer, ...tokens: Array<string | number>): Pointer {
  return base + pointer(...tokens);
}

export function parsePointer(ptr: Pointer): string[] {
  if (ptr === '' || ptr === '#') return [];
  const body = ptr.startsWith('#/') ? ptr.slice(2) : ptr.startsWith('/') ? ptr.slice(1) : ptr;
  if (body === '') return [];
  return body.split('/').map(unescapeToken);
}

export function humanizePointer(ptr: Pointer): string {
  const tokens = parsePointer(ptr);
  if (tokens.length === 0) return '<root>';
  return tokens.join('.');
}
