import type { ApiSpec, Operation } from '../spec/model.ts';
import { compilePath } from '../mock/server.ts';
import type { GoldenFile } from '../record/golden.ts';

export interface UnexercisedOperation {
  operation: string;
  method: string;
  path: string;
}

export interface UndocumentedTraffic {
  method: string;
  path: string;
  reason: 'path-not-documented' | 'method-not-documented';
}

export interface StatusGap {
  method: string;
  path: string;
  documented: string[];
  observed: number[];
}

export interface CoverageReport {
  apicovenant: number;
  golden: string;
  spec: string;
  summary: {
    operations: number;
    exercised: number;
    percent: number;
  };
  unexercised: UnexercisedOperation[];
  undocumented: UndocumentedTraffic[];
  statusGaps: StatusGap[];
}

interface Route {
  path: string;
  operations: Operation[];
  regex: RegExp;
  literals: number;
  parameters: number;
  literalChars: number;
}

function routeOf(path: string, operations: Operation[]): Route {
  const compiled = compilePath(path);
  let literals = 0;
  let parameters = 0;
  let literalChars = 0;
  for (const segment of path.split('/')) {
    if (segment === '') continue;
    const matches = [...segment.matchAll(/\{([^}]+)\}/g)];
    parameters += matches.length;
    if (matches.length === 0) {
      literals += 1;
      literalChars += segment.length;
    } else {
      literalChars += segment.replace(/\{[^}]+\}/g, '').length;
    }
  }
  return { path, operations, regex: compiled.regex, literals, parameters, literalChars };
}

/**
 * The most specific route wins, so /users/me is matched before /users/{id}
 * even when both are documented. Literal segments beat parameter segments;
 * among equals the longer path wins.
 */
function sortRoutes(routes: Route[]): Route[] {
  return routes.sort((a, b) => {
    if (a.literals !== b.literals) return b.literals - a.literals;
    if (a.parameters !== b.parameters) return a.parameters - b.parameters;
    if (a.literalChars !== b.literalChars) return b.literalChars - a.literalChars;
    if (a.path.length !== b.path.length) return b.path.length - a.path.length;
    return a.path.localeCompare(b.path);
  });
}

function documentedStatus(operation: Operation, status: number): boolean {
  for (const key of operation.responses.keys()) {
    if (key === 'default') continue;
    if (key === String(status)) return true;
    const wildcard = /^([1-5])XX$/i.exec(key);
    if (wildcard && Math.floor(status / 100) === Number(wildcard[1])) return true;
  }
  return false;
}

export function measureCoverage(golden: GoldenFile, spec: ApiSpec, goldenLabel: string): CoverageReport {
  const routes = sortRoutes(
    spec.paths.map((pathItem) => routeOf(pathItem.path, pathItem.operations)),
  );
  const exercised = new Set<string>();
  const undocumented = new Map<string, UndocumentedTraffic>();
  const statusObserved = new Map<string, Set<number>>();

  for (const interaction of golden.interactions) {
    const method = interaction.method.toUpperCase();
    const route = routes.find((candidate) => candidate.regex.test(interaction.path));

    if (!route) {
      const key = `${method} ${interaction.path}`;
      undocumented.set(key, { method, path: interaction.path, reason: 'path-not-documented' });
      continue;
    }

    const operation = route.operations.find((candidate) => candidate.method.toUpperCase() === method);
    if (!operation) {
      const key = `${method} ${interaction.path}`;
      undocumented.set(key, { method, path: interaction.path, reason: 'method-not-documented' });
      continue;
    }

    exercised.add(operation.key);
    const seen = statusObserved.get(operation.key) ?? new Set<number>();
    seen.add(interaction.status);
    statusObserved.set(operation.key, seen);
  }

  const unexercised: UnexercisedOperation[] = spec.operations
    .filter((operation) => !exercised.has(operation.key))
    .map((operation) => ({ operation: operation.key, method: operation.method.toUpperCase(), path: operation.path }))
    .sort((a, b) => a.operation.localeCompare(b.operation));

  const statusGaps: StatusGap[] = [];
  for (const operation of spec.operations) {
    const observed = statusObserved.get(operation.key);
    if (!observed || observed.size === 0) continue;
    const missing = [...observed].filter((status) => !documentedStatus(operation, status)).sort((a, b) => a - b);
    if (missing.length === 0) continue;
    statusGaps.push({
      method: operation.method.toUpperCase(),
      path: operation.path,
      documented: [...operation.responses.keys()],
      observed: missing,
    });
  }

  const total = spec.operations.length;
  const percent = total === 0 ? 100 : Math.round((exercised.size / total) * 100);

  return {
    apicovenant: 1,
    golden: goldenLabel,
    spec: spec.document,
    summary: { operations: total, exercised: exercised.size, percent },
    unexercised,
    undocumented: [...undocumented.values()].sort((a, b) =>
      `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`),
    ),
    statusGaps: statusGaps.sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`)),
  };
}

export function coverageShouldFail(
  report: CoverageReport,
  mode: 'gap' | 'undocumented' | 'never',
  minimum?: number,
): boolean {
  if (mode === 'never') return false;
  if (mode === 'undocumented') return report.undocumented.length > 0;
  return report.summary.percent < (minimum ?? 100);
}

/** Human-readable report, kept next to the engine so the MCP tool and the CLI agree. */
export function renderCoverageText(report: CoverageReport): string {
  const lines: string[] = [];
  lines.push('traffic coverage');
  lines.push(`  golden  ${report.golden}`);
  lines.push(`  spec    ${report.spec}`);
  lines.push(
    `  operations  ${report.summary.exercised}/${report.summary.operations} exercised (${report.summary.percent}%)`,
  );
  lines.push('');

  lines.push('unexercised operations');
  if (report.unexercised.length === 0) lines.push('  none');
  for (const entry of report.unexercised) {
    lines.push(`  ${entry.method.padEnd(7)} ${entry.path}`);
  }
  lines.push('');

  lines.push('undocumented traffic');
  if (report.undocumented.length === 0) lines.push('  none');
  for (const entry of report.undocumented) {
    lines.push(`  ${entry.method.padEnd(7)} ${entry.path.padEnd(24)} ${entry.reason}`);
  }
  lines.push('');

  lines.push('status gaps');
  if (report.statusGaps.length === 0) lines.push('  none');
  for (const gap of report.statusGaps) {
    lines.push(
      `  ${gap.method} ${gap.path}  documented ${gap.documented.join(', ')}; observed ${gap.observed.join(', ')}`,
    );
  }

  return lines.join('\n');
}
