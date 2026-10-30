export type StyleName =
  | 'bold'
  | 'dim'
  | 'italic'
  | 'underline'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'gray'
  | 'white';

const CODES: Record<StyleName, [number, number]> = {
  bold: [1, 22],
  dim: [2, 22],
  italic: [3, 23],
  underline: [4, 24],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  blue: [34, 39],
  magenta: [35, 39],
  cyan: [36, 39],
  gray: [90, 39],
  white: [37, 39],
};

export function colorEnabled(stream: { isTTY?: boolean } = process.stdout): boolean {
  if (process.env['FORCE_COLOR'] && process.env['FORCE_COLOR'] !== '0') return true;
  if (process.env['NO_COLOR'] !== undefined && process.env['NO_COLOR'] !== '') return false;
  if (process.env['TERM'] === 'dumb') return false;
  return Boolean(stream.isTTY);
}

const enabled = colorEnabled();

export function style(text: string, ...names: StyleName[]): string {
  if (!enabled || names.length === 0) return text;
  let out = text;
  for (const name of names) {
    const code = CODES[name];
    if (!code) continue;
    out = `\u001b[${code[0]}m${out}\u001b[${code[1]}m`;
  }
  return out;
}

export const bold = (t: string): string => style(t, 'bold');
export const dim = (t: string): string => style(t, 'dim');
export const red = (t: string): string => style(t, 'red');
export const green = (t: string): string => style(t, 'green');
export const yellow = (t: string): string => style(t, 'yellow');
export const cyan = (t: string): string => style(t, 'cyan');
export const magenta = (t: string): string => style(t, 'magenta');
export const gray = (t: string): string => style(t, 'gray');
