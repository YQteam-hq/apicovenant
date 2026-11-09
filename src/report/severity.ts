import type { Severity } from '../lint/types.ts';

const SEVERITIES: ReadonlySet<string> = new Set<Severity>(['error', 'warn', 'info']);

/**
 * Severity is used to index tables and to build markup, so only the three
 * known values may reach them. A finding built from external data (a
 * baseline, an integration, hand-written JSON) is not guaranteed to honour
 * the TypeScript union at runtime; anything else is treated as the most
 * severe value rather than being echoed into the output or used as a key.
 */
export function safeSeverity(value: unknown): Severity {
  return typeof value === 'string' && SEVERITIES.has(value) ? (value as Severity) : 'error';
}
