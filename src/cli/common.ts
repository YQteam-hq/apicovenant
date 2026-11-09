import { loadSpecFile, loadSpecFromStdin, SpecError } from '../spec/loader.ts';
import type { ApiSpec } from '../spec/model.ts';
import type { Severity } from '../lint/types.ts';

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export async function loadSpec(document: string): Promise<ApiSpec> {
  if (!document) {
    throw new UsageError('no OpenAPI document given');
  }
  if (document === '-') {
    return loadSpecFromStdin();
  }
  return loadSpecFile(document);
}

export function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function parseSeverity(value: string | undefined, fallback: Severity): Severity {
  if (!value) return fallback;
  const lowered = value.toLowerCase();
  if (lowered === 'error' || lowered === 'warn' || lowered === 'warning' || lowered === 'info') {
    return lowered === 'warning' ? 'warn' : lowered;
  }
  throw new UsageError(`invalid severity "${value}" (expected error, warn or info)`);
}

export function parseFailOn<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  if (!value) return undefined;
  if (!allowed.includes(value as T)) {
    throw new UsageError(`invalid fail-on "${value}" (expected ${allowed.join(' or ')})`);
  }
  return value as T;
}

export function parseInteger(
  value: string | undefined,
  fallback: number,
  label: string,
  minimum?: number,
  maximum?: number,
): number {
  if (value === undefined) return fallback;
  if (!/^-?\d+$/.test(value.trim())) {
    throw new UsageError(`invalid ${label} "${value}" (expected an integer)`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new UsageError(`invalid ${label} "${value}" (expected an integer)`);
  }
  if (minimum !== undefined && parsed < minimum) {
    throw new UsageError(`invalid ${label} "${value}" (minimum: ${minimum})`);
  }
  if (maximum !== undefined && parsed > maximum) {
    throw new UsageError(`invalid ${label} "${value}" (maximum: ${maximum})`);
  }
  return parsed;
}

export function describeError(error: unknown): string {
  if (error instanceof SpecError) return error.message;
  if (error instanceof UsageError) return error.message;
  return (error as Error).message ?? String(error);
}
